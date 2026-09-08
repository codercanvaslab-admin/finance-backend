// src/services/visionService.js
// ─────────────────────────────────────────────────────────────
// Handles invoices that DON'T have a clean text layer:
//   - Photographed invoices (JPG/PNG from WhatsApp, phone camera)
//   - Scanned PDFs (no embedded text, just a picture of a page)
//
// Uses Gemini's vision capability — it reads the image directly,
// the same way a human would look at a photo of a bill.
//
// This is a NEW file. It does not replace geminiService.js (which
// still handles clean, text-based PDFs cheaply via Groq) — see
// extractionService.js for how the two are combined.
//
// CHANGED — model deprecation found this session, same class of
// issue as the Groq one in §5/§8j: "gemini-2.5-flash" was hardcoded
// here and is no longer available to new API keys/projects (Google
// points new users at gemini-3.6-flash instead — existing
// grandfathered keys may still work on 2.5-flash for a while, but
// new ones get a 404 immediately). Moved the model name into a
// GEMINI_MODEL env var (defaulting to the current gemini-3.6-flash)
// so the next Gemini-side deprecation is a Railway variable change,
// not an emergency code deploy.
// ─────────────────────────────────────────────────────────────

import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

// Same field list as geminiService.js's EXTRACT_PROMPT, kept identical
// on purpose — both paths must return the exact same shape so the rest
// of the pipeline (vendorServices.js, invoices.js) doesn't care which
// model produced the data.
const EXTRACT_PROMPT = `You are an Indian GST invoice data extractor.
Look at this invoice image carefully — it may be a phone photo, a scan,
or a screenshot, and may be slightly angled, blurry, or have handwritten
notes on it. Extract only what is clearly visible; do not guess.

Return ONLY valid JSON, no markdown, no explanation, no code blocks.

Fields to extract:
- vendor_name: string (supplier/seller company name)
- vendor_gstin: string (supplier GST number, 15 chars)
- buyer_gstin: string (recipient GST number, 15 chars)
- amount: number (final total invoice value including all taxes)
- taxable_amount: number (amount before GST)
- cgst: number or null
- sgst: number or null
- igst: number or null
- gst_rate: number (percentage e.g. 18)
- invoice_date: string (YYYY-MM-DD format)
- invoice_number: string
- hsn_sac: string (HSN or SAC code)
- description: string (item or service description)
- line_items: array of {description, hsn_sac, qty, unit_price, cgst, sgst, igst, total}
- place_of_supply: string
- is_igst: boolean
- tds_note: string or null (NEW — many Indian service invoices print a
  disclaimer directly on the invoice like "Tax may be deducted at Source
  (TDS) @ 10% or 2% under 194J/194C" or "TDS as applicable u/s 194C shall
  be deducted". Capture that sentence verbatim if present anywhere on the
  invoice — it's usually near the totals or bank details, separate from
  the line-item description. This is the single strongest signal for TDS
  classification when the vendor has stated it themselves; return null if
  no such note is visible, don't infer or paraphrase one.)
- confidence_score: number between 0 and 1 (LOWER this if the image was
  hard to read — blurry, angled, handwritten, poor lighting — even if
  you were able to extract most fields. This score drives whether a
  human reviews this invoice, so be honest, not optimistic.)

Return null for any field that is not clearly legible. Never guess a
number you cannot actually read on the page.`;

/**
 * Extracts invoice data from an image (JPG/PNG) or a scanned PDF page
 * that's been rasterized to an image, using Gemini's vision (model configurable via GEMINI_MODEL).
 *
 * @param {Buffer} imageBuffer - raw image bytes
 * @param {string} mimeType - "image/jpeg" or "image/png"
 * @returns {Promise<object>} same shape as geminiService.js's extractInvoice()
 */
export async function extractInvoiceFromImage(imageBuffer, mimeType) {
  console.log(`Calling Gemini (vision, model: ${GEMINI_MODEL}) for image/scanned invoice...`);

  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

  const imagePart = {
    inlineData: {
      data: imageBuffer.toString("base64"),
      mimeType,
    },
  };

  const result = await model.generateContent([EXTRACT_PROMPT, imagePart]);
  const content = result.response.text();

  if (!content) throw new Error("No content returned from Gemini");

  const cleaned = content
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    console.log(`✓ Gemini vision success: ${parsed.vendor_name} | ₹${parsed.amount} | confidence ${parsed.confidence_score}`);
    return parsed;
  } catch {
    throw new Error(`Failed to parse Gemini JSON: ${content}`);
  }
}