import express from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";

const router = express.Router();

router.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }
  const { rows } = await pool.query(
    "SELECT id, username, password_hash, role FROM users WHERE username = $1",
    [username]
  );
  const user = rows[0];
  if (!user) {
    return res.status(401).json({ error: "Invalid username or password" });
  }
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    return res.status(401).json({ error: "Invalid username or password" });
  }
  req.session.userId = user.id;
  req.session.role = user.role;
  req.session.username = user.username;
  res.json({ id: user.id, username: user.username, role: user.role });
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

router.get("/me", (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  res.json({
    id: req.session.userId,
    username: req.session.username,
    role: req.session.role,
  });
});

// Admin: manage users
router.get("/users", requireRole("admin"), async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, username, role, created_at FROM users ORDER BY id ASC"
  );
  res.json(rows);
});

router.post("/users", requireRole("admin"), async (req, res) => {
  const { username, password, role } = req.body || {};
  const validRoles = ["admin", "inward", "outward", "readonly"];
  if (!username || !password || !validRoles.includes(role)) {
    return res.status(400).json({ error: "username, password, and a valid role are required" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      "INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, role, created_at",
      [username.trim(), hash, role]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Username already exists" });
    }
    throw err;
  }
});

router.patch("/users/:id/password", requireRole("admin"), async (req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    "UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id, username, role",
    [hash, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "User not found" });
  res.json({ ok: true });
});

router.patch("/users/:id/role", requireRole("admin"), async (req, res) => {
  const { role } = req.body || {};
  const validRoles = ["admin", "inward", "outward", "readonly"];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }
  const { rows } = await pool.query(
    "UPDATE users SET role = $1 WHERE id = $2 RETURNING id, username, role",
    [role, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "User not found" });
  res.json(rows[0]);
});

router.delete("/users/:id", requireRole("admin"), async (req, res) => {
  if (Number(req.params.id) === req.session.userId) {
    return res.status(400).json({ error: "You cannot delete your own account" });
  }
  await pool.query("DELETE FROM users WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

// Any authenticated user can change their own password
router.patch("/me/password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: "Current password and a new password (6+ chars) are required" });
  }
  const { rows } = await pool.query("SELECT password_hash FROM users WHERE id = $1", [req.session.userId]);
  const user = rows[0];
  if (!user) return res.status(404).json({ error: "User not found" });
  const match = await bcrypt.compare(currentPassword, user.password_hash);
  if (!match) return res.status(401).json({ error: "Current password is incorrect" });
  const hash = await bcrypt.hash(newPassword, 10);
  await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [hash, req.session.userId]);
  res.json({ ok: true });
});

export default router;
