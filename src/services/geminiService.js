import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const EXTRACTION_PROMPT = `Return ONLY valid JSON, no markdown, no explanation. Fields:
- vendor_name (string)
- amount (number)
- invoice_date (YYYY-MM-DD)
- gst_number (string or null)
- line_items (array of { description, qty, unit_price, total })
- confidence (0 to 1)

Return null for missing fields.`;

/**
 * Extract structured invoice data from a file buffer using Gemini Flash 1.5.
 * @param {Buffer} fileBuffer - The raw file bytes
 * @param {string} mimeType   - e.g. "application/pdf", "image/jpeg", "image/png"
 * @returns {Promise<Object>} Parsed invoice JSON
 */
export async function extractInvoice(fileBuffer, mimeType) {
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const filePart = {
    inlineData: {
      data: fileBuffer.toString("base64"),
      mimeType,
    },
  };

  const result = await model.generateContent([EXTRACTION_PROMPT, filePart]);
  const text = result.response.text();

  // Strip any accidental markdown fences before parsing
  const clean = text.replace(/```json|```/gi, "").trim();

  const parsed = JSON.parse(clean);
  return parsed;
}
