// src/services/geminiService.js
// ─────────────────────────────────────────────────────────────
// NOTE ON THE FILENAME: despite the name, this file talks to GROQ
// (Llama 3.3 70B), not Gemini — that was a naming mistake from an
// earlier version. Kept as-is here to avoid breaking any existing
// imports elsewhere in the project; consider renaming to
// `groqTextService.js` in your own repo when convenient.
//
// Handles CLEAN, TEXT-BASED PDFs only (has a real text layer, e.g.
// a digitally-generated invoice). For photos/scans, see
// visionService.js + extractionService.js.
// ─────────────────────────────────────────────────────────────

import Groq from "groq-sdk";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

const EXTRACT_PROMPT = `You are an Indian GST invoice data extractor.
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
- confidence_score: number between 0 and 1

Return null for missing fields. Never guess.`;

/**
 * Pulls the raw text layer out of a PDF. Returns an empty/short string
 * for scanned PDFs that have no real text layer (just an image of a page).
 */
export async function extractPdfText(fileBuffer) {
  const loadingTask = getDocument({ data: new Uint8Array(fileBuffer) });
  const pdfDoc = await loadingTask.promise;
  const pages = [];
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str).join(" "));
  }
  const textContent = pages.join("\n");
  console.log(`PDF text layer extracted (${textContent.length} chars)`);
  return textContent;
}

/**
 * Sends already-extracted invoice text to Groq (Llama 3.3 70B) for
 * structured extraction. This is the cheap, fast path — use it only
 * when extractPdfText() returned meaningful text (see extractionService.js
 * for the threshold check).
 */
export async function extractInvoiceFromText(textContent) {
  console.log("Calling Groq API (text extraction)...");

  const response = await client.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    max_tokens: 1024,
    temperature: 0,
    messages: [
      {
        role: "system",
        content: "You are a precise invoice data extractor. Always return only valid JSON with no extra text.",
      },
      {
        role: "user",
        content: `${EXTRACT_PROMPT}\n\nInvoice text:\n\n${textContent}`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("No content returned from Groq");

  const cleaned = content
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    console.log(`✓ Groq success: ${parsed.vendor_name} | ₹${parsed.amount}`);
    return parsed;
  } catch {
    throw new Error(`Failed to parse JSON: ${content}`);
  }
}

/**
 * Kept for backward compatibility with any code still calling the old
 * combined function directly. New code should use extractionService.js
 * instead, which also handles images/scans.
 */
export async function extractInvoice(fileBuffer, mimeType) {
  if (mimeType !== "application/pdf") {
    throw new Error("Only PDF invoices supported by this function. Use extractionService.js for images.");
  }
  const textContent = await extractPdfText(fileBuffer);
  if (!textContent) {
    throw new Error("Only PDF invoices supported. Please upload a PDF.");
  }
  return extractInvoiceFromText(textContent);
}
