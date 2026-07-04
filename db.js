import pg from "pg";
import bcrypt from "bcryptjs";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'inward', 'outward', 'readonly')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      bg TEXT NOT NULL DEFAULT '#f3f4f6',
      border TEXT NOT NULL DEFAULT '#9ca3af',
      text_color TEXT NOT NULL DEFAULT '#374151',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS items (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
      stock INTEGER NOT NULL DEFAULT 0,
      threshold INTEGER NOT NULL DEFAULT 0,
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS notes (
      id SERIAL PRIMARY KEY,
      item_name TEXT NOT NULL,
      pax INTEGER NOT NULL DEFAULT 0,
      date_label TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS logs (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('INWARD', 'OUTWARD')),
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      qty INTEGER NOT NULL,
      department TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS session (
      sid VARCHAR NOT NULL COLLATE "default",
      sess JSON NOT NULL,
      expire TIMESTAMP(6) NOT NULL
    ) WITH (OIDS=FALSE);

    ALTER TABLE session DROP CONSTRAINT IF EXISTS session_pkey;
    ALTER TABLE session ADD CONSTRAINT session_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE;
    CREATE INDEX IF NOT EXISTS IDX_session_expire ON session (expire);
  `);
}

async function seedIfEmpty() {
  const { rows: userRows } = await pool.query("SELECT COUNT(*)::int AS count FROM users");
  if (userRows[0].count === 0) {
    const defaultPassword = "ChangeMe123!";
    const hash = await bcrypt.hash(defaultPassword, 10);
    await pool.query(
      "INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'admin')",
      ["admin", hash]
    );
    console.log("=================================================");
    console.log(" Seeded default admin account:");
    console.log("   username: admin");
    console.log(`   password: ${defaultPassword}`);
    console.log(" Please log in and change this password immediately.");
    console.log("=================================================");
  }

  const { rows: catRows } = await pool.query("SELECT COUNT(*)::int AS count FROM categories");
  if (catRows[0].count === 0) {
    const defaultCategories = [
      ["Dairy", "#eff6ff", "#3b82f6", "#1e40af"],
      ["Disposables", "#f9fafb", "#9ca3af", "#374151"],
      ["Khade Masale", "#fffbeb", "#f59e0b", "#92400e"],
      ["Tin Packed", "#ecfdf5", "#10b981", "#065f46"],
      ["Drinks", "#fdf2f8", "#ec4899", "#9d174d"],
    ];
    for (const [name, bg, border, text] of defaultCategories) {
      await pool.query(
        "INSERT INTO categories (name, bg, border, text_color) VALUES ($1, $2, $3, $4)",
        [name, bg, border, text]
      );
    }

    const { rows: cats } = await pool.query("SELECT id, name FROM categories");
    const catMap = Object.fromEntries(cats.map((c) => [c.name, c.id]));

    const defaultItems = [
      ["Sugar", "Dairy", 2, 15, 1],
      ["Disposable Bowls", "Disposables", 0, 100, 2],
      ["Cardamom (Elaichi)", "Khade Masale", 12, 3, 3],
      ["Tomato Puree Tin", "Tin Packed", 45, 10, 4],
    ];
    for (const [name, cat, stock, threshold, order] of defaultItems) {
      await pool.query(
        "INSERT INTO items (name, category_id, stock, threshold, order_index) VALUES ($1, $2, $3, $4, $5)",
        [name, catMap[cat], stock, threshold, order]
      );
    }

    await pool.query(
      "INSERT INTO notes (item_name, pax, date_label) VALUES ($1, $2, $3), ($4, $5, $6)",
      ["Sugar", 250, "1-Jun", "Disposable Bowls", 180, "3-Jun"]
    );
  }
}

export async function initDb() {
  await initSchema();
  await seedIfEmpty();
}
