// src/routes/vendors.js
// ─────────────────────────────────────────────────────────────
// GET    /api/vendors              — list all vendors
// GET    /api/vendors/:id          — single vendor with full history
// POST   /api/vendors              — create vendor manually
// PATCH  /api/vendors/:id          — update vendor profile
// GET    /api/vendors/:id/invoices — all invoices for a vendor
// GET    /api/vendors/:idclear
// /tds      — TDS ledger for a vendor
// GET    /api/tds-sections         — list all TDS sections
// ─────────────────────────────────────────────────────────────

import { Router } from "express";
import supabase from "../config/supabase.js";

const router = Router();


// ── GET /api/vendors ──────────────────────────────────────────
router.get("/vendors", async (req, res) => {
    try {
        const { search, vendor_type, is_msme, tds_exempt } = req.query;

        // Use the view for summary data
        let query = supabase
            .from("vendor_payment_summary")
            .select("*")
            .order("company_name", { ascending: true });

        const { data, error } = await query;
        if (error) return res.status(500).json({ error: error.message });

        // Filter in JS (view doesn't support all filters easily)
        let result = data ?? [];
        if (search) {
            const s = search.toLowerCase();
            result = result.filter(
                (v) =>
                    v.company_name?.toLowerCase().includes(s) ||
                    v.gstin?.toLowerCase().includes(s) ||
                    v.pan?.toLowerCase().includes(s)
            );
        }
        if (vendor_type) result = result.filter((v) => v.vendor_type === vendor_type);
        if (is_msme !== undefined) result = result.filter((v) => v.is_msme === (is_msme === "true"));
        if (tds_exempt !== undefined) result = result.filter((v) => v.tds_exempt === (tds_exempt === "true"));

        return res.json({ vendors: result, total: result.length });

    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});


// ── GET /api/vendors/:id ──────────────────────────────────────
router.get("/vendors/:id", async (req, res) => {
    try {
        const { data: vendor, error } = await supabase
            .from("vendors")
            .select("*")
            .eq("id", req.params.id)
            .single();

        if (error) return res.status(404).json({ error: "Vendor not found." });

        // Get TDS ledger summary
        const { data: ledger } = await supabase
            .from("vendor_tds_ledger")
            .select("*, tds_sections(section, nature_of_payment)")
            .eq("vendor_id", req.params.id)
            .order("financial_year", { ascending: false });

        // Get recent invoices (last 10)
        const { data: recentInvoices } = await supabase
            .from("invoices")
            .select("id, invoice_number, invoice_date, amount, tds_amount, net_payable, status, financial_year")
            .eq("vendor_id", req.params.id)
            .order("invoice_date", { ascending: false })
            .limit(10);

        return res.json({ vendor, ledger: ledger ?? [], recentInvoices: recentInvoices ?? [] });

    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});


// ── POST /api/vendors ─────────────────────────────────────────
router.post("/vendors", async (req, res) => {
    try {
        const {
            company_name, gstin, pan, vendor_type,
            email, phone, address, city, state, pincode,
            bank_account, ifsc, bank_name,
            is_msme, msme_registration_no,
            tds_exempt, tds_exempt_reason, tds_exempt_upto,
            default_tds_section_id, notes,
        } = req.body;

        if (!company_name) {
            return res.status(400).json({ error: "company_name is required." });
        }

        const { data, error } = await supabase
            .from("vendors")
            .insert({
                company_name, gstin: gstin || null, pan: pan || null,
                vendor_type: vendor_type || "company",
                email: email || null, phone: phone || null,
                address: address || null, city: city || null,
                state: state || null, pincode: pincode || null,
                bank_account: bank_account || null,
                ifsc: ifsc || null, bank_name: bank_name || null,
                is_msme: is_msme || false,
                msme_registration_no: msme_registration_no || null,
                tds_exempt: tds_exempt || false,
                tds_exempt_reason: tds_exempt_reason || null,
                tds_exempt_upto: tds_exempt_upto || null,
                default_tds_section_id: default_tds_section_id || null,
                notes: notes || null,
            })
            .select()
            .single();

        if (error) {
            if (error.code === "23505") {
                return res.status(409).json({ error: "A vendor with this GSTIN already exists." });
            }
            return res.status(500).json({ error: error.message });
        }

        return res.status(201).json(data);

    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});


// ── PATCH /api/vendors/:id ────────────────────────────────────
router.patch("/vendors/:id", async (req, res) => {
    try {
        const allowed = [
            "company_name", "gstin", "pan", "vendor_type",
            "email", "phone", "address", "city", "state", "pincode",
            "bank_account", "ifsc", "bank_name",
            "is_msme", "msme_registration_no",
            "tds_exempt", "tds_exempt_reason", "tds_exempt_upto",
            "default_tds_section_id", "notes",
        ];

        const updates = {};
        for (const key of allowed) {
            if (req.body[key] !== undefined) updates[key] = req.body[key];
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: "No valid fields to update." });
        }

        const { data, error } = await supabase
            .from("vendors")
            .update(updates)
            .eq("id", req.params.id)
            .select()
            .single();

        if (error) return res.status(500).json({ error: error.message });
        return res.json(data);

    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});


// ── GET /api/vendors/:id/invoices ─────────────────────────────
router.get("/vendors/:id/invoices", async (req, res) => {
    try {
        const { financial_year, status } = req.query;

        let query = supabase
            .from("invoices")
            .select("*")
            .eq("vendor_id", req.params.id)
            .order("invoice_date", { ascending: false });

        if (financial_year) query = query.eq("financial_year", financial_year);
        if (status) query = query.eq("status", status);

        const { data, error } = await query;
        if (error) return res.status(500).json({ error: error.message });
        return res.json({ invoices: data ?? [] });

    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});


// ── GET /api/vendors/:id/tds ──────────────────────────────────
router.get("/vendors/:id/tds", async (req, res) => {
    try {
        const { financial_year } = req.query;

        let query = supabase
            .from("vendor_tds_ledger")
            .select("*, tds_sections(section, sub_type, nature_of_payment, threshold_aggregate, rate_individual, rate_company)")
            .eq("vendor_id", req.params.id)
            .order("financial_year", { ascending: false });

        if (financial_year) query = query.eq("financial_year", financial_year);

        const { data, error } = await query;
        if (error) return res.status(500).json({ error: error.message });
        return res.json({ ledger: data ?? [] });

    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});


// ── GET /api/tds-sections ─────────────────────────────────────
router.get("/tds-sections", async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("tds_sections")
            .select("*")
            .neq("is_active", false)
            .order("section", { ascending: true });

        if (error) return res.status(500).json({ error: error.message });
        return res.json({ sections: data ?? [] });

    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});


export default router;
