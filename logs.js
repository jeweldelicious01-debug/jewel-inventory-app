import express from "express";
import { pool } from "../db.js";
import { requireRole } from "../auth.js";

const router = express.Router();

router.get("/", requireRole("admin", "inward", "outward", "readonly"), async (req, res) => {
  const { rows } = await pool.query(`
    SELECT l.id, l.type, l.item_id, i.name AS item_name, l.qty, l.department, l.created_at, u.username AS created_by_name
    FROM logs l
    JOIN items i ON i.id = l.item_id
    LEFT JOIN users u ON u.id = l.created_by
    ORDER BY l.created_at DESC
    LIMIT 100
  `);
  res.json(rows);
});

router.post("/:id/undo", requireRole("admin", "inward", "outward"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT * FROM logs WHERE id = $1 FOR UPDATE", [req.params.id]);
    const log = rows[0];
    if (!log) throw Object.assign(new Error("Log entry not found"), { status: 404 });

    const withinWindow = Date.now() - new Date(log.created_at).getTime() < 60 * 60 * 1000;
    if (!withinWindow) throw Object.assign(new Error("This action can no longer be undone (past 1-hour window)"), { status: 400 });

    if (log.type === "INWARD") {
      await client.query("UPDATE items SET stock = GREATEST(0, stock - $1) WHERE id = $2", [log.qty, log.item_id]);
    } else {
      await client.query("UPDATE items SET stock = stock + $1 WHERE id = $2", [log.qty, log.item_id]);
    }
    await client.query("DELETE FROM logs WHERE id = $1", [req.params.id]);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  } finally {
    client.release();
  }
});

export default router;
