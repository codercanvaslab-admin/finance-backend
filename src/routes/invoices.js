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
import { extractInvoice } from "../services/extractionService.js"; // CHANGED
import { validateTaxType } from "../services/taxValidation.js";     // CHANGED
import { findOrCreateVendor, calculateTDS, updateTDSLedger, getFYFromDate } from "../services/vendorServices.js";
import supabase from "../config/supabase.js";

const router = Router();

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

    const { buffer, mimetype } = req.file;
    const source = req.body.source ?? "manual";

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
    console.log("Step 3: Matching vendor...");
    const { vendor, isNew } = await findOrCreateVendor(exForStorage);

    // 4. Build invoice record (no TDS yet — finance team picks section on review)
    const fy = getFYFromDate(exForStorage.invoice_date);

    // CHANGED — if the model's own confidence was high but our independent
    // check found a problem, don't let the high AI confidence silently win.
    // We store both, and force needs_review when validation fails.
    const forcedReview = !validation.passed;

    const record = {
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

      // Meta
      confidence_score: exForStorage.confidence_score != null ? Number(exForStorage.confidence_score) : null,
      extraction_method: ex.extraction_method ?? null, // CHANGED — records which model path was used
      source,
      status: "pending",
      payment_status: "unpaid",
      needs_review: forcedReview,                       // CHANGED
      validation_flags: validation.flags,                // CHANGED — stored so the Review UI can show *why*
      raw_data: ex,
    };

    // 5. Insert invoice
    console.log("Step 4: Saving to database...");
    console.time("supabase-insert");

    const { data, error } = await supabase
      .from("invoices")
      .insert([record])
      .select()
      .single();
    console.timeEnd("supabase-insert");
    if (error) {
      // CHANGED — duplicate invoice now gets a clear, specific error
      // once the UNIQUE constraint from the migration file is in place.
      if (error.code === "23505") {
        return res.status(409).json({
          error: "This invoice has already been uploaded (same vendor + invoice number).",
          details: error.message,
        });
      }
      console.error("Supabase insert error:", error);
      return res.status(500).json({ error: "Failed to save invoice.", details: error.message });
    }

    return res.status(201).json({
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
      .select("*, vendors(*), tds_sections(*)")
      .eq("id", req.params.id)
      .single();

    if (error) return res.status(404).json({ error: "Invoice not found." });
    return res.json(data);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});


export default router;
