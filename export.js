import express from "express";
import { pool } from "../db.js";
import { requireRole } from "../auth.js";

const router = express.Router();

router.get("/", requireRole("admin", "inward", "outward"), async (req, res) => {
  const { rows: items } = await pool.query(`
    SELECT i.id, i.name, i.stock, c.name AS category_name
    FROM items i JOIN categories c ON c.id = i.category_id
    ORDER BY i.order_index ASC
  `);
  const { rows: logs } = await pool.query(`
    SELECT l.item_id, l.type, l.qty, l.department, l.created_at
    FROM logs l
    ORDER BY l.created_at DESC
  `);
  res.json({ items, logs });
});

export default router;
