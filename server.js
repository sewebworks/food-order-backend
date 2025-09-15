import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import pkg from "pg";
const { Pool } = pkg;

const app = express();
app.use(cors({ origin: "*" }));
app.use(bodyParser.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// === Öffnungszeiten definieren ===
const openingHours = {
  0: [ [17*60, 22*60 - 15] ],                           // Sonntag 17:00–21:45
  1: [],                                                // Montag geschlossen
  2: [ [11*60+30, 13*60+30], [17*60, 22*60 - 15] ],     // Dienstag
  3: [ [11*60+30, 13*60+30], [17*60, 22*60 - 15] ],     // Mittwoch
  4: [ [11*60+30, 13*60+30], [17*60, 22*60 - 15] ],     // Donnerstag
  5: [ [11*60+30, 13*60+30], [17*60, 23*60 - 15] ],     // Freitag
  6: [ [17*60, 23*60 - 15] ]                            // Samstag
};

// === Override Status ===
let overrideStatus = null; 
// null = normale Zeiten, "open" = immer offen, "closed" = immer zu

function isOpenNow(){
  if (overrideStatus === "open") return true;
  if (overrideStatus === "closed") return false;

  const now = new Date();
  const day = now.getDay(); 
  const minutes = now.getHours() * 60 + now.getMinutes();
  const ranges = openingHours[day] || [];
  return ranges.some(([start,end]) => minutes >= start && minutes < end);
}

// === Tabellen anlegen/erweitern ===
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

  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_plz TEXT;`);
  await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_city TEXT;`);

  await pool.query(`CREATE TABLE IF NOT EXISTS coupons (
    id SERIAL PRIMARY KEY,
    code TEXT UNIQUE,
    discount_percent REAL CHECK (discount_percent >= 0 AND discount_percent <= 100)
  );`);
}
initDb().catch(err => console.error("DB init error:", err));

// === Status Endpoints ===
app.get("/api/status", (req,res) => {
  res.json({ override: overrideStatus, open: isOpenNow() });
});

app.post("/api/status", (req,res) => {
  const { status } = req.body;
  if (["open","closed",null].includes(status)) {
    overrideStatus = status;
    return res.json({ success:true, override: status });
  }
  res.status(400).json({ error:"Status muss 'open', 'closed' oder null sein" });
});

// === Health ===
app.get("/api/health", (req,res) => res.json({ ok:true, open:isOpenNow() }));

// === Produkte ===
app.get("/api/products", async (req,res) => {
  const result = await pool.query("SELECT * FROM products ORDER BY id DESC");
  res.json(result.rows);
});

app.post("/api/products", async (req,res) => {
  const { name, description, price, image_url, category } = req.body;
  if (!name || typeof price !== "number") {
    return res.status(400).json({error:"Name und Preis erforderlich"});
  }
  const q = `INSERT INTO products (name, description, price, image_url, category)
             VALUES ($1,$2,$3,$4,$5) RETURNING *`;
  const result = await pool.query(q, [name, description || "", price, image_url || "", category || ""]);
  res.json(result.rows[0]);
});

app.delete("/api/products/:id", async (req,res) => {
  const result = await pool.query("DELETE FROM products WHERE id=$1", [req.params.id]);
  res.json({ deleted: result.rowCount > 0 });
});

// === Coupons ===
app.get("/api/coupons", async (_req,res) => {
  const r = await pool.query("SELECT id, code, discount_percent FROM coupons ORDER BY id DESC");
  res.json(r.rows);
});

app.post("/api/coupons", async (req,res) => {
  let { code, discount_percent } = req.body;
  if (!code) return res.status(400).json({ error: "Code erforderlich" });
  discount_percent = Number(discount_percent);
  if (Number.isNaN(discount_percent) || discount_percent <= 0 || discount_percent > 100)
    return res.status(400).json({ error: "Rabatt in % (1–100) erforderlich" });

  code = String(code).trim().toUpperCase();
  try{
    const r = await pool.query(
      "INSERT INTO coupons (code, discount_percent) VALUES ($1,$2) RETURNING id, code, discount_percent",
      [code, discount_percent]
    );
    res.json(r.rows[0]);
  }catch(e){
    if (e.code === "23505") return res.status(409).json({ error: "Code existiert bereits" });
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/coupons/:id", async (req,res) => {
  const r = await pool.query("DELETE FROM coupons WHERE id=$1", [req.params.id]);
  res.json({ deleted: r.rowCount > 0 });
});

// === Orders ===
app.post("/api/orders", async (req,res) => {
  if(!isOpenNow()){
    return res.status(403).json({ error:"Der Shop ist derzeit geschlossen. Bitte innerhalb der Öffnungszeiten bestellen." });
  }

  const { customer, items, payment, coupon } = req.body;
  if (!customer?.name || !customer?.phone || !customer?.address || !customer?.plz || !customer?.city) {
    return res.status(400).json({ error:"Name, Telefon, Adresse, PLZ, Stadt sind Pflichtfelder" });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({error:"items required"});
  }

  let total = items.reduce((s,i) => s + i.price*i.qty, 0);

  if (coupon) {
    const c = await pool.query("SELECT * FROM coupons WHERE code=$1", [coupon.trim().toUpperCase()]);
    if (c.rows.length > 0) {
      total = total - (total * c.rows[0].discount_percent / 100);
    }
  }

  const result = await pool.query(
    `INSERT INTO orders (customer_name, customer_phone, customer_address, customer_plz, customer_city, items, total, payment) 
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,total,status`,
    [customer.name, customer.phone, customer.address, customer.plz, customer.city, JSON.stringify(items), total, payment]
  );

  res.json(result.rows[0]);
});

app.get("/api/orders", async (req,res) => {
  const result = await pool.query("SELECT * FROM orders ORDER BY id DESC LIMIT 200");
  res.json(result.rows);
});

// === Server Start ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API running on ${PORT}`));
