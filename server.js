import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import fetch from 'node-fetch';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY || "TRENDSAVVY_SUPER_SECRET_KEY_CHANGE_ME";
const ETSY_API_KEY = process.env.ETSY_API_KEY || "34axrr0o1tzjvfcdn2mexpp4";
const ETSY_SHARED_SECRET = process.env.ETSY_SHARED_SECRET || "f5njckm23y";
const REDIRECT_URI = process.env.REDIRECT_URI || "https://podsy.pro/etsy/callback";
const BASE_URL = "https://openapi.etsy.com/v3/application";

const db = new Database('podsypro.db');
const rawDb = new Database('etsy_raw_data.db');

// --- DATABASE SETUP ---
rawDb.exec(`
  CREATE TABLE IF NOT EXISTS raw_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_id TEXT,
    endpoint TEXT,
    data_json TEXT,
    captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS keywords (
    keyword TEXT PRIMARY KEY,
    total_results INTEGER,
    last_scanned TIMESTAMP,
    is_tracked BOOLEAN DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_keywords_is_tracked ON keywords (is_tracked);

  CREATE TABLE IF NOT EXISTS shops (
    shop_id TEXT PRIMARY KEY,
    shop_name TEXT,
    url TEXT,
    icon_url TEXT,
    transaction_sold_count INTEGER,
    review_average REAL,
    review_count INTEGER,
    listing_active_count INTEGER,
    announcement TEXT,
    currency_code TEXT,
    shop_location_country_iso TEXT,
    is_tracked BOOLEAN DEFAULT 0,
    last_scan TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_shops_is_tracked ON shops (is_tracked);

  CREATE TABLE IF NOT EXISTS listings (
    listing_id TEXT PRIMARY KEY,
    shop_id TEXT,
    title TEXT,
    description TEXT,
    url TEXT,
    price REAL,
    currency_code TEXT,
    views INTEGER,
    num_favorers INTEGER,
    quantity INTEGER,
    tags TEXT,
    materials TEXT,
    image_url TEXT,
    is_tracked BOOLEAN DEFAULT 0,
    last_scan TIMESTAMP,
    FOREIGN KEY(shop_id) REFERENCES shops(shop_id)
  );
  CREATE INDEX IF NOT EXISTS idx_listings_is_tracked ON listings (is_tracked);

  CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_id TEXT,
    target_type TEXT, 
    views INTEGER,
    favorites INTEGER,
    quantity INTEGER,
    price REAL,
    transaction_sold_count INTEGER,
    capture_time TIMESTAMP,
    original_price REAL,
    shipping_price REAL,
    badges_json TEXT,
    last_modified_timestamp INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_snapshots_target ON snapshots (target_id, target_type);

  CREATE TABLE IF NOT EXISTS full_json_cache (
    target_id TEXT PRIMARY KEY,
    target_type TEXT,
    data TEXT,
    last_updated TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS variation_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER,
    sku TEXT,
    property_values_json TEXT,
    price REAL,
    quantity INTEGER,
    FOREIGN KEY(snapshot_id) REFERENCES snapshots(id)
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password_hash TEXT,
    role TEXT DEFAULT 'user',
    daily_limit INTEGER DEFAULT 50,
    daily_usage INTEGER DEFAULT 0,
    last_reset_date TEXT,
    subscription_end_date TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS etsy_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    etsy_shop_id TEXT,
    shop_name TEXT,
    access_token TEXT,
    refresh_token TEXT,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS oauth_states (
    state TEXT PRIMARY KEY,
    code_verifier TEXT NOT NULL,
    user_id INTEGER,
    created_at TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS user_tracked_keywords (
    user_id INTEGER,
    keyword TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, keyword)
  );
  CREATE TABLE IF NOT EXISTS user_tracked_shops (
    user_id INTEGER,
    shop_id TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, shop_id)
  );
  CREATE TABLE IF NOT EXISTS user_tracked_listings (
    user_id INTEGER,
    listing_id TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, listing_id)
  );
  CREATE TABLE IF NOT EXISTS user_history_keywords (
    user_id INTEGER,
    keyword TEXT,
    last_viewed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, keyword)
  );
  CREATE TABLE IF NOT EXISTS user_history_shops (
    user_id INTEGER,
    shop_id TEXT,
    last_viewed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, shop_id)
  );
  CREATE TABLE IF NOT EXISTS user_history_listings (
    user_id INTEGER,
    listing_id TEXT,
    last_viewed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, listing_id)
  );
`);

// Admin Setup
const adminUser = db.prepare("SELECT id FROM users WHERE username = 'SerkanPN'").get();
let adminId = adminUser?.id;
if (!adminUser) {
  const result = db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)").run('SerkanPN', 'admin_placeholder', 'admin');
  adminId = result.lastInsertRowid;
}

// Copy global tracks to admin
const trackedKeywords = db.prepare("SELECT keyword FROM keywords WHERE is_tracked = 1").all();
const insertTrackKeyword = db.prepare("INSERT OR IGNORE INTO user_tracked_keywords (user_id, keyword) VALUES (?, ?)");
for (const row of trackedKeywords) insertTrackKeyword.run(adminId, row.keyword);

const trackedShops = db.prepare("SELECT shop_id FROM shops WHERE is_tracked = 1").all();
const insertTrackShop = db.prepare("INSERT OR IGNORE INTO user_tracked_shops (user_id, shop_id) VALUES (?, ?)");
for (const row of trackedShops) insertTrackShop.run(adminId, row.shop_id);

const trackedListings = db.prepare("SELECT listing_id FROM listings WHERE is_tracked = 1").all();
const insertTrackListing = db.prepare("INSERT OR IGNORE INTO user_tracked_listings (user_id, listing_id) VALUES (?, ?)");
for (const row of trackedListings) insertTrackListing.run(adminId, row.listing_id);

db.pragma('journal_mode = WAL');


// --- MIDDLEWARE ---
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (token == null) return res.status(401).json({ detail: "Could not validate credentials" });

  jwt.verify(token, SECRET_KEY, (err, decoded) => {
    if (err) return res.status(401).json({ detail: "Could not validate credentials" });
    
    const user = db.prepare("SELECT id, username, role, daily_limit, daily_usage, subscription_end_date FROM users WHERE username = ?").get(decoded.sub);
    if (!user) return res.status(401).json({ detail: "User not found" });
    
    req.user = user;
    next();
  });
};

const checkAnalysisLimit = (req, res, next) => {
  const user = req.user;
  if (user.role === 'admin') return next();
  
  if (user.subscription_end_date) {
    const endDate = new Date(user.subscription_end_date.split('.')[0] + 'Z');
    if (new Date() > endDate) {
      return res.status(403).json({ detail: "Abonelik süreniz dolmuştur." });
    }
  }
  
  const today = new Date().toISOString().split('T')[0];
  let usage = user.daily_usage || 0;
  const limit = user.daily_limit || 50;
  
  if (user.last_reset_date !== today) {
    usage = 0;
    db.prepare("UPDATE users SET daily_usage = 0, last_reset_date = ? WHERE id = ?").run(today, user.id);
  }
  
  if (usage >= limit) {
    return res.status(403).json({ detail: "Günlük analiz limitinize ulaştınız." });
  }
  
  db.prepare("UPDATE users SET daily_usage = daily_usage + 1 WHERE id = ?").run(user.id);
  next();
};

const injectTrackingStatusToListings = (listings, userId) => {
  if (!listings || listings.length === 0) return listings;
  if (!userId) {
    listings.forEach(l => l.is_tracked = 0);
    return listings;
  }
  const listingIds = listings.map(l => String(l.listing_id)).filter(id => id);
  if (listingIds.length === 0) return listings;
  
  const placeholders = listingIds.map(() => '?').join(',');
  const tracked = db.prepare(`SELECT listing_id FROM user_tracked_listings WHERE user_id = ? AND listing_id IN (${placeholders})`).all(userId, ...listingIds);
  const trackedSet = new Set(tracked.map(r => String(r.listing_id)));
  
  listings.forEach(l => {
    l.is_tracked = trackedSet.has(String(l.listing_id)) ? 1 : 0;
  });
  return listings;
};

// --- AUTH ENDPOINTS ---
app.post("/api/register", async (req, res) => {
  const { username, password } = req.body;
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (existing) return res.status(400).json({ detail: "Username already registered" });
  
  const hashedPw = await bcrypt.hash(password, 10);
  db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(username, hashedPw);
  res.json({ msg: "User created successfully" });
});

app.post("/api/login", async (req, res) => {
  // Using JSON body or form data
  const username = req.body.username;
  const password = req.body.password;
  
  const user = db.prepare("SELECT id, password_hash FROM users WHERE username = ?").get(username);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(400).json({ detail: "Incorrect username or password" });
  }
  
  const token = jwt.sign({ sub: username }, SECRET_KEY, { expiresIn: '7d' });
  res.json({ access_token: token, token_type: "bearer" });
});

app.get("/api/me", authenticateToken, (req, res) => {
  res.json({ username: req.user.username, id: req.user.id });
});

// --- ETSY OAUTH ENDPOINTS ---
const generatePkceChallenge = () => {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
};

app.get("/etsy/connect", (req, res) => {
  const { codeVerifier, codeChallenge } = generatePkceChallenge();
  const state = crypto.randomBytes(16).toString('base64url');
  
  db.prepare("INSERT INTO oauth_states (state, code_verifier, created_at) VALUES (?, ?, ?)").run(
    state, codeVerifier, new Date().toISOString()
  );
  
  const scopes = "listings_w listings_r listings_d shops_r shops_w transactions_r transactions_w profile_r email_r";
  const encodedScopes = encodeURIComponent(scopes);
  const authUrl = `https://www.etsy.com/oauth/connect?response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodedScopes}&client_id=${ETSY_API_KEY}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;
  
  res.json({ auth_url: authUrl });
});

app.post("/etsy/callback", async (req, res) => {
  const { code, state } = req.body;
  const stateRow = db.prepare("SELECT code_verifier FROM oauth_states WHERE state = ?").get(state);
  
  if (!stateRow) return res.status(400).json({ detail: "Invalid state or session expired" });
  
  const codeVerifier = stateRow.code_verifier;
  db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);
  
  const tokenResponse = await fetch("https://api.etsy.com/v3/public/oauth/token", {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: ETSY_API_KEY,
      redirect_uri: REDIRECT_URI,
      code,
      code_verifier: codeVerifier
    })
  });
  
  if (!tokenResponse.ok) return res.status(400).json({ detail: `Failed to get token: ${await tokenResponse.text()}` });
  
  const tokenData = await tokenResponse.json();
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
  
  let shopName = null;
  let etsyShopId = null;
  let userId = null;
  let etsyUsername = null;
  
  const meResponse = await fetch("https://api.etsy.com/v3/application/users/me", {
    headers: { "x-api-key": ETSY_API_KEY, "Authorization": `Bearer ${tokenData.access_token}` }
  });
  
  if (meResponse.ok) {
    const meData = await meResponse.json();
    etsyUsername = `etsy_${meData.user_id}`;
    
    // Check if user exists, if not create
    let userRecord = db.prepare("SELECT id FROM users WHERE username = ?").get(etsyUsername);
    if (!userRecord) {
      const result = db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(etsyUsername, '');
      userId = result.lastInsertRowid;
    } else {
      userId = userRecord.id;
    }
    
    const shopResponse = await fetch(`https://api.etsy.com/v3/application/users/${meData.user_id}/shops`, {
      headers: { "x-api-key": ETSY_API_KEY, "Authorization": `Bearer ${tokenData.access_token}` }
    });
    
    if (shopResponse.ok) {
      const shopData = await shopResponse.json();
      shopName = shopData.shop_name;
      etsyShopId = shopData.shop_id;
      
      db.prepare(`
        INSERT INTO etsy_connections (user_id, etsy_shop_id, shop_name, access_token, refresh_token, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(userId, etsyShopId, shopName, tokenData.access_token, tokenData.refresh_token, expiresAt);
    } else {
      db.prepare(`
        INSERT INTO etsy_connections (user_id, access_token, refresh_token, expires_at)
        VALUES (?, ?, ?, ?)
      `).run(userId, tokenData.access_token, tokenData.refresh_token, expiresAt);
    }
    
    const token = jwt.sign({ sub: etsyUsername }, SECRET_KEY, { expiresIn: '7d' });
    return res.json({ access_token: token, token_type: "bearer", msg: "Connected successfully", shop_name: shopName });
  }
  
  return res.status(400).json({ detail: "Failed to fetch Etsy user profile" });
});

app.get("/api/me/shops", authenticateToken, (req, res) => {
  const shops = db.prepare("SELECT id, etsy_shop_id, shop_name, expires_at FROM etsy_connections WHERE user_id = ?").all(req.user.id);
  res.json(shops);
});


// --- MAIN ENDPOINTS ---

app.get("/search/:keyword", authenticateToken, checkAnalysisLimit, async (req, res) => {
  const keyword = req.params.keyword.trim();
  const offset = parseInt(req.query.offset) || 0;
  const forceRefresh = req.query.force_refresh === 'true';
  const cacheKey = `${keyword}_offset_${offset}`;
  
  const cached = db.prepare("SELECT data FROM full_json_cache WHERE target_id = ? AND target_type = 'keyword'").get(cacheKey);
  
  if (cached && !forceRefresh) {
    let cachedRes = JSON.parse(cached.data);
    cachedRes.listings = injectTrackingStatusToListings(cachedRes.listings, req.user.id);
    const kRow = db.prepare("SELECT keyword FROM user_tracked_keywords WHERE user_id = ? AND keyword = ?").get(req.user.id, keyword);
    cachedRes.is_tracked = kRow ? 1 : 0;
    db.prepare("INSERT OR REPLACE INTO user_history_keywords (user_id, keyword, last_viewed) VALUES (?, ?, CURRENT_TIMESTAMP)").run(req.user.id, keyword);
    return res.json(cachedRes);
  }
  
  const authString = `${ETSY_API_KEY}:${ETSY_SHARED_SECRET}`;
  
  const etsyRes = await fetch(`${BASE_URL}/listings/active?keywords=${encodeURIComponent(keyword)}&limit=100&offset=${offset}&includes=Images,Shop&sort_on=score&sort_order=desc`, {
    headers: { "x-api-key": authString }
  });
  
  if (!etsyRes.ok) return res.json({ http_error: etsyRes.status, msg: await etsyRes.text() });
  
  const data = await etsyRes.json();
  const count = data.count || 0;
  const results = data.results || [];
  
  if (offset === 0) {
    db.prepare("INSERT OR IGNORE INTO keywords (keyword, total_results, last_scanned, is_tracked) VALUES (?, ?, ?, 0)").run(keyword, count, new Date().toISOString());
    db.prepare("UPDATE keywords SET total_results = ?, last_scanned = ? WHERE keyword = ?").run(count, new Date().toISOString(), keyword);
  }
  
  const parsedResults = [];
  const insertShop = db.prepare("INSERT OR IGNORE INTO shops (shop_id, shop_name, icon_url) VALUES (?, ?, ?)");
  const updateShop = db.prepare("UPDATE shops SET shop_name = ?, icon_url = ? WHERE shop_id = ?");
  const insertListing = db.prepare(`
    INSERT OR REPLACE INTO listings 
    (listing_id, shop_id, title, url, price, currency_code, views, num_favorers, quantity, tags, materials, image_url, last_scan, is_tracked) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT is_tracked FROM listings WHERE listing_id = ?), 0))
  `);
  const insertSnapshot = db.prepare("INSERT INTO snapshots (target_id, target_type, views, favorites, quantity, price, capture_time) VALUES (?, 'listing', ?, ?, ?, ?, ?)");
  
  for (const item of results) {
    const l_id = String(item.listing_id);
    let img_url = "";
    const img_data = item.images || item.Images || [];
    if (img_data.length > 0) img_url = img_data[0].url_570xN || img_data[0].url_fullxfull || "";
    
    if (!img_url) {
      const dbImg = db.prepare("SELECT image_url FROM listings WHERE listing_id = ?").get(l_id);
      if (dbImg && dbImg.image_url) img_url = dbImg.image_url;
    }
    
    const shop_data = item.shop || item.Shop || {};
    const s_id = String(shop_data.shop_id || "");
    const shop_name = shop_data.shop_name || "";
    const icon_url = shop_data.icon_url_fullxfull || "";
    
    const p_data = item.price || {};
    const price_val = p_data ? (parseFloat(p_data.amount || 0) / parseFloat(p_data.divisor || 1)) : 0.0;
    
    insertShop.run(s_id, shop_name, icon_url);
    updateShop.run(shop_name, icon_url, s_id);
    
    const now = new Date().toISOString();
    insertListing.run(
      l_id, s_id, item.title, item.url, price_val, p_data.currency_code, 
      item.views, item.num_favorers, item.quantity, 
      JSON.stringify(item.tags || []), JSON.stringify(item.materials || []), img_url, 
      now, l_id
    );
    
    insertSnapshot.run(l_id, item.views, item.num_favorers, item.quantity, price_val, now);
    
    parsedResults.push({
      listing_id: l_id, title: item.title, shop_name: shop_name, price: price_val,
      currency: p_data.currency_code, views: item.views, favorites: item.num_favorers,
      img_url: img_url, image: img_url, image_url: img_url, is_tracked: 0
    });
  }
  
  const finalResponse = { keyword, total_count: count, offset, listings: parsedResults };
  db.prepare("INSERT OR REPLACE INTO full_json_cache (target_id, target_type, data, last_updated) VALUES (?, 'keyword', ?, ?)").run(
    cacheKey, JSON.stringify(finalResponse), new Date().toISOString()
  );
  
  finalResponse.listings = injectTrackingStatusToListings(finalResponse.listings, req.user.id);
  const kRow2 = db.prepare("SELECT keyword FROM user_tracked_keywords WHERE user_id = ? AND keyword = ?").get(req.user.id, keyword);
  finalResponse.is_tracked = kRow2 ? 1 : 0;
  db.prepare("INSERT OR REPLACE INTO user_history_keywords (user_id, keyword, last_viewed) VALUES (?, ?, CURRENT_TIMESTAMP)").run(req.user.id, keyword);
  
  res.json(finalResponse);
});

app.get("/shop/:shop_id", authenticateToken, checkAnalysisLimit, async (req, res) => {
  const shopId = req.params.shop_id;
  const forceRefresh = req.query.force_refresh === 'true';
  const cached = db.prepare("SELECT data FROM full_json_cache WHERE target_id = ? AND target_type = 'shop'").get(shopId);
  
  if (cached && !forceRefresh) {
    let cachedRes = JSON.parse(cached.data);
    const history = db.prepare("SELECT capture_time, transaction_sold_count FROM snapshots WHERE target_id = ? AND target_type = 'shop' ORDER BY capture_time DESC").all(shopId);
    cachedRes.history = history;
    cachedRes.listings = injectTrackingStatusToListings(cachedRes.listings || [], req.user.id);
    const sRow = db.prepare("SELECT shop_id FROM user_tracked_shops WHERE user_id = ? AND shop_id = ?").get(req.user.id, shopId);
    if(cachedRes.shop) cachedRes.shop.is_tracked = sRow ? 1 : 0;
    db.prepare("INSERT OR REPLACE INTO user_history_shops (user_id, shop_id, last_viewed) VALUES (?, ?, CURRENT_TIMESTAMP)").run(req.user.id, shopId);
    return res.json(cachedRes);
  }
  
  const authString = `${ETSY_API_KEY}:${ETSY_SHARED_SECRET}`;
  const shopRes = await fetch(`${BASE_URL}/shops/${shopId}`, { headers: { "x-api-key": authString } });
  if (!shopRes.ok) return res.json({ ERROR: { http_error: shopRes.status, msg: await shopRes.text() } });
  
  const shopCore = await shopRes.json();
  const iconUrl = shopCore.icon_url_fullxfull || "";
  
  db.prepare("INSERT OR IGNORE INTO shops (shop_id, shop_name, icon_url, is_tracked) VALUES (?, ?, ?, 0)").run(shopId, shopCore.shop_name, iconUrl);
  db.prepare("UPDATE shops SET shop_name = ?, icon_url = ? WHERE shop_id = ?").run(shopCore.shop_name, iconUrl, shopId);
  
  const listingsRes = await fetch(`${BASE_URL}/shops/${shopId}/listings/active?limit=50&includes=Images`, { headers: { "x-api-key": authString } });
  const rawListings = listingsRes.ok ? (await listingsRes.json()).results || [] : [];
  
  const parsedShopListings = [];
  const insertListing = db.prepare(`
    INSERT OR IGNORE INTO listings (listing_id, shop_id, title, price, currency_code, views, num_favorers, quantity, image_url, is_tracked) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `);
  
  for (const item of rawListings) {
    const l_id = String(item.listing_id);
    let img_url = "";
    const img_data = item.images || item.Images || [];
    if (img_data.length > 0) img_url = img_data[0].url_570xN || "";
    
    const p_data = item.price || {};
    const price_val = p_data ? (parseFloat(p_data.amount || 0) / parseFloat(p_data.divisor || 1)) : 0.0;
    
    insertListing.run(l_id, shopId, item.title, price_val, p_data.currency_code, item.views, item.num_favorers, item.quantity, img_url);
    
    parsedShopListings.push({
      listing_id: l_id, title: item.title, views: item.views, num_favorers: item.num_favorers, quantity: item.quantity,
      price: price_val, currency_code: p_data.currency_code || "USD", img_url, image: img_url, image_url: img_url, is_tracked: 0
    });
  }
  
  db.prepare("INSERT INTO snapshots (target_id, target_type, transaction_sold_count, capture_time) VALUES (?, 'shop', ?, ?)").run(
    shopId, shopCore.transaction_sold_count || 0, new Date().toISOString()
  );
  
  const history = db.prepare("SELECT capture_time, transaction_sold_count FROM snapshots WHERE target_id = ? AND target_type = 'shop' ORDER BY capture_time DESC").all(shopId);
  const finalResponse = { shop: shopCore, listings: parsedShopListings, history };
  
  db.prepare("INSERT OR REPLACE INTO full_json_cache (target_id, target_type, data, last_updated) VALUES (?, 'shop', ?, ?)").run(
    shopId, JSON.stringify(finalResponse), new Date().toISOString()
  );
  
  finalResponse.listings = injectTrackingStatusToListings(finalResponse.listings, req.user.id);
  const sRow2 = db.prepare("SELECT shop_id FROM user_tracked_shops WHERE user_id = ? AND shop_id = ?").get(req.user.id, shopId);
  finalResponse.shop.is_tracked = sRow2 ? 1 : 0;
  db.prepare("INSERT OR REPLACE INTO user_history_shops (user_id, shop_id, last_viewed) VALUES (?, ?, CURRENT_TIMESTAMP)").run(req.user.id, shopId);
  
  res.json(finalResponse);
});

app.get("/listing/:listing_id", authenticateToken, checkAnalysisLimit, async (req, res) => {
  const listingId = req.params.listing_id;
  const forceRefresh = req.query.force_refresh === 'true';
  const cached = db.prepare("SELECT data FROM full_json_cache WHERE target_id = ? AND target_type = 'listing'").get(listingId);
  
  if (cached && !forceRefresh) {
    let cachedRes = JSON.parse(cached.data);
    const history = db.prepare("SELECT capture_time, views, favorites, quantity, price, last_modified_timestamp FROM snapshots WHERE target_id = ? AND target_type = 'listing' ORDER BY capture_time DESC").all(listingId);
    cachedRes.history = history;
    const lRow = db.prepare("SELECT is_tracked FROM listings WHERE listing_id = ?").get(listingId);
    if (cachedRes.listing) cachedRes.listing.is_tracked = lRow ? lRow.is_tracked : 0;
    return res.json(cachedRes);
  }
  
  const authString = `${ETSY_API_KEY}:${ETSY_SHARED_SECRET}`;
  const coreRes = await fetch(`${BASE_URL}/listings/${listingId}?includes=Images,Shop,Videos,Inventory`, { headers: { "x-api-key": authString } });
  if (!coreRes.ok) return res.json({ ERROR: { http_error: coreRes.status, msg: await coreRes.text() } });
  const core = await coreRes.json();
  
  const reviewsRes = await fetch(`${BASE_URL}/listings/${listingId}/reviews`, { headers: { "x-api-key": authString } });
  const reviews = reviewsRes.ok ? await reviewsRes.json() : {};
  
  const p_data = core.price || {};
  const price_val = p_data ? (parseFloat(p_data.amount || 0) / parseFloat(p_data.divisor || 1)) : 0.0;
  const original_price_val = p_data.on_sale ? (parseFloat(p_data.original_amount || 0) / parseFloat(p_data.divisor || 1)) : null;
  const badges_json = JSON.stringify(core.badges || []);
  const now = new Date().toISOString();
  
  const insertSnap = db.prepare(`
    INSERT INTO snapshots (target_id, target_type, views, favorites, quantity, price, original_price, badges_json, last_modified_timestamp, capture_time) 
    VALUES (?, 'listing', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(listingId, core.views, core.num_favorers, core.quantity, price_val, original_price_val, badges_json, core.last_modified_timestamp, now);
  
  const snapshotId = insertSnap.lastInsertRowid;
  
  const inventory = core.inventory || {};
  if (inventory.products) {
    const insertVarSnap = db.prepare("INSERT INTO variation_snapshots (snapshot_id, sku, property_values_json, price, quantity) VALUES (?, ?, ?, ?, ?)");
    for (const product of inventory.products) {
      const offering = product.offerings ? product.offerings[0] : {};
      const var_price_data = offering.price || {};
      const var_price = var_price_data ? (parseFloat(var_price_data.amount || 0) / parseFloat(var_price_data.divisor || 1)) : 0.0;
      insertVarSnap.run(snapshotId, product.sku, JSON.stringify(product.property_values || []), var_price, offering.quantity);
    }
  }
  
  const history = db.prepare("SELECT capture_time, views, favorites, quantity, price, last_modified_timestamp FROM snapshots WHERE target_id = ? AND target_type = 'listing' ORDER BY capture_time DESC").all(listingId);
  
  const finalResponse = {
    listing: core,
    reviews: reviews.results || [],
    history,
    price: price_val
  };
  
  db.prepare("INSERT OR REPLACE INTO full_json_cache (target_id, target_type, data, last_updated) VALUES (?, 'listing', ?, ?)").run(
    listingId, JSON.stringify(finalResponse), now
  );
  
  const lRow2 = db.prepare("SELECT listing_id FROM user_tracked_listings WHERE user_id = ? AND listing_id = ?").get(req.user.id, listingId);
  finalResponse.listing.is_tracked = lRow2 ? 1 : 0;
  db.prepare("INSERT OR REPLACE INTO user_history_listings (user_id, listing_id, last_viewed) VALUES (?, ?, CURRENT_TIMESTAMP)").run(req.user.id, listingId);
  
  res.json(finalResponse);
});

app.post("/toggle-follow/:target_type/:target_id", authenticateToken, async (req, res) => {
  const { target_type, target_id } = req.params;
  let table = "", id_col = "";
  if (target_type === "listing") { table = "user_tracked_listings"; id_col = "listing_id"; }
  else if (target_type === "shop") { table = "user_tracked_shops"; id_col = "shop_id"; }
  else if (target_type === "keyword") { table = "user_tracked_keywords"; id_col = "keyword"; }
  else return res.json({ status: "error", message: "Geçersiz target türü" });

  const row = db.prepare(`SELECT * FROM ${table} WHERE user_id = ? AND ${id_col} = ?`).get(req.user.id, target_id);
  
  if (!row) {
    db.prepare(`INSERT INTO ${table} (user_id, ${id_col}) VALUES (?, ?)`).run(req.user.id, target_id);
    if (target_type === "shop") {
      const authString = `${ETSY_API_KEY}:${ETSY_SHARED_SECRET}`;
      const resApi = await fetch(`${BASE_URL}/shops/${target_id}`, { headers: { "x-api-key": authString } });
      if (resApi.ok) {
        const data = await resApi.json();
        db.prepare("INSERT OR IGNORE INTO shops (shop_id, shop_name, icon_url) VALUES (?, ?, ?)").run(target_id, data.shop_name || "", data.icon_url_fullxfull || "");
      }
    } else if (target_type === "keyword") {
      db.prepare("INSERT OR IGNORE INTO keywords (keyword) VALUES (?)").run(target_id);
    } else if (target_type === "listing") {
      const authString = `${ETSY_API_KEY}:${ETSY_SHARED_SECRET}`;
      const resApi = await fetch(`${BASE_URL}/listings/${target_id}?includes=Images`, { headers: { "x-api-key": authString } });
      if (resApi.ok) {
        const data = await resApi.json();
        const img = (data.images && data.images[0]) ? data.images[0].url_570xN : "";
        db.prepare("INSERT OR IGNORE INTO listings (listing_id, image_url) VALUES (?, ?)").run(target_id, img);
      }
    }
  } else {
    db.prepare(`DELETE FROM ${table} WHERE user_id = ? AND ${id_col} = ?`).run(req.user.id, target_id);
  }
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
