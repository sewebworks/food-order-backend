const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// === DB Verbindung ===
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// === Produkte laden ===
app.get("/api/products", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM products ORDER BY id ASC");
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Fehler beim Laden der Produkte" });
  }
});

// === Produkte hinzufügen ===
app.post("/api/products", async (req, res) => {
  try {
    const { name, description, price, image_url, category, highlight } = req.body;
    await db.query(
      "INSERT INTO products (name, description, price, image_url, category, highlight) VALUES ($1,$2,$3,$4,$5,$6)",
      [name, description, price, image_url, category, highlight]
    );
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Fehler beim Speichern" });
  }
});

// === Produkte löschen ===
app.delete("/api/products/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM products WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Fehler beim Löschen" });
  }
});

// === Coupons ===
app.get("/api/coupons", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM coupons ORDER BY id ASC");
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: "Fehler beim Laden der Coupons" });
  }
});

app.post("/api/coupons", async (req, res) => {
  try {
    const { code, discount_percent } = req.body;
    await db.query(
      "INSERT INTO coupons (code, discount_percent) VALUES ($1,$2)",
      [code, discount_percent]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Fehler beim Speichern des Coupons" });
  }
});

app.delete("/api/coupons/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM coupons WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Fehler beim Löschen des Coupons" });
  }
});

// === Bestellung speichern ===
app.post("/api/orders", async (req, res) => {
  try {
    const { customer, items, payment, coupon } = req.body;

    const result = await db.query(
      "INSERT INTO orders (customer_name, customer_address, customer_plz, customer_city, customer_phone, payment, coupon) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
      [customer.name, customer.address, customer.plz, customer.city, customer.phone, payment, coupon]
    );
    const orderId = result.rows[0].id;

    for (let item of items) {
      await db.query(
        "INSERT INTO order_items (order_id, product_id, name, price, qty, note) VALUES ($1,$2,$3,$4,$5,$6)",
        [orderId, item.id, item.name, item.price, item.qty, item.note || null]
      );
    }

    res.json({
      id: orderId,
      total: items.reduce((s, i) => s + i.price * i.qty, 0)
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Fehler beim Speichern der Bestellung" });
  }
});

// === Bestellungen abrufen ===
app.get("/api/orders", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT o.*, json_agg(json_build_object(
        'id', i.product_id,
        'name', i.name,
        'price', i.price,
        'qty', i.qty,
        'note', i.note
      )) as items
      FROM orders o
      JOIN order_items i ON i.order_id = o.id
      GROUP BY o.id
      ORDER BY o.id DESC
    `);
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Fehler beim Laden der Bestellungen" });
  }
});

// === Shop Status ===
let shopStatus = { override: null, open: true };

app.get("/api/status", (req, res) => {
  res.json({
    ...shopStatus,
    open: shopStatus.override === "open" ? true :
          shopStatus.override === "closed" ? false : shopStatus.open,
    nextOpen: "morgen 11:00"
  });
});

app.post("/api/status", (req, res) => {
  shopStatus.override = req.body.status || null;
  res.json({ success: true });
});

// === Server Start ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server läuft auf Port", PORT));
