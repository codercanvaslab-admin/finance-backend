// src/services/groqClient.js
// ─────────────────────────────────────────────────────────────
// Single shared entry point for every Groq chat-completion call in
// the backend (geminiService.js's extraction call and
// tdsSuggestionService.js's suggestion call both use this instead of
// calling the Groq SDK directly).
//
// Closes two gaps found this session:
//
// 1. Model deprecation risk (originally flagged in §5, never fully
//    fixed): geminiService.js had "openai/gpt-oss-120b" hardcoded
//    with NO fallback at all — if Groq deprecates that model, every
//    invoice upload breaks instantly for every customer, with no
//    recovery path except an emergency code deploy.
//    tdsSuggestionService.js read a GROQ_MODEL_CHAIN env var, but
//    despite the name, only ever used the FIRST entry — no actual
//    fallback logic existed anywhere in the codebase.
//
//    Fix: GROQ_MODEL_CHAIN (comma-separated, e.g.
//    "openai/gpt-oss-120b,openai/gpt-oss-20b,qwen/qwen3.6-27b") is
//    now walked in order by BOTH call sites. A model-unavailable
//    error (decommissioned/deprecated/404) moves to the next model
//    in the chain automatically instead of failing the request.
//
// 2. Transient failures (rate limits, momentary 5xx) were being
//    treated the same as permanent ones — a single 429 during a
//    burst of uploads silently killed a TDS suggestion with no
//    retry, matching the "worked instantly on manual re-run" bug
//    found this session. Fix: one short retry on the SAME model
//    before moving on, since these clear up within seconds.
// ─────────────────────────────────────────────────────────────

import Groq from "groq-sdk";

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Order matters — first is the primary model, rest are fallbacks.
// openai/gpt-oss-120b is Groq's current recommended target for
// several other models they've deprecated recently, so it stays
// primary; the other two are reasonable next choices if it's ever
// retired. Override via the GROQ_MODEL_CHAIN env var without a code
// change or redeploy if Groq announces a deprecation.
const DEFAULT_MODEL_CHAIN = "openai/gpt-oss-120b,openai/gpt-oss-20b,qwen/qwen3.6-27b";

function getModelChain() {
  const raw = process.env.GROQ_MODEL_CHAIN || DEFAULT_MODEL_CHAIN;
  const chain = raw.split(",").map((m) => m.trim()).filter(Boolean);
  return chain.length ? chain : DEFAULT_MODEL_CHAIN.split(",");
}

// Signals Groq has retired/renamed/can't find this model — no point
// retrying the same one, move straight to the next in the chain.
function isModelUnavailableError(err) {
  const status = err?.status ?? err?.code;
  const msg = (err?.message || "").toLowerCase();
  return (
    status === 404 ||
    msg.includes("decommission") ||
    msg.includes("deprecat") ||
    msg.includes("model_not_found") ||
    msg.includes("does not exist")
  );
}

// Signals a transient, retryable failure — same model, short pause,
// try again once before giving up on it.
function isTransientError(err) {
  const status = err?.status ?? err?.code;
  return status === 429 || status === 500 || status === 502 || status === 503;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Drop-in replacement for `groq.chat.completions.create()`.
 * Pass the same params you'd give the SDK EXCEPT `model` — that's
 * controlled by the chain below. Throws only once every model in
 * the chain has been exhausted.
 *
 * @param {object} params - same shape as the Groq SDK's create() call, minus `model`
 * @param {string} [callerLabel] - short label for log lines, e.g. "extraction" or "TDS suggestion"
 */
export async function createChatCompletion(params, callerLabel = "groq call") {
  const chain = getModelChain();
  let lastError;

  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await client.chat.completions.create({ ...params, model });
        if (i > 0 || attempt > 0) {
          console.log(
            `[groqClient] ${callerLabel} succeeded on "${model}" ` +
            `(chain position ${i + 1}/${chain.length}, attempt ${attempt + 1})`
          );
        }
        return response;
      } catch (err) {
        lastError = err;

        if (isModelUnavailableError(err)) {
          console.warn(
            `[groqClient] ${callerLabel}: model "${model}" unavailable ` +
            `(${err.message}) — trying next model in GROQ_MODEL_CHAIN.`
          );
          break; // no point retrying an unavailable model — next model
        }

        if (isTransientError(err) && attempt === 0) {
          console.warn(
            `[groqClient] ${callerLabel}: transient error on "${model}" ` +
            `(${err.message}) — retrying same model once in 2s.`
          );
          await sleep(2000);
          continue; // retry same model once
        }

        console.warn(
          `[groqClient] ${callerLabel}: failed on "${model}" ` +
          `(${err.message}) — trying next model in chain.`
        );
        break; // give up on this model, try next
      }
    }
  }

  throw lastError ?? new Error(`[groqClient] ${callerLabel}: all models in GROQ_MODEL_CHAIN failed with no error captured.`);
}
