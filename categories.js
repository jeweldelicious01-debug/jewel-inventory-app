import express from "express";
import { pool } from "../db.js";
import { requireRole } from "../auth.js";

const router = express.Router();

const PALETTE = [
  { bg: "#eff6ff", border: "#3b82f6", text: "#1e40af" },
  { bg: "#fef2f2", border: "#ef4444", text: "#991b1b" },
  { bg: "#f0fdf4", border: "#22c55e", text: "#166534" },
  { bg: "#faf5ff", border: "#a855f7", text: "#6b21a8" },
  { bg: "#fff7ed", border: "#f97316", text: "#9a3412" },
  { bg: "#f0f9ff", border: "#0ea5e9", text: "#075985" },
  { bg: "#fdf4ff", border: "#d946ef", text: "#86198f" },
  { bg: "#f9fafb", border: "#9ca3af", text: "#374151" },
];

router.get("/", requireRole("admin", "inward", "outward", "readonly"), async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM categories ORDER BY name ASC");
  res.json(rows);
});

router.post("/", requireRole("admin", "inward"), async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Category name is required" });
  }
  const palette = PALETTE[Math.floor(Math.random() * PALETTE.length)];
  try {
    const { rows } = await pool.query(
      "INSERT INTO categories (name, bg, border, text_color) VALUES ($1, $2, $3, $4) RETURNING *",
      [name.trim(), palette.bg, palette.border, palette.text]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      const { rows } = await pool.query("SELECT * FROM categories WHERE name = $1", [name.trim()]);
      return res.status(200).json(rows[0]);
    }
    throw err;
  }
});

router.delete("/:id", requireRole("admin"), async (req, res) => {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM items WHERE category_id = $1", [req.params.id]);
  if (rows[0].count > 0) {
    return res.status(400).json({ error: "Cannot delete a category that still has items" });
  }
  await pool.query("DELETE FROM categories WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

export default router;
