import "dotenv/config";
import express from "express";
import cors from "cors";
import invoiceRoutes from "./routes/invoices.js";

const app = express();
const PORT = process.env.PORT ?? 3000;

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── Routes ──────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api", invoiceRoutes);

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
