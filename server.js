import express from "express";
import sqlite3 from "sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";
import Stripe from "stripe";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
app.use(cors({ origin: ALLOWED_ORIGIN, credentials: false }));
app.use(bodyParser.json());

const DB_PATH = process.env.DB_PATH || "./db.sqlite";
const db = new sqlite3.Database(DB_PATH);
db.serialize(() => {
  db.run(`PRAGMA foreign_keys = ON;`);
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    image_url TEXT
  );`);
  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT,
    customer_phone TEXT,
    customer_address TEXT,
    items TEXT NOT NULL,
    total REAL NOT NULL,
    payment TEXT NOT NULL,
    status TEXT DEFAULT 'new',
    created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );`);
});

const stripeEnabled = !!process.env.STRIPE_SECRET_KEY;
const stripe = stripeEnabled ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

app.get("/api/health", (req,res) => res.json({ ok:true }));
app.get("/api/config", (req,res) => res.json({ stripeEnabled, currency: "CHF" }));

// Products
app.get("/api/products", (req,res) => {
  db.all("SELECT * FROM products ORDER BY id DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post("/api/products", (req,res) => {
  const { name, price, image_url } = req.body;
  if (!name || typeof price !== "number") return res.status(400).json({error:"name and numeric price required"});
  db.run("INSERT INTO products (name, price, image_url) VALUES (?,?,?)",
    [name, price, image_url || null],
    function(err){
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, name, price, image_url: image_url || null });
    });
});

app.patch("/api/products/:id", (req,res) => {
  const { id } = req.params;
  const { name, price, image_url } = req.body;
  db.run("UPDATE products SET name = COALESCE(?, name), price = COALESCE(?, price), image_url = COALESCE(?, image_url) WHERE id = ?",
    [name ?? null, typeof price === "number" ? price : null, image_url ?? null, id],
    function(err){
      if (err) return res.status(500).json({ error: err.message });
      res.json({ updated: this.changes > 0 });
    });
});

app.delete("/api/products/:id", (req,res) => {
  const { id } = req.params;
  db.run("DELETE FROM products WHERE id = ?", [id], function(err){
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: this.changes > 0 });
  });
});

// Orders
function calcTotal(items){
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, it) => sum + (Number(it.price) * (Number(it.qty)||1)), 0);
}

app.post("/api/orders", (req,res) => {
  const { customer, items, payment } = req.body;
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({error:"items required"});
  const total = calcTotal(items);
  const name = customer?.name || null;
  const phone = customer?.phone || null;
  const address = customer?.address || null;
  const pay = payment || "Bar";

  db.run("INSERT INTO orders (customer_name, customer_phone, customer_address, items, total, payment) VALUES (?,?,?,?,?,?)",
    [name, phone, address, JSON.stringify(items), total, pay],
    function(err){
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, total, status: "received" });
    });
});

app.get("/api/orders", (req,res) => {
  db.all("SELECT id, customer_name, total, payment, status, created FROM orders ORDER BY id DESC LIMIT 200", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get("/api/orders/:id", (req,res) => {
  const { id } = req.params;
  db.get("SELECT * FROM orders WHERE id = ?", [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row || {});
  });
});

// Stripe Checkout (optional)
app.post("/api/pay/stripe/session", async (req,res) => {
  if (!stripeEnabled) return res.status(400).json({ error: "Stripe not configured" });
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({error:"items required"});

    const line_items = items.map(it => ({
      price_data: {
        currency: "chf",
        product_data: { name: it.name },
        unit_amount: Math.round(Number(it.price) * 100)
      },
      quantity: Number(it.qty) || 1
    }));

    const success_url = `${process.env.FRONTEND_URL || ""}/success.html` || "https://example.com/success.html";
    const cancel_url = `${process.env.FRONTEND_URL || ""}/cancel.html` || "https://example.com/cancel.html";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,
      success_url,
      cancel_url
    });
    res.json({ url: session.url });
  } catch (e){
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API listening on port ${PORT}`);
  console.log(`DB: ${DB_PATH}`);
});
