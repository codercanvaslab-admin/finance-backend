import "dotenv/config";
import express from "express";
import cors from "cors";
import invoiceRoutes from "./routes/invoices.js";
import vendorRoutes from "./routes/vendors.js";
import organizationRoutes from "./routes/organization.js"; // NEW — GET /api/me
import { requireAuth } from "./middleware/requireAuth.js"; // NEW

const app = express();
const PORT = process.env.PORT ?? 3000;

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    const allowed =
      !origin ||
      /^http:\/\/localhost:\d+$/.test(origin) ||
      origin === 'https://vendoreflow.vercel.app';
    callback(allowed ? null : new Error(`CORS blocked for origin: ${origin}`), allowed);
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// ── Routes ──────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// NEW — requireAuth runs before every invoice/vendor route, attaching
// req.orgId/req.userId/req.userRole. Health check stays public (no
// login needed to confirm the server is alive); everything else now
// requires a valid Supabase session AND a linked organization.
app.use("/api", requireAuth, invoiceRoutes);
app.use("/api", requireAuth, vendorRoutes);
app.use("/api", requireAuth, organizationRoutes); // NEW

// ── Global error handler ────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  const status = err.status ?? 500;
  res.status(status).json({ error: err.message ?? "Internal server error." });
});

// ── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Invoice automation server running on http://localhost:${PORT}`);
});

export default app;
