// src/services/extractionService.js
// ─────────────────────────────────────────────────────────────
// This is the single function routes/invoices.js should call now,
// instead of calling geminiService.js's extractInvoice() directly.
//
// Decision logic (cheap-first, escalate-on-failure — see the Tech
// Stack doc):
//   1. If the upload is already an image (JPG/PNG) → straight to
//      Gemini vision (visionService.js). No cheaper path exists for
//      a photo.
//   2. If the upload is a PDF → try pulling its text layer first
//      (cheap, fast, Groq). If that text layer is empty or too short
//      to be a real invoice (a strong signal it's a SCANNED PDF —
//      just a picture of a page saved as .pdf), rasterize page 1 to
//      an image and fall back to Gemini vision.
//
// This directly closes the gap flagged earlier: "can't yet handle
// the exact messy, photographed invoices" — scanned/photographed
// invoices now get routed to the model that can actually read them.
// ─────────────────────────────────────────────────────────────

import { extractPdfText, extractInvoiceFromText } from "./geminiService.js";
import { extractInvoiceFromImage } from "./visionService.js";
import { pdfToPng } from "pdf-to-png-converter";

// Below this many characters, we treat the PDF as having no usable
// text layer (i.e. it's a scan/photo saved as PDF, not a digital one).
const MIN_TEXT_LENGTH_FOR_TEXT_PATH = 40;

export async function extractInvoice(fileBuffer, mimeType) {
  // ── Case 1: Direct image upload (WhatsApp/phone photo) ──────
  if (mimeType === "image/jpeg" || mimeType === "image/png") {
    const result = await extractInvoiceFromImage(fileBuffer, mimeType);
    return { ...result, extraction_method: "gemini_vision" };
  }

  // ── Case 2: PDF — try the cheap text path first ─────────────
  if (mimeType === "application/pdf") {
    let textContent = "";
    try {
      textContent = await extractPdfText(fileBuffer);
    } catch (err) {
      console.warn(`PDF text extraction failed (${err.message}), falling back to vision`);
    }

    if (textContent && textContent.trim().length >= MIN_TEXT_LENGTH_FOR_TEXT_PATH) {
      const result = await extractInvoiceFromText(textContent);
      return { ...result, extraction_method: "groq_text" };
    }

    // ── Case 2b: No usable text layer → this is a scanned PDF ──
    console.log("PDF has little/no text layer — treating as scanned, rasterizing page 1...");
    const pages = await pdfToPng(fileBuffer, { pagesToProcess: [1], viewportScale: 2.0 });
    if (!pages.length) {
      throw new Error("Could not rasterize scanned PDF for vision extraction.");
    }
    const result = await extractInvoiceFromImage(pages[0].content, "image/png");
    return { ...result, extraction_method: "gemini_vision_from_scanned_pdf" };
  }

  throw new Error(`Unsupported file type: ${mimeType}`);
}
