// src/middleware/requireAuth.js
// ─────────────────────────────────────────────────────────────
// Reads the logged-in user's Supabase session token, confirms
// they're actually a member of an organization, and attaches
// req.orgId / req.userId / req.userRole to every request that
// passes through it. Every route that touches invoice/vendor
// data should sit behind this.
// ─────────────────────────────────────────────────────────────

import supabase from "../config/supabase.js";

export async function requireAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) {
      return res.status(401).json({ error: "Not logged in. Missing Authorization header." });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: "Invalid or expired session. Please log in again." });
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("org_id, role, full_name")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return res.status(403).json({ error: "No organization linked to this account. Contact support." });
    }

    req.orgId = profile.org_id;
    req.userId = user.id;
    req.userRole = profile.role;
    req.userName = profile.full_name;

    next();
  } catch (err) {
    console.error("Auth middleware error:", err);
    return res.status(500).json({ error: "Authentication check failed." });
  }
}
