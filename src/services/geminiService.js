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

export async function extractInvoice(fileBuffer, mimeType) {
  let textContent = null;

  // Extract text from PDF
  if (mimeType === "application/pdf") {
    try {
      const loadingTask = getDocument({ data: new Uint8Array(fileBuffer) });
      const pdfDoc = await loadingTask.promise;
      const pages = [];
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const content = await page.getTextContent();
        pages.push(content.items.map((item) => item.str).join(" "));
      }
      textContent = pages.join("\n");
      console.log(`✓ PDF text extracted (${textContent.length} chars)`);
    } catch (err) {
      throw new Error(`PDF text extraction failed: ${err.message}`);
    }
  }

  if (!textContent) {
    throw new Error("Only PDF invoices supported. Please upload a PDF.");
  }

  console.log("Calling Groq API...");

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
    console.log(`✓ Success: ${parsed.vendor_name} | ₹${parsed.amount}`);
    return parsed;
  } catch {
    throw new Error(`Failed to parse JSON: ${content}`);
  }
}