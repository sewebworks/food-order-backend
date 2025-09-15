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

// === DB SETUP ===
db.serialize(() => {
  db.run(`PRAGMA foreign_keys = ON;`);
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    image_url TEXT,
    category TEXT
  );`);
  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_address TEXT NOT NULL,
    items TEXT NOT NULL,
    total REAL NOT NULL,
    payment TEXT NOT NULL,
    status TEXT DEFAULT 'new',
    created TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );`);
  db.run(`CREATE TABLE IF NOT EXISTS coupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE,
    discount_percent REAL
  );`);
});

const stripeEnabled = !!process.env.STRIPE_SECRET_KEY;
const stripe = stripeEnabled ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

// === ROUTES ===
app.get("/api/health", (req,res) => res.json({ ok:true }));

// Products
app.get("/api/products", (req,res) => {
  db.all("SELECT * FROM products ORDER BY id DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post("/api/products", (req,res) => {
  const { name, description, price, image_url, category } = req.body;
  if (!name || typeof price !== "number") return res.status(400).json({error:"name and numeric price required"});
  db.run("INSERT INTO products (name, description, price, image_url, category) VALUES (?,?,?,?,?)",
    [name, description || null, price, image_url || null, category || null],
    function(err){
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, name, description, price, image_url: image_url || null, category });
    });
});

app.delete("/api/products/:id", (req,res) => {
  const { id } = req.params;
  db.run("DELETE FROM products WHERE id = ?", [id], function(err){
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: this.changes > 0 });
  });
});

// Helper
function calcTotal(items){
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, it) => sum + (Number(it.price) * (Number(it.qty)||1)), 0);
}

function saveOrder(customer, items, payment, total, res){
  db.run("INSERT INTO orders (customer_name, customer_phone, customer_address, items, total, payment) VALUES (?,?,?,?,?,?)",
    [customer.name, customer.phone, customer.address, JSON.stringify(items), total, payment],
    function(err){
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, total, status: "received" });
    });
}

// Orders with coupons
app.post("/api/orders", (req,res) => {
  const { customer, items, payment, coupon } = req.body;
  if (!customer?.name || !customer?.phone || !customer?.address) {
    return res.status(400).json({ error:"Name, Telefon und Adresse sind Pflichtfelder" });
  }
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({error:"items required"});

  let total = calcTotal(items);

  if (coupon) {
    db.get("SELECT * FROM coupons WHERE code = ?", [coupon], (err, row) => {
      if (row) {
        total = total - (total * row.discount_percent / 100);
      }
      saveOrder(customer, items, payment, total, res);
    });
  } else {
    saveOrder(customer, items, payment, total, res);
  }
});

// Orders Admin
app.get("/api/orders", (req,res) => {
  db.all("SELECT id, customer_name, total, payment, status, created FROM orders ORDER BY id DESC LIMIT 200", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
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

    const success_url = `${process.env.FRONTEND_URL || ""}/success.html`;
    const cancel_url = `${process.env.FRONTEND_URL || ""}/cancel.html`;

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
