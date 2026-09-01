// src/services/geminiService.js
import Groq from "groq-sdk";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

const EXTRACT_PROMPT = `You are an Indian GST invoice data extractor.
Return ONLY valid JSON, no markdown, no explanation, no code blocks.

The invoice text below was extracted from a PDF and its table layout may
be flattened out of visual order — GSTIN, PAN, and address lines for the
BUYER and the VENDOR can appear interleaved or in reverse order. Determine
which GSTIN belongs to which party by CONTEXT, not by which one appears
first in the text.

- vendor_gstin belongs to the party SELLING/SUPPLYING and RAISING this
  invoice. Look near "Billing Information", "Supplier Information",
  "Billed From", or the company name in the header/logo — NOT near
  "Bill To", "Ship To", "Customer Details", or "Recipient".
- buyer_gstin belongs to the party being BILLED — look near "Bill To",
  "Customer Details", "Recipient Information", "Billed To".
- If a "Supplier State Code" is present, vendor_gstin's first 2 digits
  MUST match it. If a "Recipient State Code" is present, buyer_gstin's
  first 2 digits MUST match it. Cross-check before finalizing — if your
  first guess doesn't match the stated state code, re-read and correct it.

Fields to extract:
- vendor_name: string (supplier/seller company name — issuer of the invoice, NOT the "Bill To" party)
- vendor_gstin: string (supplier GST number, 15 chars — see rules above)
- buyer_gstin: string (recipient GST number, 15 chars — see rules above)
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

export async function extractPdfText(fileBuffer) {
  const loadingTask = getDocument({ data: new Uint8Array(fileBuffer) });
  const pdfDoc = await loadingTask.promise;
  const pages = [];

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const content = await page.getTextContent();

    // pdf.js returns items in internal content-stream order, which for
    // multi-column layouts (e.g. "Bill To" | "Invoice" | "Supplier Info"
    // side by side) frequently does NOT match visual reading order —
    // this was the root cause of vendor/buyer GSTIN swaps. Reconstruct
    // proper top-to-bottom, left-to-right order using each item's
    // actual x/y position instead.
    const rows = new Map(); // rounded y -> [{x, str}]
    for (const item of content.items) {
      const x = item.transform[4];
      const y = Math.round(item.transform[5]); // bucket by row
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x, str: item.str });
    }

    // PDF y-coordinates increase upward, so sort descending for top-to-bottom
    const sortedYs = [...rows.keys()].sort((a, b) => b - a);
    const lines = sortedYs.map((y) =>
      rows
        .get(y)
        .sort((a, b) => a.x - b.x) // left-to-right within the row
        .map((it) => it.str)
        .join(" ")
    );

    pages.push(lines.join("\n"));
  }

  const textContent = pages.join("\n\n");
  console.log(`PDF text layer extracted (${textContent.length} chars)`);
  return textContent;
}

export async function extractInvoiceFromText(textContent) {
  console.log("Calling Groq API (text extraction)...");

  const response = await client.chat.completions.create({
    model: "openai/gpt-oss-120b",
    max_tokens: 4096,
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

  const choice = response.choices[0];
  const content = choice?.message?.content;
  if (!content) throw new Error("No content returned from Groq");

  if (choice.finish_reason === "length") {
    throw new Error(
      `Groq response was truncated (hit max_tokens). Invoice text may be unusually long — consider raising max_tokens further or summarizing line_items.`
    );
  }

  const cleaned = content
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    console.log(`✓ Groq success: ${parsed.vendor_name} | ₹${parsed.amount}`);
    // NEW: attach the raw source text (not a real invoice field) so downstream
    // validation can cross-check GSTIN state codes against literal text labels.
    // Strip this before persisting `raw_data` to the DB — see invoices.js.
    parsed._source_text = textContent;
    return parsed;
  } catch {
    throw new Error(`Failed to parse JSON: ${content}`);
  }
}

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