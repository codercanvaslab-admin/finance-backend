// src/services/taxValidation.js
export function validateTaxType(invoice, rawText = "") {
  const { vendor_gstin, buyer_gstin, is_igst, cgst, sgst, igst, amount, taxable_amount } = invoice;

  const flags = [];
  let expectedIsIgst = null;

  const vendorStateCode = extractStateCode(vendor_gstin);
  const buyerStateCode = extractStateCode(buyer_gstin);

  if (!vendorStateCode || !buyerStateCode) {
    flags.push({
      code: "MISSING_GSTIN_FOR_STATE_CHECK",
      message: "Could not independently verify CGST/SGST vs IGST — vendor or buyer GSTIN missing/invalid. Needs manual check.",
    });
  } else {
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

  // ── Check 5: cross-check against literal "Supplier/Recipient State Code" labels ──
  // Catches vendor/buyer GSTIN swaps — this is what would have caught the Info Edge bug.
  if (rawText) {
    const supplierMatch = rawText.match(/Supplier\s*State\s*Code\s*:?\s*(\d{2})/i);
    const recipientMatch = rawText.match(/Re[cs]{1,2}i?pient\s*State\s*[Cc]ode\s*[-:]?\s*(\d{2})/i);

    if (supplierMatch && vendorStateCode && supplierMatch[1] !== vendorStateCode) {
      flags.push({
        code: "VENDOR_GSTIN_STATE_MISMATCH",
        message: `Invoice text states Supplier State Code = ${supplierMatch[1]}, but vendor_gstin's state code is ${vendorStateCode}. vendor_gstin may have been misread or swapped with the buyer's GSTIN.`,
      });
    }
    if (recipientMatch && buyerStateCode && recipientMatch[1] !== buyerStateCode) {
      flags.push({
        code: "BUYER_GSTIN_STATE_MISMATCH",
        message: `Invoice text states Recipient State Code = ${recipientMatch[1]}, but buyer_gstin's state code is ${buyerStateCode}. buyer_gstin may have been misread or swapped with the vendor's GSTIN.`,
      });
    }
  }

  // ── Check 3: Math balance check ──
  if (taxable_amount != null && amount != null) {
    const totalTax = (Number(cgst) || 0) + (Number(sgst) || 0) + (Number(igst) || 0);
    const expectedTotal = Number(taxable_amount) + totalTax;
    const diff = Math.abs(expectedTotal - Number(amount));
    if (diff > 1) {
      flags.push({
        code: "MATH_MISMATCH",
        message: `Taxable amount (₹${taxable_amount}) + tax (₹${totalTax}) = ₹${expectedTotal}, ` +
          `but extracted total is ₹${amount} — a ₹${diff.toFixed(2)} discrepancy. Likely a misread digit.`,
      });
    }
  }

  // ── Check 4: CGST should equal SGST ──
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

function extractStateCode(gstin) {
  if (!gstin || typeof gstin !== "string") return null;
  const cleaned = gstin.trim().toUpperCase();
  if (cleaned.length !== 15) return null;
  const code = cleaned.slice(0, 2);
  return /^\d{2}$/.test(code) ? code : null;
}