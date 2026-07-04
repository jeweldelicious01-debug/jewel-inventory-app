import express from "express";
import { pool } from "../db.js";
import { requireRole } from "../auth.js";

const router = express.Router();

router.get("/", requireRole("admin", "inward", "outward", "readonly"), async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM notes ORDER BY created_at DESC");
  res.json(rows);
});

router.post("/", requireRole("admin"), async (req, res) => {
  const { itemName, pax, dateLabel } = req.body || {};
  if (!itemName || !itemName.trim() || !pax || !dateLabel || !dateLabel.trim()) {
    return res.status(400).json({ error: "Item name, pax, and date are required" });
  }
  const { rows } = await pool.query(
    "INSERT INTO notes (item_name, pax, date_label) VALUES ($1, $2, $3) RETURNING *",
    [itemName.trim(), parseInt(pax) || 0, dateLabel.trim()]
  );
  res.status(201).json(rows[0]);
});

router.delete("/:id", requireRole("admin"), async (req, res) => {
  await pool.query("DELETE FROM notes WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

export default router;
