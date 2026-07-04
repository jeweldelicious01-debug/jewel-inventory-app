import express from "express";
import { pool } from "../db.js";
import { requireRole } from "../auth.js";

const router = express.Router();

router.get("/", requireRole("admin", "inward", "outward", "readonly"), async (req, res) => {
  const { rows } = await pool.query(`
    SELECT i.id, i.name, i.stock, i.threshold, i.order_index,
           c.id AS category_id, c.name AS category_name, c.bg, c.border, c.text_color
    FROM items i
    JOIN categories c ON c.id = i.category_id
    ORDER BY i.order_index ASC, i.id ASC
  `);
  res.json(rows);
});

router.post("/", requireRole("admin", "inward"), async (req, res) => {
  const { name, categoryId, threshold } = req.body || {};
  if (!name || !name.trim() || !categoryId) {
    return res.status(400).json({ error: "Item name and category are required" });
  }
  const { rows: maxRows } = await pool.query("SELECT COALESCE(MAX(order_index), 0) AS max FROM items");
  const nextOrder = maxRows[0].max + 1;
  const { rows } = await pool.query(
    "INSERT INTO items (name, category_id, stock, threshold, order_index) VALUES ($1, $2, 0, $3, $4) RETURNING id",
    [name.trim(), categoryId, threshold || 0, nextOrder]
  );
  res.status(201).json({ id: rows[0].id });
});

router.patch("/:id/rename", requireRole("admin", "inward"), async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Name is required" });
  await pool.query("UPDATE items SET name = $1 WHERE id = $2", [name.trim(), req.params.id]);
  res.json({ ok: true });
});

router.patch("/:id/threshold", requireRole("admin", "inward"), async (req, res) => {
  const { threshold } = req.body || {};
  await pool.query("UPDATE items SET threshold = $1 WHERE id = $2", [parseInt(threshold) || 0, req.params.id]);
  res.json({ ok: true });
});

router.patch("/:id/order", requireRole("admin"), async (req, res) => {
  const { direction } = req.body || {};
  const { rows: items } = await pool.query("SELECT id, order_index FROM items ORDER BY order_index ASC, id ASC");
  const idx = items.findIndex((i) => i.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: "Item not found" });
  const delta = direction === "up" ? -1 : 1;
  const swapIdx = idx + delta;
  if (swapIdx < 0 || swapIdx >= items.length) return res.json({ ok: true });
  const a = items[idx];
  const b = items[swapIdx];
  await pool.query("UPDATE items SET order_index = $1 WHERE id = $2", [b.order_index, a.id]);
  await pool.query("UPDATE items SET order_index = $1 WHERE id = $2", [a.order_index, b.id]);
  res.json({ ok: true });
});

router.delete("/:id", requireRole("admin"), async (req, res) => {
  await pool.query("DELETE FROM items WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

router.post("/inward", requireRole("admin", "inward"), async (req, res) => {
  const { itemId, qty } = req.body || {};
  const qtyNum = parseInt(qty);
  if (!itemId || !qtyNum || qtyNum <= 0) {
    return res.status(400).json({ error: "Item and a positive quantity are required" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("UPDATE items SET stock = stock + $1 WHERE id = $2 RETURNING id", [qtyNum, itemId]);
    if (!rows[0]) throw Object.assign(new Error("Item not found"), { status: 404 });
    const { rows: logRows } = await client.query(
      "INSERT INTO logs (type, item_id, qty, created_by) VALUES ('INWARD', $1, $2, $3) RETURNING *",
      [itemId, qtyNum, req.session.userId]
    );
    await client.query("COMMIT");
    res.status(201).json(logRows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  } finally {
    client.release();
  }
});

router.post("/outward", requireRole("admin", "outward"), async (req, res) => {
  const { itemId, qty, department } = req.body || {};
  const qtyNum = parseInt(qty);
  if (!itemId || !qtyNum || qtyNum <= 0 || !department) {
    return res.status(400).json({ error: "Item, department, and a positive quantity are required" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: itemRows } = await client.query("SELECT stock FROM items WHERE id = $1 FOR UPDATE", [itemId]);
    if (!itemRows[0]) throw Object.assign(new Error("Item not found"), { status: 404 });
    if (itemRows[0].stock < qtyNum) {
      throw Object.assign(new Error("Insufficient inventory balance"), { status: 400 });
    }
    await client.query("UPDATE items SET stock = stock - $1 WHERE id = $2", [qtyNum, itemId]);
    const { rows: logRows } = await client.query(
      "INSERT INTO logs (type, item_id, qty, department, created_by) VALUES ('OUTWARD', $1, $2, $3, $4) RETURNING *",
      [itemId, qtyNum, department, req.session.userId]
    );
    await client.query("COMMIT");
    res.status(201).json(logRows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  } finally {
    client.release();
  }
});

router.post("/csv-upload", requireRole("admin", "inward"), async (req, res) => {
  const { rows: csvRows } = req.body || {};
  if (!Array.isArray(csvRows)) {
    return res.status(400).json({ error: "rows array is required" });
  }
  let addedCount = 0;
  for (const row of csvRows) {
    const name = (row.name || "").trim();
    const categoryName = (row.category || "").trim();
    const qty = parseInt(row.qty) || 0;
    const threshold = parseInt(row.threshold) || 0;
    if (!name || !categoryName) continue;

    let { rows: catRows } = await pool.query("SELECT id FROM categories WHERE LOWER(name) = LOWER($1)", [categoryName]);
    let categoryId;
    if (catRows[0]) {
      categoryId = catRows[0].id;
    } else {
      const { rows: newCat } = await pool.query(
        "INSERT INTO categories (name) VALUES ($1) RETURNING id",
        [categoryName]
      );
      categoryId = newCat[0].id;
    }

    const { rows: existing } = await pool.query("SELECT id FROM items WHERE LOWER(name) = LOWER($1)", [name]);
    if (existing[0]) {
      await pool.query("UPDATE items SET stock = stock + $1, threshold = $2 WHERE id = $3", [qty, threshold, existing[0].id]);
    } else {
      const { rows: maxRows } = await pool.query("SELECT COALESCE(MAX(order_index), 0) AS max FROM items");
      await pool.query(
        "INSERT INTO items (name, category_id, stock, threshold, order_index) VALUES ($1, $2, $3, $4, $5)",
        [name, categoryId, qty, threshold, maxRows[0].max + 1]
      );
    }
    addedCount++;
  }
  res.json({ addedCount });
});

export default router;
