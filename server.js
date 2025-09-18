const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { Pool } = require("pg");

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(bodyParser.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// === Produkte abrufen ===
app.get("/api/products", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM products ORDER BY id DESC");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Fehler beim Laden der Produkte" });
  }
});

// === Bestellung absenden ===
app.post("/api/orders", async (req, res) => {
  const { customer, items, payment, coupon, delivery_method } = req.body;

  if (!customer || !items || items.length === 0) {
    return res.status(400).json({ error: "Ungültige Bestellung" });
  }

  try {
    const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);

    const insert = await pool.query(
      `INSERT INTO orders 
       (customer_name, customer_phone, customer_address, customer_plz, customer_city, payment, total, delivery_method, items, created) 
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
       RETURNING id`,
      [
        customer.name,
        customer.phone,
        customer.address,
        customer.plz,
        customer.city,
        payment,
        total,
        delivery_method || null,   // <--- hier speichern wir Lieferung/Abholung
        JSON.stringify(items),
      ]
    );

    res.json({ id: insert.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Fehler beim Speichern der Bestellung" });
  }
});

// === Bestellungen abrufen ===
app.get("/api/orders", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM orders ORDER BY id DESC");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Fehler beim Laden der Bestellungen" });
  }
});

// === Coupons ===
app.get("/api/coupons", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM coupons ORDER BY id DESC");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Fehler beim Laden der Coupons" });
  }
});

app.post("/api/coupons", async (req, res) => {
  const { code, discount_percent } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO coupons (code, discount_percent) VALUES ($1, $2) RETURNING id",
      [code, discount_percent]
    );
    res.json({ id: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Fehler beim Speichern des Coupons" });
  }
});

app.delete("/api/coupons/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM coupons WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Fehler beim Löschen des Coupons" });
  }
});

app.listen(port, () => {
  console.log(Server läuft auf Port ${port});
});
