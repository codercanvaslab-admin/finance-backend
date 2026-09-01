// src/services/taxValidation.js
// ─────────────────────────────────────────────────────────────
// This is the missing "deterministic safety-check" piece.
//
// THE PROBLEM THIS FIXES:
// Right now, the AI extracts `is_igst`, `cgst`, `sgst`, and `igst`
// directly from the invoice text/image — nothing independently
// verifies that against the actual GSTIN state codes. If the AI
// misreads a digit or mis-infers the tax type, nothing catches it.
//
// THE FIX:
// GSTIN structure is public and fixed: the FIRST 2 DIGITS of any
// GSTIN are a state code (e.g. "27" = Maharashtra, "09" = Uttar
// Pradesh — see the official state-code list). This function
// compares the vendor's state code against the buyer's (client's)
// state code — plain string comparison, zero AI — and checks that
// against what the AI said the tax type was.
//
// Example:
//   vendor_gstin: "27AABCM1234F1Z5"  → state code "27" (Maharashtra)
//   buyer_gstin:  "09XYZAB5678H1Z3"  → state code "09" (Uttar Pradesh)
//   → codes differ → this should be IGST.
//   If the AI's extracted `is_igst` was `false` (i.e. it thought this
//   was CGST+SGST) → MISMATCH → flag for human review, don't trust it.
// ─────────────────────────────────────────────────────────────

/**
 * @param {object} invoice - fields as extracted by the AI (extractionService.js output)
 * @returns {object} validation result — always returned, never throws,
 *   so this can run on every invoice without breaking the pipeline.
 */
export function validateTaxType(invoice) {
  const { vendor_gstin, buyer_gstin, is_igst, cgst, sgst, igst, amount, taxable_amount } = invoice;

  const flags = [];
  let expectedIsIgst = null;

  // ── Check 1: Do we even have both GSTINs to compare? ─────────
  const vendorStateCode = extractStateCode(vendor_gstin);
  const buyerStateCode = extractStateCode(buyer_gstin);

  if (!vendorStateCode || !buyerStateCode) {
    flags.push({
      code: "MISSING_GSTIN_FOR_STATE_CHECK",
      message: "Could not independently verify CGST/SGST vs IGST — vendor or buyer GSTIN missing/invalid. Needs manual check.",
    });
  } else {
    // ── Check 2: The actual deterministic comparison ────────────
    expectedIsIgst = vendorStateCode !== buyerStateCode;

    if (is_igst !== null && is_igst !== undefined && is_igst !== expectedIsIgst) {
      flags.push({
        code: "TAX_TYPE_MISMATCH",
        message: `AI extracted is_igst=${is_igst}, but comparing GSTIN state codes ` +
          `(vendor: ${vendorStateCode}, buyer: ${buyerStateCode}) suggests it should be ` +
          `is_igst=${expectedIsIgst}. This invoice needs a human to check the actual GST split before approval.`,
      });
    }
  }

  // ── Check 3: Math balance check (Subtotal + Tax = Total) ────
  if (taxable_amount != null && amount != null) {
    const totalTax = (Number(cgst) || 0) + (Number(sgst) || 0) + (Number(igst) || 0);
    const expectedTotal = Number(taxable_amount) + totalTax;
    const diff = Math.abs(expectedTotal - Number(amount));

    // Allow ₹1 tolerance for rounding
    if (diff > 1) {
      flags.push({
        code: "MATH_MISMATCH",
        message: `Taxable amount (₹${taxable_amount}) + tax (₹${totalTax}) = ₹${expectedTotal}, ` +
          `but extracted total is ₹${amount} — a ₹${diff.toFixed(2)} discrepancy. Likely a misread digit.`,
      });
    }
  }

  // ── Check 4: CGST should equal SGST (they're always split evenly) ──
  if (cgst != null && sgst != null && Number(cgst) !== Number(sgst)) {
    flags.push({
      code: "CGST_SGST_MISMATCH",
      message: `CGST (₹${cgst}) and SGST (₹${sgst}) should always be equal — they're the same rate split in half. Needs a check.`,
    });
  }

  return {
    passed: flags.length === 0,
    flags,
    expected_is_igst: expectedIsIgst,
    vendor_state_code: vendorStateCode,
    buyer_state_code: buyerStateCode,
  };
}

/**
 * Extracts the 2-digit state code from a GSTIN.
 * Returns null if the GSTIN is missing or clearly malformed
 * (a valid GSTIN is always exactly 15 characters).
 */
function extractStateCode(gstin) {
  if (!gstin || typeof gstin !== "string") return null;
  const cleaned = gstin.trim().toUpperCase();
  if (cleaned.length !== 15) return null;
  const code = cleaned.slice(0, 2);
  return /^\d{2}$/.test(code) ? code : null;
}
