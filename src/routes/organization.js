// src/routes/organization.js
// ─────────────────────────────────────────────────────────────
// GET /api/me — the logged-in user's org + profile info.
//
// NEW: nothing in the app previously exposed the CA/law firm's
// name anywhere — Nav only ever showed the user's email, and
// Analytics had no way to know which firm's data it was looking
// at. Added to close that gap (see CLAUDE.md issue: "Analytics
// doesn't show company name").
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import supabase from "../config/supabase.js";

const router = Router();

router.get("/me", async (req, res) => {
  try {
    const { data: org, error } = await supabase
      .from("organizations")
      .select("id, name, plan_tier")
      .eq("id", req.orgId)
      .single();

    if (error) return res.status(500).json({ error: error.message });

    return res.json({
      org_id: req.orgId,
      firm_name: org?.name ?? null,
      plan_tier: org?.plan_tier ?? null,
      role: req.userRole,
      full_name: req.userName,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
