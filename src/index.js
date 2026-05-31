import "dotenv/config";
import express from "express";
import cors from "cors";
import invoiceRoutes from "./routes/invoices.js";
import vendorRoutes from "./routes/vendors.js";

const app = express();
const PORT = process.env.PORT ?? 3000;

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:4173', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// ── Routes ──────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api", invoiceRoutes);
app.use("/api", vendorRoutes);

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
