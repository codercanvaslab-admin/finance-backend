// src/services/tdsSuggestionService.js
// ─────────────────────────────────────────────────────────────
// AI SUGGESTS, HUMAN CONFIRMS — this does NOT auto-apply TDS.
// It only pre-fills the dropdown with a best guess + a one-line
// reason, so the reviewer clicks once to accept, or picks a
// different section if the AI got it wrong. The actual approval
// (and the TDS calculation itself) still requires a human clicking
// Approve — nothing here writes tds_amount or changes invoice status.
//
// This is a small, cheap, text-only call (not vision) — same
// pattern as the existing ledger-suggestion idea from the Tech
// Stack doc. Uses Groq since this is lightweight reasoning over a
// short text description, not reading an image.
// ─────────────────────────────────────────────────────────────

import Groq from "groq-sdk";
import supabase from "../config/supabase.js";

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

/**
 * @param {object} invoice - the extracted invoice fields (needs description, line_items)
 * @returns {Promise<{suggested_section_id: number|null, suggested_section_label: string|null, reasoning: string|null}>}
 */
export async function suggestTDSSection(invoice) {
  // 1. Fetch the current, active list of TDS sections from the DB —
  //    this is the same server-driven table the dropdown reads from
  //    (Bug #4's fix), so the AI is never suggesting a section that
  //    doesn't actually exist or is out of date.
  const { data: sections, error } = await supabase
    .from("tds_sections")
    .select("id, section, sub_type, nature_of_payment")
    .eq("is_active", true);

  if (error || !sections || sections.length === 0) {
    console.warn("Could not load TDS sections for AI suggestion:", error?.message);
    return { suggested_section_id: null, suggested_section_label: null, reasoning: null };
  }

  const description = invoice.description || "";
  const lineItemDescriptions = (invoice.line_items || [])
    .map((li) => li.description)
    .filter(Boolean)
    .join("; ");

  const hsnSac = invoice.hsn_sac || null;
  const textToClassify = [description, lineItemDescriptions].filter(Boolean).join(". ");

  const hsnContext = hsnSac
    ? `\nHSN/SAC code on the invoice: ${hsnSac}. Use this as a secondary signal alongside
       the description — e.g. a services SAC code (99xxxx) with generic "technical"-sounding
       wording is not automatically 194J; a plain subscription/portal-access/advertisement-style
       service (no professional or technical expertise actually rendered) is often more
       appropriately 194C than 194J, even if the description mentions technology.`
    : "";

  if (!textToClassify.trim()) {
    // Nothing to classify from — don't guess with no input.
    return { suggested_section_id: null, suggested_section_label: null, reasoning: "No description text available to classify." };
  }

  const sectionList = sections
    .map((s) => `id=${s.id}: ${s.section} (${s.sub_type ?? "general"}) — ${s.nature_of_payment}`)
    .join("\n");

  const prompt = `You are helping a CA firm classify an invoice for Indian TDS (Tax Deducted at Source) purposes.

Invoice description: "${textToClassify}"
${hsnContext}
Available TDS sections (pick the single best match, or say NONE if this
clearly doesn't need TDS at all — e.g. a goods purchase under the 194Q
threshold, or a payment type not covered by any listed section):
${sectionList}

Return ONLY valid JSON, no markdown:
{
  "section_id": number or null,
  "reasoning": "one short sentence explaining why, in plain language, quoting the specific words from the description that led to this choice"
}`;

  try {
    const response = await client.chat.completions.create({
      model: process.env.GROQ_MODEL_CHAIN?.split(",")[0]?.trim() || "openai/gpt-oss-120b",
      max_tokens: 300,
      temperature: 0,
      messages: [
        { role: "system", content: "You are a precise TDS classification assistant. Always return only valid JSON." },
        { role: "user", content: prompt },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("No content returned");

    const cleaned = content.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(cleaned);

    const matchedSection = sections.find((s) => s.id === parsed.section_id);

    return {
      suggested_section_id: matchedSection ? matchedSection.id : null,
      suggested_section_label: matchedSection ? `${matchedSection.section} (${matchedSection.sub_type ?? "general"})` : null,
      reasoning: parsed.reasoning ?? null,
    };

  } catch (err) {
    // Non-fatal — a failed suggestion just means the reviewer picks
    // manually, same as today. Never let this block the invoice save.
    console.warn("TDS suggestion failed (non-fatal):", err.message);
    return { suggested_section_id: null, suggested_section_label: null, reasoning: null };
  }
}
