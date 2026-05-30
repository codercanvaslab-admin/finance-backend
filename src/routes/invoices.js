import { Router } from "express";
import multer from "multer";
import { extractInvoice } from "../services/geminiService.js";
import supabase from "../config/supabase.js";

const router = Router();

// Store file in memory so we can forward the buffer to Gemini
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB max
  fileFilter: (_req, file, cb) => {
    const allowed = ["application/pdf", "image/jpeg", "image/png"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF, JPG, and PNG files are accepted."));
    }
  },
});

/**
 * POST /extract-invoice
 * Accepts a multipart upload field named "invoice".
 * Extracts structured data with Gemini and persists it to Supabase.
 */
router.post("/extract-invoice", upload.single("invoice"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded. Use field name 'invoice'." });
    }

    const { buffer, mimetype, originalname, size } = req.file;

    // 1. Extract invoice fields using Gemini
    const invoiceData = await extractInvoice(buffer, mimetype);

    // 2. Build the record to persist
    const record = {
      ...invoiceData,
      original_filename: originalname,
      file_size_bytes: size,
      mime_type: mimetype,
      status: "pending",
    };

    // 3. Insert into Supabase
    const { data, error } = await supabase
      .from("invoices")
      .insert([record])
      .select()
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      return res.status(500).json({ error: "Failed to save invoice to database.", details: error.message });
    }

    return res.status(201).json(data);
  } catch (err) {
    console.error("Extract invoice error:", err);

    if (err instanceof SyntaxError) {
      return res.status(502).json({ error: "Gemini returned non-JSON output. Try again." });
    }

    return res.status(500).json({ error: err.message ?? "Unexpected server error." });
  }
});

export default router;
