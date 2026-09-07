// src/routes/invoices.js
// ─────────────────────────────────────────────────────────────
// CHANGES FROM THE ORIGINAL FILE (marked with "// CHANGED:"):
//   1. Uses extractionService.js instead of geminiService.js directly
//      → now handles images and scanned PDFs, not just clean PDFs.
//   2. Runs validateTaxType() after extraction → independently checks
//      the AI's CGST/SGST/IGST decision against GSTIN state codes,
//      and checks the math balances.
//   3. If validation flags anything, the invoice is force-flagged for
//      review (status stays "pending" with a visible reason) even if
//      the AI's own confidence score was high — a high-confidence AI
//      guess and an independently-verified fact are not the same thing.
//   4. Duplicate invoices now return a clear 409 error instead of a
//      generic 500, once the DB constraint (see migration file) exists.
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { extractInvoice } from "../services/extractionService.js"; // CHANGED
import { validateTaxType } from "../services/taxValidation.js";     // CHANGED
import { findOrCreateVendor, calculateTDS, updateTDSLedger, getFYFromDate } from "../services/vendorServices.js";
import supabase from "../config/supabase.js";
import { suggestTDSSection } from "../services/tdsSuggestionService.js";
import { checkUsageLimit, recordUsage, getUsageStatus, UsageLimitError } from "../services/usageService.js"; // NEW

const router = Router();

// ── File storage ────────────────────────────────────────────
// NEW — the uploaded file was previously only held in memory long
// enough to run extraction, then thrown away. `file_url`/`file_type`
// were never written to the DB, which is why the Review screen always
// showed "No file preview" and the "Re-run AI" button was permanently
// disabled (it's gated on `invoice.file_url` existing).
//
// This uploads the original file to a Supabase Storage bucket and
// returns a public URL to store on the invoice row.
//
// REQUIRES a bucket named "invoice-files" to exist in the Supabase
// project's Storage settings, set to Public. Create it once via:
// Supabase Dashboard → Storage → New bucket → name "invoice-files" →
// toggle "Public bucket" on. This can't be created from this codebase
// automatically — same "written but not applied" trap as a migration,
// so verify it exists before assuming this feature works.
//
// NOTE: using a public bucket is a stopgap for MVP simplicity, since
// the frontend reads invoice rows (and would need the file URL)
// directly from Supabase, not through this backend. Invoices contain
// GSTIN and financial details — before onboarding real firms, revisit
// this in favor of signed URLs generated on demand, scoped per firm
// once multi-tenancy (org_id) exists.
const STORAGE_BUCKET = "invoice-files";

async function uploadInvoiceFile(buffer, mimetype) {
  const ext = mimetype === "application/pdf" ? "pdf" : mimetype === "image/png" ? "png" : "jpg";
  const path = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, buffer, { contentType: mimetype, upsert: false });

  if (uploadErr) {
    // Don't fail the whole extraction over a storage problem (e.g. the
    // bucket not existing yet) — log loudly and continue without a
    // preview/rerun capability for this invoice, same "degrade, don't
    // crash" pattern used elsewhere in this route.
    console.error(`Storage upload failed (bucket "${STORAGE_BUCKET}" missing/misconfigured?):`, uploadErr.message);
    return { file_url: null, file_type: null };
  }

  const { data: publicUrlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return { file_url: publicUrlData?.publicUrl ?? null, file_type: mimetype };
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["application/pdf", "image/jpeg", "image/png"];
    allowed.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error("Only PDF, JPG, and PNG files are accepted."));
  },
});

// ── POST /api/extract-invoice ─────────────────────────────────
router.post("/extract-invoice", upload.single("invoice"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded. Use field name 'invoice'." });
    }

    // NEW — check the org's monthly plan limit BEFORE spending money on
    // an AI call. req.orgId is set by requireAuth middleware (index.js).
    try {
      await checkUsageLimit(req.orgId);
    } catch (err) {
      if (err instanceof UsageLimitError) {
        return res.status(402).json({ error: err.message, code: err.code }); // 402 Payment Required
      }
      throw err;
    }

    const { buffer, mimetype } = req.file;
    const source = req.body.source ?? "manual";
    // NEW — when set, this is a "Re-run AI" call from the Review screen:
    // update the existing invoice row in place instead of inserting a new
    // one. (Previously the frontend called this same endpoint, got back a
    // brand-new row, then deleted it and copied fields onto the original —
    // a workaround for this endpoint not supporting updates. Handling it
    // here is more direct and avoids a duplicate-key race against the
    // duplicate check below, since the "existing" row IS this invoice.)
    const reextractId = req.body.reextract_id ? Number(req.body.reextract_id) : null;

    // 1. Extract invoice fields via AI (now routes to text OR vision automatically)
    console.log("Step 1: Extracting invoice data...");
    const ex = await extractInvoice(buffer, mimetype);

    // 2. CHANGED — Independent, deterministic tax-type + math validation
    console.log("Step 2: Validating tax type and math...");
    const validation = validateTaxType(ex, ex._source_text || "");
    if (!validation.passed) {
      console.warn("Tax validation flags:", validation.flags.map((f) => f.code).join(", "));
    }

    // Strip the large source text before storing raw_data
    const { _source_text, ...exForStorage } = ex;

    // 3. Auto-match or create vendor
    // FIXED (this session) — findOrCreateVendor(extracted, orgId) requires
    // orgId to scope both matching and creation to the current firm; it
    // was never being passed here, so every call ran with orgId = undefined.
    // Consequence: vendor MATCHING never worked (org_id = undefined never
    // matches a real UUID), so every upload created a brand-new vendor
    // row instead of reusing an existing one — and every new vendor row
    // got org_id = NULL (Supabase's JS client silently drops undefined-
    // valued keys from an insert payload, so the column was just omitted
    // rather than erroring). This went unnoticed because the backend's
    // service-role key bypasses RLS, so the bad NULL inserts never got
    // blocked. See migration 2002605300009 for the backfill of vendor
    // rows already created this way.
    console.log("Step 3: Matching vendor...");
    const { vendor, isNew } = await findOrCreateVendor(exForStorage, req.orgId);

    // 3.5 NEW — AI suggests a TDS section (human still confirms at approval time)
    console.log("Step 3.5: Suggesting TDS section...");
    const tdsSuggestion = await suggestTDSSection(exForStorage);

    // 3.6 NEW — store the original file so the Review screen can show a
    // preview and "Re-run AI" has something to re-fetch. See
    // uploadInvoiceFile() above for the required Supabase Storage setup.
    console.log("Step 3.6: Uploading file to storage...");
    const { file_url, file_type } = await uploadInvoiceFile(buffer, mimetype);

    // 4. Build invoice record (no TDS yet — finance team picks section on review)
    const fy = getFYFromDate(exForStorage.invoice_date);

    // CHANGED — if the model's own confidence was high but our independent
    // check found a problem, don't let the high AI confidence silently win.
    // We store both, and force needs_review when validation fails.
    const forcedReview = !validation.passed;

    const record = {
      org_id: req.orgId,
      // Core
      vendor_id: vendor.id,
      vendor_name: exForStorage.vendor_name ?? null,
      vendor_gstin: exForStorage.vendor_gstin ?? null,
      buyer_gstin: exForStorage.buyer_gstin ?? null,
      amount: exForStorage.amount != null ? Number(exForStorage.amount) : null,
      taxable_amount: exForStorage.taxable_amount != null ? Number(exForStorage.taxable_amount) : null,
      invoice_date: exForStorage.invoice_date ?? null,
      invoice_number: ex.invoice_number ?? null,
      financial_year: fy,

      // GST
      gst_number: exForStorage.vendor_gstin ?? null,
      cgst: exForStorage.cgst != null ? Number(exForStorage.cgst) : null,
      sgst: exForStorage.sgst != null ? Number(exForStorage.sgst) : null,
      igst: exForStorage.igst != null ? Number(exForStorage.igst) : null,
      gst_rate: exForStorage.gst_rate != null ? Number(exForStorage.gst_rate) : null,
      is_igst: exForStorage.is_igst ?? null,
      place_of_supply: exForStorage.place_of_supply ?? null,
      hsn_sac: exForStorage.hsn_sac ?? null,
      description: exForStorage.description ?? null,
      line_items: exForStorage.line_items ?? null,

      // TDS — not calculated yet, set after review
      tds_applicable: false,
      tds_rate: null,
      tds_amount: null,
      net_payable: exForStorage.amount != null ? Number(exForStorage.amount) : null,
      suggested_tds_section_id: tdsSuggestion.suggested_section_id,   // NEW
      suggested_tds_reasoning: tdsSuggestion.reasoning,

      // File
      file_url,   // NEW
      file_type,  // NEW

      // Meta
      confidence_score: exForStorage.confidence_score != null ? Number(exForStorage.confidence_score) : null,
      extraction_method: ex.extraction_method ?? null, // CHANGED — records which model path was used
      source,
      status: "pending",
      payment_status: "unpaid",
      // CHANGED — needs_review now also fires on low AI self-reported
      // confidence (<90%), not just failed deterministic validation.
      // Confidence here is the model's own guess at how sure it is,
      // not a computed metric — so a below-90% self-report is worth a
      // human's attention even when nothing else flagged.
      needs_review: forcedReview || (exForStorage.confidence_score != null && Number(exForStorage.confidence_score) < 0.9),
      validation_flags: validation.flags,                // CHANGED — stored so the Review UI can show *why*
      raw_data: ex,
    };

    // 4.5 NEW — duplicate check at the application layer, not just the
    // DB constraint. Defense-in-depth: the migration that adds the
    // UNIQUE index (2002605300002, later redefined per-org in 2002605300006)
    // has to actually be *run* against the live Supabase project to take
    // effect — per CLAUDE.md, this repo has a history of a migration file
    // existing but never being applied, silently leaving the bug live.
    // This check works regardless of whether that index exists yet, and
    // also lets "Re-run AI" (which re-submits the same
    // invoice_number/vendor_gstin for an existing row) exclude itself
    // instead of flagging as its own duplicate.
    //
    // FIXED (this session) — this query was missing an org_id filter,
    // so it was checking for duplicates GLOBALLY across every firm using
    // the app, not just within the current org. Two unrelated firms
    // sharing a vendor (common — the same electrician, IT vendor, SaaS
    // subscription, etc.) with coincidentally matching invoice numbers
    // would have the second firm's genuinely distinct invoice wrongly
    // rejected. The DB-level unique index was already correctly scoped
    // per-org in migration 2002605300006 (idx_unique_invoice_per_org_vendor
    // on (org_id, vendor_gstin, invoice_number)) — this app-layer
    // pre-check just hadn't been updated to match it.
    if (record.vendor_gstin && record.invoice_number) {
      let dupQuery = supabase
        .from("invoices")
        .select("id")
        .eq("org_id", req.orgId)
        .eq("vendor_gstin", record.vendor_gstin)
        .eq("invoice_number", record.invoice_number);
      if (reextractId) dupQuery = dupQuery.neq("id", reextractId);

      const { data: dupes, error: dupErr } = await dupQuery.limit(1);
      if (dupErr) console.warn("Duplicate pre-check failed (continuing, DB constraint is the fallback):", dupErr.message);
      if (dupes && dupes.length > 0) {
        return res.status(409).json({
          error: "This invoice has already been uploaded (same vendor + invoice number).",
        });
      }
    }

    // 5. Insert (or, for a re-run, update the existing row in place)
    console.log(reextractId ? "Step 4: Updating existing invoice..." : "Step 4: Saving to database...");
    console.time("supabase-write");

    const { data, error } = reextractId
      ? await supabase.from("invoices").update(record).eq("id", reextractId).select().single()
      : await supabase.from("invoices").insert([record]).select().single();

    console.timeEnd("supabase-write");
    if (error) {
      // CHANGED — duplicate invoice now gets a clear, specific error
      // once the UNIQUE constraint from the migration file is in place.
      // (Kept as a second layer behind the pre-check above, in case of
      // a race between two near-simultaneous uploads.)
      if (error.code === "23505") {
        return res.status(409).json({
          error: "This invoice has already been uploaded (same vendor + invoice number).",
          details: error.message,
        });
      }
      console.error("Supabase write error:", error);
      // CHANGED — lead with the actual database error, not a generic
      // wrapper. "Failed to save invoice." tells you nothing; the
      // Postgres message (e.g. a constraint violation, a bad column
      // type) tells you exactly what to fix.
      return res.status(500).json({
        error: `Failed to save invoice: ${error.message}`,
        code: error.code ?? null,
      });
    }

    // NEW — count this against the org's monthly usage (skip on a
    // re-run — that's re-processing an existing invoice, not a new one)
    if (!reextractId) {
      await recordUsage(req.orgId, req.file.size);
    }

    return res.status(reextractId ? 200 : 201).json({
      ...data,
      vendor,
      vendorIsNew: isNew,
      validation, // CHANGED — frontend can show the specific flags immediately
    });

  } catch (err) {
    console.error("Extract invoice error:", err);
    return res.status(500).json({ error: err.message ?? "Unexpected server error." });
  }
});


// ── PATCH /api/invoices/:id/approve ──────────────────────────
// Called when finance team clicks Approve.
// Body: { tds_section_id?: number, reviewed_by?: string }
router.patch("/invoices/:id/approve", async (req, res) => {
  try {
    const { id } = req.params;
    const { tds_section_id, reviewed_by } = req.body;

    // Fetch the invoice
    const { data: invoice, error: fetchErr } = await supabase
      .from("invoices")
      .select("*")
      .eq("id", id)
      .eq("org_id", req.orgId)
      .single();

    if (fetchErr || !invoice) {
      return res.status(404).json({ error: "Invoice not found." });
    }

    let tdsResult = {
      tdsApplicable: false,
      tdsRate: 0,
      tdsAmount: 0,
      netPayable: Number(invoice.amount) || 0,
    };

    // Calculate TDS if section is provided and vendor is linked
    if (tds_section_id && invoice.vendor_id) {
      tdsResult = await calculateTDS(
        invoice.vendor_id,
        invoice.amount,
        tds_section_id,
        invoice.invoice_date
      );
    }

    // Update invoice to approved
    const { data: updated, error: updateErr } = await supabase
      .from("invoices")
      .update({
        status: "approved",
        reviewed_at: new Date().toISOString(),
        reviewed_by: reviewed_by ?? null,
        tds_section_id: tds_section_id ?? null,
        tds_applicable: tdsResult.tdsApplicable,
        tds_rate: tdsResult.tdsRate,
        tds_amount: tdsResult.tdsAmount,
        net_payable: tdsResult.netPayable,
      })
      .eq("id", id)
      .select()
      .single();

    if (updateErr) {
      return res.status(500).json({ error: "Failed to approve invoice.", details: updateErr.message });
    }

    // Update vendor TDS ledger
    if (tds_section_id && invoice.vendor_id) {
      await updateTDSLedger(
        invoice.vendor_id,
        tds_section_id,
        invoice.amount,
        tdsResult.tdsAmount,
        invoice.invoice_date
      );
    }

    return res.json({ ...updated, tdsResult });

  } catch (err) {
    console.error("Approve error:", err);
    return res.status(500).json({ error: err.message });
  }
});


// ── PATCH /api/invoices/:id/reject ───────────────────────────
router.patch("/invoices/:id/reject", async (req, res) => {
  try {
    const { id } = req.params;
    const { reviewed_by, reason } = req.body;

    const { data, error } = await supabase
      .from("invoices")
      .update({
        status: "rejected",
        reviewed_at: new Date().toISOString(),
        reviewed_by: reviewed_by ?? null,
        notes: reason ?? null,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});


// ── GET /api/invoices ─────────────────────────────────────────
// Query params: status, vendor_id, financial_year, from, to
router.get("/invoices", async (req, res) => {
  try {
    const { status, vendor_id, financial_year, from, to, limit = 50, offset = 0 } = req.query;

    let query = supabase
      .from("invoices")
      .select("*, vendors(company_name, gstin, pan, vendor_type)", { count: "exact" })
      .eq("org_id", req.orgId)
      .order("created_at", { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (status) query = query.eq("status", status);
    if (vendor_id) query = query.eq("vendor_id", vendor_id);
    if (financial_year) query = query.eq("financial_year", financial_year);
    if (from) query = query.gte("invoice_date", from);
    if (to) query = query.lte("invoice_date", to);

    const { data, error, count } = await query;
    if (error) return res.status(500).json({ error: error.message });

    return res.json({ invoices: data, total: count });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});


// ── GET /api/invoices/:id ─────────────────────────────────────
router.get("/invoices/:id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("invoices")
      // CHANGED — disambiguated tds_sections(*) with the !tds_section_id
      // hint. Required as of migration 2002605300011: once both
      // tds_section_id and suggested_tds_section_id became real foreign
      // keys to tds_sections, an unqualified tds_sections(*) embed is
      // ambiguous to PostgREST (it doesn't know which column to join
      // through) and throws "more than one relationship was found".
      // This embeds through the finalized/approved section specifically
      // — what this endpoint is actually meant to show — not the AI's
      // suggestion.
      .select("*, vendors(*), tds_sections!tds_section_id(*)")
      .eq("id", req.params.id)
      .eq("org_id", req.orgId)
      .single();

    if (error) return res.status(404).json({ error: "Invoice not found." });
    return res.json(data);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/usage ─────────────────────────────────────────────
// NEW — powers the "42/50 invoices used this month" indicator on the
// frontend, and is what the Upload page should check before letting
// someone add more files to the queue.
router.get("/usage", async (req, res) => {
  try {
    const status = await getUsageStatus(req.orgId);
    return res.json(status);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;