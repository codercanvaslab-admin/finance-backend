// src/services/usageService.js
// ─────────────────────────────────────────────────────────────
// The actual "parking meter" logic — check before, increment after.
// This is what makes plan limits real instead of theoretical.
// ─────────────────────────────────────────────────────────────

import supabase from "../config/supabase.js";

function currentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Call this BEFORE processing an upload. Throws a clear error if the
 * org has hit its monthly invoice limit, so the route can return a
 * specific "please upgrade" response instead of a generic failure.
 */
export async function checkUsageLimit(orgId) {
  const yearMonth = currentYearMonth();

  const { data: org, error: orgErr } = await supabase
    .from("organizations")
    .select("plan_tier, monthly_invoice_limit, billing_status")
    .eq("id", orgId)
    .single();

  if (orgErr || !org) {
    throw new Error("Organization not found — cannot verify plan limit.");
  }

  if (org.billing_status === "suspended") {
    throw new UsageLimitError(
      "This account is suspended. Please contact support or update billing to resume.",
      "ACCOUNT_SUSPENDED"
    );
  }

  // Unlimited plans (custom/enterprise) have monthly_invoice_limit = null
  if (org.monthly_invoice_limit == null) return { allowed: true };

  const { data: usage } = await supabase
    .from("usage_monthly")
    .select("invoices_processed")
    .eq("org_id", orgId)
    .eq("year_month", yearMonth)
    .maybeSingle();

  const used = usage?.invoices_processed ?? 0;

  if (used >= org.monthly_invoice_limit) {
    throw new UsageLimitError(
      `You've reached this month's limit of ${org.monthly_invoice_limit} invoices ` +
      `on the ${org.plan_tier} plan. Upgrade to continue processing invoices this month.`,
      "MONTHLY_LIMIT_REACHED"
    );
  }

  return { allowed: true, used, limit: org.monthly_invoice_limit };
}

/**
 * Call this AFTER an invoice is successfully saved — increments the
 * counter via the atomic DB function (see migration), so concurrent
 * uploads don't undercount each other.
 */
export async function recordUsage(orgId, fileBytes) {
  const yearMonth = currentYearMonth();
  const { error } = await supabase.rpc("increment_usage", {
    p_org_id: orgId,
    p_year_month: yearMonth,
    p_file_bytes: fileBytes,
  });
  if (error) {
    // Non-fatal — don't fail the whole upload just because usage
    // tracking hiccuped. Log it so you notice if this becomes common.
    console.warn("Failed to record usage (non-fatal):", error.message);
  }
}

/** For the GET /api/usage endpoint — what the UI shows the firm owner. */
export async function getUsageStatus(orgId) {
  const yearMonth = currentYearMonth();

  const { data: org } = await supabase
    .from("organizations")
    .select("plan_tier, monthly_invoice_limit, billing_status")
    .eq("id", orgId)
    .single();

  const { data: usage } = await supabase
    .from("usage_monthly")
    .select("invoices_processed, storage_bytes_used")
    .eq("org_id", orgId)
    .eq("year_month", yearMonth)
    .maybeSingle();

  const used = usage?.invoices_processed ?? 0;
  const limit = org?.monthly_invoice_limit ?? null;

  return {
    plan_tier: org?.plan_tier,
    billing_status: org?.billing_status,
    invoices_used_this_month: used,
    invoices_limit_this_month: limit,
    percent_used: limit ? Math.round((used / limit) * 100) : null,
    storage_bytes_used: usage?.storage_bytes_used ?? 0,
  };
}

export class UsageLimitError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}
