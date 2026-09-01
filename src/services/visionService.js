// src/services/visionService.js
// ─────────────────────────────────────────────────────────────
// Handles invoices that DON'T have a clean text layer:
//   - Photographed invoices (JPG/PNG from WhatsApp, phone camera)
//   - Scanned PDFs (no embedded text, just a picture of a page)
//
// Uses Gemini 2.5 Flash's vision capability — it reads the image
// directly, the same way a human would look at a photo of a bill.
//
// This is a NEW file. It does not replace geminiService.js (which
// still handles clean, text-based PDFs cheaply via Groq) — see
// extractionService.js for how the two are combined.
// ─────────────────────────────────────────────────────────────

import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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
- confidence_score: number between 0 and 1 (LOWER this if the image was
  hard to read — blurry, angled, handwritten, poor lighting — even if
  you were able to extract most fields. This score drives whether a
  human reviews this invoice, so be honest, not optimistic.)

Return null for any field that is not clearly legible. Never guess a
number you cannot actually read on the page.`;

/**
 * Extracts invoice data from an image (JPG/PNG) or a scanned PDF page
 * that's been rasterized to an image, using Gemini 2.5 Flash's vision.
 *
 * @param {Buffer} imageBuffer - raw image bytes
 * @param {string} mimeType - "image/jpeg" or "image/png"
 * @returns {Promise<object>} same shape as geminiService.js's extractInvoice()
 */
export async function extractInvoiceFromImage(imageBuffer, mimeType) {
  console.log("Calling Gemini 2.5 Flash (vision) for image/scanned invoice...");

  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

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
