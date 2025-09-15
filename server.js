import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import pkg from "pg";
const { Pool } = pkg;

const app = express();
app.use(cors({ origin: "*" }));
app.use(bodyParser.json());

// === DB Verbindung ===
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// === Tabellen anlegen ===
async function initDb(){
  await pool.query(`CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    image_url TEXT,
    category TEXT
  );`);

  await pool.query(`CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_address TEXT NOT NULL,
    items JSONB NOT NULL,
    total REAL NOT NULL,
    payment TEXT NOT NULL,
    status TEXT DEFAULT 'neu',
    created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );`);

  await pool.query(`CREATE TABLE IF NOT EXISTS coupons (
    id SERIAL PRIMARY KEY,
    code TEXT UNIQUE,
    discount_percent REAL
  );`);
}
initDb();

// === Routen ===
app.get("/api/health", (req,res) => res.json({ ok:true }));

// Produkte
app.get("/api/products", async (req,res) => {
  const result = await pool.query("SELECT * FROM products ORDER BY id DESC");
  res.json(result.rows);
});

app.post("/api/products", async (req,res) => {
  const { name, description, price, image_url, category } = req.body;
  if (!name || typeof price !== "number") {
    return res.status(400).json({error:"Name und Preis erforderlich"});
  }
  const result = await pool.query(
    "INSERT INTO products (name, description, price, image_url, category) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [name, description || "", price, image_url || "", category || ""]
  );
  res.json(result.rows[0]);
});

app.delete("/api/products/:id", async (req,res) => {
  const { id } = req.params;
  const result = await pool.query("DELETE FROM products WHERE id=$1", [id]);
  res.json({ deleted: result.rowCount > 0 });
});

// Orders
app.post("/api/orders", async (req,res) => {
  const { customer, items, payment, coupon } = req.body;
  if (!customer?.name || !customer?.phone || !customer?.address) {
    return res.status(400).json({ error:"Name, Telefon und Adresse sind Pflichtfelder" });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({error:"items required"});
  }

  let total = items.reduce((s,i) => s + i.price*i.qty, 0);

  if (coupon) {
    const c = await pool.query("SELECT * FROM coupons WHERE code=$1", [coupon]);
    if (c.rows.length > 0) {
      total = total - (total * c.rows[0].discount_percent / 100);
    }
  }

  const result = await pool.query(
    "INSERT INTO orders (customer_name, customer_phone, customer_address, items, total, payment) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,total,status",
    [customer.name, customer.phone, customer.address, JSON.stringify(items), total, payment]
  );

  res.json(result.rows[0]);
});

app.get("/api/orders", async (req,res) => {
  const result = await pool.query("SELECT * FROM orders ORDER BY id DESC LIMIT 200");
  res.json(result.rows);
});

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API running on ${PORT}`));
