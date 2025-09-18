const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(bodyParser.json());

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// --- Produkte ---
app.get("/api/products", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM products ORDER BY id DESC");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Fehler beim Laden der Produkte" });
  }
});

app.post("/api/products", async (req, res) => {
  const { name, description, price, image_url, category, highlight } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO products (name, description, price, image_url, category, highlight) 
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, description, price, image_url, category, highlight]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Fehler beim Anlegen des Produkts" });
  }
});

app.delete("/api/products/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM products WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Fehler beim Löschen" });
  }
});

// --- Coupons ---
app.get("/api/coupons", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM coupons ORDER BY id DESC");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Fehler beim Laden der Coupons" });
  }
});

app.post("/api/coupons", async (req, res) => {
  const { code, discount_percent } = req.body;
  try {
    const result = await db.query(
      "INSERT INTO coupons (code, discount_percent) VALUES ($1,$2) RETURNING *",
      [code, discount_percent]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Fehler beim Anlegen des Coupons" });
  }
});

app.delete("/api/coupons/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM coupons WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Fehler beim Löschen" });
  }
});

// --- Bestellungen ---
app.get("/api/orders", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM orders ORDER BY id DESC");
    for (let row of result.rows) {
      const items = await db.query("SELECT * FROM order_items WHERE order_id=$1", [row.id]);
      row.items = items.rows;
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Fehler beim Laden der Bestellungen" });
  }
});

app.post("/api/orders", async (req, res) => {
  const { customer, items, payment, coupon, delivery_method } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO orders 
       (customer_name, customer_address, customer_plz, customer_city, customer_phone, payment, coupon, delivery_method) 
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) 
       RETURNING id`,
      [customer.name, customer.address, customer.plz, customer.city, customer.phone, payment, coupon, delivery_method]
    );
    const orderId = result.rows[0].id;

    for (let i of items) {
      await db.query(
        `INSERT INTO order_items (order_id, product_id, quantity, price, note) 
         VALUES ($1,$2,$3,$4,$5)`,
        [orderId, i.id, i.qty, i.price, i.note || ""]
      );
    }

    res.json({ id: orderId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Fehler beim Anlegen der Bestellung" });
  }
});

// --- Shop Status ---
app.get("/api/status", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM status LIMIT 1");
    res.json(result.rows[0] || {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Fehler beim Laden des Status" });
  }
});

app.post("/api/status", async (req, res) => {
  const { status } = req.body;
  try {
    await db.query("DELETE FROM status");
    await db.query("INSERT INTO status (override) VALUES ($1)", [status]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Fehler beim Setzen des Status" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log("Server läuft auf Port " + PORT
