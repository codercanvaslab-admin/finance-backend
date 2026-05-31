// src/routes/invoices.js
// ─────────────────────────────────────────────────────────────
// POST /api/extract-invoice  — extract + auto-match vendor + calculate TDS
// PATCH /api/invoices/:id/approve — approve + update TDS ledger
// PATCH /api/invoices/:id/reject  — reject invoice
// GET   /api/invoices             — list invoices with filters
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import multer from "multer";
import { extractInvoice } from "../services/geminiService.js";
import { findOrCreateVendor, calculateTDS, updateTDSLedger, getFYFromDate } from "../services/vendorService.js";
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

    // 1. Extract invoice fields via AI
    console.log("Step 1: Extracting invoice data...");
    const ex = await extractInvoice(buffer, mimetype);

    // 2. Auto-match or create vendor
    console.log("Step 2: Matching vendor...");
    const { vendor, isNew } = await findOrCreateVendor(ex);

    // 3. Build invoice record (no TDS yet — finance team picks section on review)
    const fy = getFYFromDate(ex.invoice_date);

    const record = {
      // Core
      vendor_id: vendor.id,
      vendor_name: ex.vendor_name ?? null,
      vendor_gstin: ex.vendor_gstin ?? null,
      buyer_gstin: ex.buyer_gstin ?? null,
      amount: ex.amount != null ? Number(ex.amount) : null,
      taxable_amount: ex.taxable_amount != null ? Number(ex.taxable_amount) : null,
      invoice_date: ex.invoice_date ?? null,
      invoice_number: ex.invoice_number ?? null,
      financial_year: fy,

      // GST
      gst_number: ex.vendor_gstin ?? null,
      cgst: ex.cgst != null ? Number(ex.cgst) : null,
      sgst: ex.sgst != null ? Number(ex.sgst) : null,
      igst: ex.igst != null ? Number(ex.igst) : null,
      gst_rate: ex.gst_rate != null ? Number(ex.gst_rate) : null,
      is_igst: ex.is_igst ?? null,
      place_of_supply: ex.place_of_supply ?? null,
      hsn_sac: ex.hsn_sac ?? null,
      description: ex.description ?? null,
      line_items: ex.line_items ?? null,

      // TDS — not calculated yet, set after review
      tds_applicable: false,
      tds_rate: null,
      tds_amount: null,
      net_payable: ex.amount != null ? Number(ex.amount) : null,

      // Meta
      confidence_score: ex.confidence != null ? Number(ex.confidence) : null,
      source,
      status: "pending",
      payment_status: "unpaid",
      raw_data: ex,
    };

    // 4. Insert invoice
    console.log("Step 3: Saving to database...");
    const { data, error } = await supabase
      .from("invoices")
      .insert([record])
      .select()
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      return res.status(500).json({ error: "Failed to save invoice.", details: error.message });
    }

    return res.status(201).json({
      ...data,
      vendor,
      vendorIsNew: isNew,
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
