// src/services/vendorServices.js
// ─────────────────────────────────────────────────────────────
// Auto-matches or creates a vendor by GSTIN/company name.
// Calculates TDS based on section, threshold, and FY ledger.
// ─────────────────────────────────────────────────────────────

import supabase from "../config/supabase.js";

// ── Helpers ──────────────────────────────────────────────────

/**
 * Returns current Indian financial year string e.g. "2025-26"
 */
export function getCurrentFinancialYear() {
    const now = new Date();
    const month = now.getMonth() + 1; // 1-based
    const year = now.getFullYear();
    // FY starts April (month 4)
    if (month >= 4) {
        return `${year}-${String(year + 1).slice(2)}`;
    } else {
        return `${year - 1}-${String(year).slice(2)}`;
    }
}

/**
 * Derives FY from an invoice date string "YYYY-MM-DD"
 */
export function getFYFromDate(dateStr) {
    if (!dateStr) return getCurrentFinancialYear();
    const d = new Date(dateStr);
    const month = d.getMonth() + 1;
    const year = d.getFullYear();
    if (month >= 4) {
        return `${year}-${String(year + 1).slice(2)}`;
    } else {
        return `${year - 1}-${String(year).slice(2)}`;
    }
}

// ── 1. Vendor matching ──────────────────────────────────────

/**
 * Finds existing vendor by GSTIN, or creates a new one.
 * Returns { vendor, isNew }
 */
export async function findOrCreateVendor(extracted, orgId) {
    const gstin = extracted.vendor_gstin ?? null;
    const name = extracted.vendor_name ?? "Unknown Vendor";

    // 1a. Try to find by GSTIN (most reliable — unique) — CHANGED: scoped
    // to this org, so Firm A and Firm B each get their own vendor record
    // for the same real-world supplier, matching their own TDS ledgers.
    if (gstin) {
        const { data: existing } = await supabase
            .from("vendors")
            .select("*")
            .eq("gstin", gstin)
            .eq("org_id", orgId) // NEW
            .maybeSingle();

        if (existing) {
            console.log(`✓ Matched existing vendor: ${existing.company_name} (${gstin})`);
            // Update company name if it changed
            if (existing.company_name !== name) {
                await supabase
                    .from("vendors")
                    .update({ company_name: name })
                    .eq("id", existing.id);
                existing.company_name = name;
            }
            return { vendor: existing, isNew: false };
        }
    }

    // 1b. Try fuzzy match by company name (normalise: lowercase, strip punctuation)
    if (name && name !== "Unknown Vendor") {
        const normalised = name.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
        const { data: allVendors } = await supabase
            .from("vendors")
            .select("id, company_name, gstin")
            .eq("org_id", orgId); // NEW — same org-scoping

        const match = (allVendors ?? []).find((v) => {
            const vNorm = v.company_name.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
            return vNorm === normalised;
        });

        if (match) {
            console.log(`✓ Name-matched vendor: ${match.company_name}`);
            // If we now have a GSTIN and the vendor didn't, update it
            if (gstin && !match.gstin) {
                await supabase.from("vendors").update({ gstin }).eq("id", match.id);
            }
            const { data: full } = await supabase
                .from("vendors")
                .select("*")
                .eq("id", match.id)
                .single();
            return { vendor: full, isNew: false };
        }
    }

    // 1c. No match — create new vendor from extracted data
    //
    // FIXED (this session) — two compounding bugs found while investigating
    // §7's "GSTIN-less vendor + TDS, not yet confirmed" gap and §8b.5's
    // "TDS preview always uses rate_company" gap. Root cause of BOTH:
    //   1. Neither extraction prompt (geminiService.js / visionService.js)
    //      ever asked the AI for a vendor PAN field — `extracted.pan` was
    //      ALWAYS undefined, so `vendors.pan` has been null for every
    //      vendor ever created, and calculateTDS()'s `hasPan` check has
    //      always been false → EVERY invoice's TDS has been calculated at
    //      the punitive rate_no_pan (typically 20%), never the correct
    //      rate_individual/rate_company, regardless of how the invoice
    //      actually looked.
    //   2. deriveVendorType()'s old GSTIN-character check read gstin[9] —
    //      off by 4 from the actual entity-type character. A GSTIN embeds
    //      a full 10-char PAN at positions 3-12 (1-indexed), and PAN's
    //      entity-type character is its 4th character — landing at GSTIN
    //      index 5 (0-indexed), not 9. index 9 falls inside the PAN's
    //      numeric sequence, so it was reading a digit, never matching
    //      "P"/"F"/"B"/"T", and silently defaulting every vendor —
    //      GSTIN-less or not — to "company".
    //
    // Fix: a GSTIN already contains a full, valid PAN — derive it directly
    // (gstin.slice(2, 12)) instead of relying on a field the AI was never
    // asked for, and fix the entity-type character to the correct index
    // within that derived PAN. Genuinely GSTIN-less AND PAN-less vendors
    // (e.g. an unregistered freelancer with no GSTIN, and no PAN visible
    // on the invoice either) correctly still fall through to hasPan=false
    // and the no-PAN rate — that is the legally correct outcome for that
    // specific case, not a bug.
    const derivedPan = extracted.pan ?? derivePanFromGstin(gstin);

    const newVendor = {
        org_id: orgId, // NEW — tag every new vendor to the creating firm
        company_name: name,
        gstin: gstin ?? null,
        pan: derivedPan,
        vendor_type: deriveVendorType(derivedPan),
        email: extracted.vendor_email ?? null,
        phone: extracted.vendor_phone ?? null,
        address: extracted.vendor_address ?? null,
        bank_account: extracted.bank_account ?? null,
        ifsc: extracted.ifsc ?? null,
        bank_name: extracted.bank_name ?? null,
    };

    const { data: created, error } = await supabase
        .from("vendors")
        .insert(newVendor)
        .select()
        .single();

    if (error) throw new Error(`Failed to create vendor: ${error.message}`);

    console.log(`✓ Created new vendor: ${created.company_name} (id: ${created.id})`);
    return { vendor: created, isNew: true };
}

/**
 * Extracts the PAN embedded within a valid 15-character GSTIN.
 * GSTIN structure: [2-digit state code][10-char PAN][entity code][default 'Z'][checksum]
 * — the PAN occupies characters 3-12 (1-indexed), i.e. gstin.slice(2, 12).
 */
function derivePanFromGstin(gstin) {
    if (!gstin || gstin.length !== 15) return null;
    return gstin.slice(2, 12).toUpperCase();
}

/**
 * Derives vendor type from a PAN's 4th character (standard Indian PAN
 * structure — this position always indicates holder type, regardless of
 * whether the PAN came from a standalone field or was extracted from a
 * GSTIN via derivePanFromGstin() above):
 *   P = Individual   F = Firm        H = HUF (grouped with Individual —
 *   C = Company      T = Trust           tds_sections' own rows use
 *   A = AOP          B = BOI             "Individual/HUF" as a combined
 *   L = Local Authority   G = Government  category — see §8c)
 *   J = Artificial Juridical Person
 *
 * NOTE: AOP/BOI/Trust/Local Authority/Government/Artificial-Juridical are
 * mapped to the "company" (non-individual) rate bucket below, matching
 * this codebase's existing binary rate_individual vs rate_company split
 * in calculateTDS(). This is an assumption, not a confirmed CA ruling —
 * flagged for the CA questions list.
 */
function deriveVendorType(pan) {
    if (!pan || pan.length !== 10) return "company";
    const char = pan[3].toUpperCase();
    if (char === "P") return "individual";
    if (char === "H") return "individual"; // HUF — grouped with Individual, see note above
    if (char === "F") return "firm";
    return "company"; // C, A, B, T, L, J, G, or unrecognized — safest default
}

// ── 2. TDS Calculation ────────────────────────────────────────

/**
 * Calculates TDS for an invoice.
 *
 * Logic:
 *  - If vendor is TDS exempt → no TDS
 *  - Fetch vendor's cumulative payments this FY for this section
 *  - If cumulative < threshold AND (cumulative + amount) < threshold → no TDS yet
 *  - If (cumulative + amount) crosses threshold → TDS on entire cumulative+amount
 *    (Indian TDS rule: once threshold crossed, TDS applies from first rupee)
 *  - If already crossed → TDS on full invoice amount
 *
 * Returns { tdsApplicable, tdsRate, tdsAmount, netPayable }
 */
export async function calculateTDS(vendorId, invoiceAmount, sectionId, invoiceDate) {
    const amount = Number(invoiceAmount) || 0;
    const fy = getFYFromDate(invoiceDate);

    // 2a. Fetch vendor (check exemption)
    const { data: vendor } = await supabase
        .from("vendors")
        .select("tds_exempt, tds_exempt_upto, vendor_type, pan")
        .eq("id", vendorId)
        .single();

    if (vendor?.tds_exempt) {
        const exemptUpto = vendor.tds_exempt_upto ? new Date(vendor.tds_exempt_upto) : null;
        if (!exemptUpto || exemptUpto >= new Date()) {
            console.log(`Vendor ${vendorId} is TDS exempt`);
            return { tdsApplicable: false, tdsRate: 0, tdsAmount: 0, netPayable: amount };
        }
    }

    // 2b. Fetch TDS section details
    const { data: section } = await supabase
        .from("tds_sections")
        .select("*")
        .eq("id", sectionId)
        .single();

    if (!section) throw new Error(`TDS section ${sectionId} not found`);

    // 2c. Determine rate — no PAN → 20% or section rate, whichever higher
    const hasPan = Boolean(vendor?.pan);
    const vendorType = vendor?.vendor_type ?? "company";
    let rate;
    if (!hasPan) {
        rate = section.rate_no_pan; // typically 20%
    } else if (vendorType === "individual" || vendorType === "firm") {
        rate = section.rate_individual;
    } else {
        rate = section.rate_company;
    }

    // 2d. Fetch cumulative payments from ledger for this vendor/FY/section
    const { data: ledger } = await supabase
        .from("vendor_tds_ledger")
        .select("total_invoiced, total_tds_deducted, threshold_crossed")
        .eq("vendor_id", vendorId)
        .eq("financial_year", fy)
        .eq("tds_section_id", sectionId)
        .maybeSingle();

    const cumulative = ledger ? Number(ledger.total_invoiced) : 0;
    const alreadyCrossed = ledger?.threshold_crossed ?? false;
    const threshold = Number(section.threshold_aggregate) || Number(section.threshold_single) || 0;

    let tdsApplicable = false;
    let tdsAmount = 0;
    let tdsBase = 0; // amount on which TDS is calculated

    if (threshold === 0) {
        // No threshold — TDS always applies (e.g. 194J director fees, 192 salary)
        tdsApplicable = true;
        tdsBase = amount;
    } else if (alreadyCrossed) {
        // Already crossed in a previous invoice — apply TDS on full amount
        tdsApplicable = true;
        tdsBase = amount;
    } else {
        const newCumulative = cumulative + amount;
        if (newCumulative > threshold) {
            // Crosses threshold with this invoice
            // Indian rule: TDS applies on ENTIRE cumulative amount from first rupee
            tdsApplicable = true;
            tdsBase = newCumulative; // TDS on total, not just excess
            // But we've already deducted TDS on previous invoices? No — before threshold
            // no TDS was deducted, so now deduct on full cumulative
            // Subtract already-deducted (should be 0 if not crossed before)
            const alreadyDeducted = ledger ? Number(ledger.total_tds_deducted) : 0;
            tdsAmount = Math.round(((tdsBase * rate) / 100) - alreadyDeducted);
        }
        // else: still under threshold, no TDS
    }

    if (tdsApplicable && tdsAmount === 0) {
        tdsAmount = Math.round((tdsBase * rate) / 100);
    }

    const netPayable = amount - (tdsApplicable ? tdsAmount : 0);

    console.log(`TDS calc: section=${section.section}, rate=${rate}%, base=₹${tdsBase}, tds=₹${tdsAmount}, net=₹${netPayable}`);

    return {
        tdsApplicable,
        tdsRate: tdsApplicable ? rate : 0,
        tdsAmount: tdsApplicable ? tdsAmount : 0,
        netPayable,
        financialYear: fy,
        section: section.section,
    };
}

// ── 3. Update TDS Ledger ──────────────────────────────────────

/**
 * Called after an invoice is approved.
 * Updates vendor_tds_ledger with cumulative totals.
 */
export async function updateTDSLedger(vendorId, sectionId, invoiceAmount, tdsAmount, invoiceDate) {
    const fy = getFYFromDate(invoiceDate);
    const amount = Number(invoiceAmount) || 0;
    const tds = Number(tdsAmount) || 0;

    // Fetch existing ledger row
    const { data: existing } = await supabase
        .from("vendor_tds_ledger")
        .select("*")
        .eq("vendor_id", vendorId)
        .eq("financial_year", fy)
        .eq("tds_section_id", sectionId)
        .maybeSingle();

    // Fetch threshold to check if crossed
    const { data: section } = await supabase
        .from("tds_sections")
        .select("threshold_aggregate, threshold_single")
        .eq("id", sectionId)
        .single();

    const threshold = Number(section?.threshold_aggregate) || Number(section?.threshold_single) || 0;

    if (existing) {
        const newTotal = Number(existing.total_invoiced) + amount;
        const newTDS = Number(existing.total_tds_deducted) + tds;
        await supabase
            .from("vendor_tds_ledger")
            .update({
                total_invoiced: newTotal,
                total_tds_deducted: newTDS,
                invoice_count: existing.invoice_count + 1,
                threshold_crossed: threshold > 0 ? newTotal >= threshold : true,
                updated_at: new Date().toISOString(),
            })
            .eq("id", existing.id);
    } else {
        await supabase
            .from("vendor_tds_ledger")
            .insert({
                vendor_id: vendorId,
                financial_year: fy,
                tds_section_id: sectionId,
                total_invoiced: amount,
                total_tds_deducted: tds,
                invoice_count: 1,
                threshold_crossed: threshold > 0 ? amount >= threshold : true,
            });
    }

    console.log(`✓ Ledger updated for vendor ${vendorId}, FY ${fy}`);
}