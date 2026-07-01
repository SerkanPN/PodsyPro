from fastapi import FastAPI, BackgroundTasks, UploadFile, File, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
import requests
import json
import sqlite3
import time
from datetime import datetime, timedelta
import pandas as pd
import io
import asyncio
import httpx
from contextlib import asynccontextmanager
from apscheduler.schedulers.asyncio import AsyncIOScheduler
import jwt
import bcrypt
import secrets
import hashlib
import base64
import urllib.parse
from pydantic import BaseModel

SECRET_KEY = "TRENDSAVVY_SUPER_SECRET_KEY_CHANGE_ME"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7 # 7 days

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/login")

def verify_password(plain_password, hashed_password):
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))

def get_password_hash(password):
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')

def create_access_token(data: dict, expires_delta: timedelta = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta if expires_delta else timedelta(minutes=15))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

class User(BaseModel):
    username: str
    id: int

DB_NAME = "podsypro.db"

def get_db_conn():
    conn = sqlite3.connect(DB_NAME, timeout=15, check_same_thread=False)
    conn.row_factory = sqlite3.Row # Satırları dict gibi kullanmayı sağlar
    return conn

def get_db():
    db = get_db_conn()
    try:
        yield db
    finally:
        db.close()

def get_current_user(token: str = Depends(oauth2_scheme), conn: sqlite3.Connection = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except jwt.PyJWTError:
        raise credentials_exception
    
    c = conn.cursor()
    c.execute("SELECT id, username FROM users WHERE username = ?", (username,))
    row = c.fetchone()
    if row is None:
        raise credentials_exception
    return User(username=row[1], id=row[0])

# --- SCHEDULER & LIFESPAN ---
scheduler = AsyncIOScheduler()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Uygulama başladığında: Scheduler'ı başlat ve görevi ekle
    scheduler.add_job(background_sync, 'interval', hours=24, id="sync_job") # Günde 1 kez (24 saatte bir) çalıştır
    scheduler.start()
    yield
    # Uygulama kapandığında: Scheduler'ı durdur
    scheduler.shutdown()

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

ETSY_API_KEY = "34axrr0o1tzjvfcdn2mexpp4"
ETSY_SHARED_SECRET = "f5njekm23y"
HEADERS = {"x-api-key": f"{ETSY_API_KEY}:{ETSY_SHARED_SECRET}"}
BASE_URL = "https://openapi.etsy.com/v3/application"
DB_NAME = "podsypro.db"

# --- DATABASE SETUP ---
def init_db():
    conn = sqlite3.connect(DB_NAME, timeout=15)
    c = conn.cursor()
    
    c.execute('''CREATE TABLE IF NOT EXISTS keywords (
                 keyword TEXT PRIMARY KEY,
                 total_results INTEGER,
                 last_scanned TIMESTAMP
                 )''')
    try: c.execute("ALTER TABLE keywords ADD COLUMN is_tracked BOOLEAN DEFAULT 0")
    except: pass
                 
    # Performans için sık kullanılan sütunlara index ekleyelim
    c.execute("CREATE INDEX IF NOT EXISTS idx_listings_is_tracked ON listings (is_tracked)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_shops_is_tracked ON shops (is_tracked)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_keywords_is_tracked ON keywords (is_tracked)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_snapshots_target ON snapshots (target_id, target_type)")

    c.execute('''CREATE TABLE IF NOT EXISTS users (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 username TEXT UNIQUE NOT NULL,
                 password_hash TEXT NOT NULL,
                 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                 )''')

    c.execute('''CREATE TABLE IF NOT EXISTS oauth_states (
                 state TEXT PRIMARY KEY,
                 code_verifier TEXT NOT NULL,
                 user_id INTEGER NOT NULL,
                 created_at TIMESTAMP,
                 FOREIGN KEY(user_id) REFERENCES users(id)
                 )''')

    c.execute('''CREATE TABLE IF NOT EXISTS etsy_connections (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 user_id INTEGER NOT NULL,
                 etsy_shop_id TEXT,
                 shop_name TEXT,
                 access_token TEXT NOT NULL,
                 refresh_token TEXT NOT NULL,
                 expires_at TIMESTAMP NOT NULL,
                 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                 FOREIGN KEY(user_id) REFERENCES users(id)
                 )''')

    c.execute('''CREATE TABLE IF NOT EXISTS shops (
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
                 )''')

    c.execute('''CREATE TABLE IF NOT EXISTS listings (
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
                 )''')

    c.execute('''CREATE TABLE IF NOT EXISTS snapshots (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 target_id TEXT,
                 target_type TEXT, 
                 views INTEGER,
                 favorites INTEGER,
                 quantity INTEGER,
                 price REAL,
                 transaction_sold_count INTEGER,
                 capture_time TIMESTAMP
                 )''')
                 
    c.execute('''CREATE TABLE IF NOT EXISTS full_json_cache (
                 target_id TEXT PRIMARY KEY,
                 target_type TEXT,
                 data TEXT,
                 last_updated TIMESTAMP
                 )''')

    # --- FİYAT ANALİZİ İÇİN EKLEMELER ---
    try:
        # Snapshots tablosuna indirim, kargo ve rozet bilgilerini ekleyelim
        c.execute("ALTER TABLE snapshots ADD COLUMN original_price REAL")
        c.execute("ALTER TABLE snapshots ADD COLUMN shipping_price REAL")
        c.execute("ALTER TABLE snapshots ADD COLUMN badges_json TEXT")
        c.execute("ALTER TABLE snapshots ADD COLUMN last_modified_timestamp INTEGER")
    except:
        pass # Kolonlar zaten varsa hata vermesini engelle

    # Varyasyonların fiyat/stok geçmişi için yeni bir tablo
    c.execute('''CREATE TABLE IF NOT EXISTS variation_snapshots (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 snapshot_id INTEGER,
                 sku TEXT,
                 property_values_json TEXT,
                 price REAL,
                 quantity INTEGER,
                 FOREIGN KEY(snapshot_id) REFERENCES snapshots(id)
                 )''')

    c.execute('''CREATE TABLE IF NOT EXISTS users (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 username TEXT UNIQUE,
                 password_hash TEXT
                 )''')

    c.execute('''CREATE TABLE IF NOT EXISTS etsy_connections (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 user_id INTEGER,
                 etsy_shop_id TEXT,
                 shop_name TEXT,
                 access_token TEXT,
                 refresh_token TEXT,
                 expires_at TIMESTAMP,
                 FOREIGN KEY(user_id) REFERENCES users(id)
                 )''')

    c.execute('''CREATE TABLE IF NOT EXISTS oauth_states (
                 state TEXT PRIMARY KEY,
                 code_verifier TEXT,
                 user_id INTEGER,
                 created_at TIMESTAMP
                 )''')

    # Web uygulamaları için WAL modunu etkinleştirmek performansı artırır ve kilitlenmeleri azaltır
    c.execute("PRAGMA journal_mode=WAL;")

    conn.commit()
    conn.close()

init_db()

# --- YARDIMCI VERİTABANI FONKSİYONLARI ---
def save_listing_snapshot(c, listing_id, views, favorites, quantity, price):
    c.execute("INSERT INTO snapshots (target_id, target_type, views, favorites, quantity, price, capture_time) VALUES (?, 'listing', ?, ?, ?, ?, ?)", 
              (listing_id, views, favorites, quantity, price, datetime.now().isoformat()))

def save_shop_snapshot(c, shop_id, sold_count):
    c.execute("INSERT INTO snapshots (target_id, target_type, transaction_sold_count, capture_time) VALUES (?, 'shop', ?, ?)", 
              (shop_id, sold_count, datetime.now().isoformat()))

def inject_tracking_status_to_listings(conn: sqlite3.Connection, listings_array: list):
    if not listings_array:
        return listings_array
    
    listing_ids = [item.get("listing_id") for item in listings_array if item.get("listing_id")]
    if not listing_ids:
        return listings_array

    placeholders = ','.join('?' for _ in listing_ids)
    c = conn.cursor()
    c.execute(f"SELECT listing_id, is_tracked FROM listings WHERE listing_id IN ({placeholders})", listing_ids)
    tracked_status = {row["listing_id"]: row["is_tracked"] for row in c.fetchall()}

    for item in listings_array:
        item["is_tracked"] = tracked_status.get(item.get("listing_id"), 0)
    return listings_array

# --- ANA ENDPOINTLER ---

# 1. KEYWORD ARAMA VE KAYDETME (OFFSET EKLENDİ)
@app.get("/search/{keyword}")
async def search_keyword(keyword: str, offset: int = 0, force_refresh: bool = False, conn: sqlite3.Connection = Depends(get_db)):
    keyword = keyword.strip()
    print(f"🔍 KEYWORD TARANIYOR: {keyword} | OFFSET: {offset} | FORCE REFRESH: {force_refresh}")
    c = conn.cursor()
    
    # --- SÜRESİZ CACHE KONTROLÜ ---
    cache_key = f"{keyword}_offset_{offset}"
    c.execute("SELECT data, last_updated FROM full_json_cache WHERE target_id = ? AND target_type = 'keyword'", (cache_key,))
    row = c.fetchone()
    
    if row and not force_refresh:
        cached_res = json.loads(row[0])
        cached_res["listings"] = inject_tracking_status_to_listings(conn, cached_res.get("listings", []))
        c.execute("SELECT is_tracked FROM keywords WHERE keyword = ?", (keyword,))
        k_row = c.fetchone()
        cached_res["is_tracked"] = k_row["is_tracked"] if k_row else 0
        print(f"⚡ {keyword} (Offset: {offset}) VERİTABANINDAN GETİRİLDİ (CACHE)")
        return cached_res
    
    # URL params ve includes düzenlemesi (Limit 100, offset ve sort_order: desc eklendi)
    params = {"keywords": keyword, "limit": 100, "offset": offset, "includes": "Images,Shop", "sort_on": "score", "sort_order": "desc"}
    
    async with httpx.AsyncClient(headers=HEADERS, timeout=30.0) as client:
        r = await client.get(f"{BASE_URL}/listings/active", params=params)
        if r.status_code != 200:
            print(f"API HATA {r.status_code} -> /listings/active")
            return {"http_error": r.status_code, "msg": r.text}
        res = r.json()
    
    # if "http_error" in res or "error" in res:
    #     return {"ERROR": res}
        
    count = res.get("count", 0)
    results = res.get("results", [])
    
    # Sadece ilk aramada (offset 0) toplam sayıyı keyword tablosuna yaz
    if offset == 0:
        c.execute("INSERT OR IGNORE INTO keywords (keyword, total_results, last_scanned, is_tracked) VALUES (?, ?, ?, 0)", (keyword, count, datetime.now().isoformat()))
        c.execute("UPDATE keywords SET total_results = ?, last_scanned = ? WHERE keyword = ?", (count, datetime.now().isoformat(), keyword))
    
    parsed_results = []
    shops_to_save = []
    listings_to_save = []
    snapshots_to_save = []
    for item in results:
        l_id = str(item.get("listing_id"))
        
        # --- GÖRSEL PARSING KISMI ---
        img_url = ""
        img_data = item.get("images") or item.get("Images") or []
        if img_data and isinstance(img_data, list) and len(img_data) > 0:
            first_img = img_data[0]
            img_url = first_img.get("url_570xN") or first_img.get("url_fullxfull") or ""
            
        if not img_url:
            c.execute("SELECT image_url FROM listings WHERE listing_id = ?", (l_id,))
            db_img = c.fetchone()
            if db_img and db_img[0]:
                img_url = db_img[0]
            else:
                async with httpx.AsyncClient(headers=HEADERS, timeout=10.0) as img_client:
                    img_res = await img_client.get(f"{BASE_URL}/listings/{l_id}", params={"includes": "Images"})
                    if img_res.status_code == 200:
                        l_detail = img_res.json()
                        if isinstance(l_detail, dict):
                            l_imgs = l_detail.get("images") or l_detail.get("Images") or []
                            if l_imgs and isinstance(l_imgs, list) and len(l_imgs) > 0:
                                img_url = l_imgs[0].get("url_570xN") or l_imgs[0].get("url_fullxfull") or ""
        
        shop_data = item.get("shop") or item.get("Shop") or {}
        s_id = str(shop_data.get("shop_id", ""))
        shop_name = shop_data.get("shop_name", "")
        icon_url = shop_data.get("icon_url_fullxfull", "")
        
        p_data = item.get("price", {})
        price_val = float(p_data.get("amount", 0)) / float(p_data.get("divisor", 1)) if p_data else 0.0
            
        # Verileri döngü içinde kaydetmek yerine listelerde biriktirelim
        shops_to_save.append((s_id, shop_name, icon_url))
        listings_to_save.append((
            l_id, s_id, item.get("title"), item.get("url"), price_val, p_data.get("currency_code"), 
            item.get("views"), item.get("num_favorers"), item.get("quantity"), 
            json.dumps(item.get("tags", [])), json.dumps(item.get("materials", [])), img_url, 
            datetime.now().isoformat(), l_id
        ))
        snapshots_to_save.append((
            l_id, 'listing', item.get("views"), item.get("num_favorers"), 
            item.get("quantity"), price_val, datetime.now().isoformat()
        ))
        
        parsed_results.append({
            "listing_id": l_id, 
            "title": item.get("title"), 
            "shop_name": shop_name, 
            "price": price_val,
            "currency": p_data.get("currency_code"), 
            "views": item.get("views"), 
            "favorites": item.get("num_favorers"),
            "img_url": img_url,      
            "image": img_url,        
            "image_url": img_url,
            "is_tracked": 0 
        })
    
    # Biriktirilen verileri tek seferde (toplu olarak) veritabanına yazalım
    if shops_to_save:
        c.executemany('''INSERT OR IGNORE INTO shops (shop_id, shop_name, icon_url) VALUES (?, ?, ?)''', shops_to_save)
        c.executemany('''UPDATE shops SET shop_name = ?, icon_url = ? WHERE shop_id = ?''', [(s[1], s[2], s[0]) for s in shops_to_save])

    if listings_to_save:
        c.executemany('''INSERT OR REPLACE INTO listings 
                         (listing_id, shop_id, title, url, price, currency_code, views, num_favorers, quantity, tags, materials, image_url, last_scan, is_tracked) 
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT is_tracked FROM listings WHERE listing_id = ?), 0))''', listings_to_save)

    if snapshots_to_save:
        c.executemany("INSERT INTO snapshots (target_id, target_type, views, favorites, quantity, price, capture_time) VALUES (?, ?, ?, ?, ?, ?, ?)", snapshots_to_save)


    final_response = {"keyword": keyword, "total_count": count, "offset": offset, "listings": parsed_results}
    c.execute("INSERT OR REPLACE INTO full_json_cache (target_id, target_type, data, last_updated) VALUES (?, 'keyword', ?, ?)", (cache_key, json.dumps(final_response), datetime.now().isoformat()))
    
    final_response["listings"] = inject_tracking_status_to_listings(conn, final_response["listings"])
    c.execute("SELECT is_tracked FROM keywords WHERE keyword = ?", (keyword,))
    k_row = c.fetchone()
    final_response["is_tracked"] = k_row["is_tracked"] if k_row else 0
    
    conn.commit()
    
    return final_response


# 3. SHOP RADAR
@app.get("/shop/{shop_id}")
async def get_shop_detail(shop_id: str, force_refresh: bool = False, conn: sqlite3.Connection = Depends(get_db)):
    print(f"🏪 MAĞAZA DETAYI ÇEKİLİYOR: {shop_id} | FORCE REFRESH: {force_refresh}")
    c = conn.cursor()
    
    c.execute("SELECT data, last_updated FROM full_json_cache WHERE target_id = ? AND target_type = 'shop'", (shop_id,))
    row = c.fetchone()
    
    # 24 Saat Sınırı Silindi, Süresiz Localden Yüklenir
    if row and not force_refresh:
        cached_res = json.loads(row[0])
        c.execute("SELECT capture_time, transaction_sold_count FROM snapshots WHERE target_id = ? AND target_type = 'shop' ORDER BY capture_time DESC", (shop_id,))
        cached_res["history"] = [{"capture_time": r["capture_time"], "transaction_sold_count": r["transaction_sold_count"]} for r in c.fetchall()]
        cached_res["listings"] = inject_tracking_status_to_listings(conn, cached_res.get("listings", []))
        c.execute("SELECT is_tracked FROM shops WHERE shop_id = ?", (shop_id,))
        s_row = c.fetchone()
        cached_res["shop"]["is_tracked"] = s_row["is_tracked"] if s_row else 0
        print(f"⚡ MAĞAZA LOKALDEN YÜKLENDİ: {shop_id}")
        return cached_res
    
    async with httpx.AsyncClient(headers=HEADERS, timeout=30.0) as client:
        shop_res = await client.get(f"{BASE_URL}/shops/{shop_id}")
        if shop_res.status_code != 200:
            return {"ERROR": {"http_error": shop_res.status_code, "msg": shop_res.text}}
        shop_core = shop_res.json()
        
        icon_url = shop_core.get("icon_url_fullxfull") or ""
        c.execute("INSERT OR IGNORE INTO shops (shop_id, shop_name, icon_url, is_tracked) VALUES (?, ?, ?, 0)", (shop_id, shop_core.get("shop_name"), icon_url))
        c.execute("UPDATE shops SET shop_name = ?, icon_url = ? WHERE shop_id = ?", (shop_core.get("shop_name"), icon_url, shop_id))

        listings_res = await client.get(f"{BASE_URL}/shops/{shop_id}/listings/active", params={"limit": 50, "includes": "Images"})
        raw_listings = listings_res.json().get("results", []) if listings_res.status_code == 200 else []
        
        parsed_shop_listings = []
        for item in raw_listings:
            l_id = str(item.get("listing_id"))
            
            img_url = ""
            img_data = item.get("images") or item.get("Images") or []
            if img_data and isinstance(img_data, list) and len(img_data) > 0:
                img_url = img_data[0].get("url_570xN") or ""
            
            p_data = item.get("price", {})
            price_val = float(p_data.get("amount", 0)) / float(p_data.get("divisor", 1)) if p_data else 0.0

            c.execute('''INSERT OR IGNORE INTO listings (listing_id, shop_id, title, price, currency_code, views, num_favorers, quantity, image_url, is_tracked) 
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)''', 
                      (l_id, shop_id, item.get("title"), price_val, p_data.get("currency_code"), item.get("views"), item.get("num_favorers"), item.get("quantity"), img_url))

            parsed_item = {
                "listing_id": item.get("listing_id"), "title": item.get("title"), "views": item.get("views"),
                "num_favorers": item.get("num_favorers"), "quantity": item.get("quantity"), "price": price_val,
                "currency_code": p_data.get("currency_code") if p_data else "USD", "img_url": img_url,
                "image": img_url, "image_url": img_url, "is_tracked": 0
            }
            parsed_shop_listings.append(parsed_item)

        save_shop_snapshot(c, shop_id, shop_core.get("transaction_sold_count", 0))
        
        c.execute("SELECT capture_time, transaction_sold_count FROM snapshots WHERE target_id = ? AND target_type = 'shop' ORDER BY capture_time DESC", (shop_id,))
        history = [{"capture_time": r["capture_time"], "transaction_sold_count": r["transaction_sold_count"]} for r in c.fetchall()]
        
        final_response = { "shop": shop_core, "listings": parsed_shop_listings, "history": history }
        
        c.execute("INSERT OR REPLACE INTO full_json_cache (target_id, target_type, data, last_updated) VALUES (?, 'shop', ?, ?)", (shop_id, json.dumps(final_response), datetime.now().isoformat()))

        final_response["listings"] = inject_tracking_status_to_listings(conn, final_response["listings"])
        c.execute("SELECT is_tracked FROM shops WHERE shop_id = ?", (shop_id,))
        s_row = c.fetchone()
        final_response["shop"]["is_tracked"] = s_row["is_tracked"] if s_row else 0

        conn.commit()

        return final_response

# 2. LISTING DERİN ANALİZ (X-RAY)
@app.get("/listing/{listing_id}")
async def get_listing_detail(listing_id: str, force_refresh: bool = False, conn: sqlite3.Connection = Depends(get_db)):
    print(f"📦 LISTING DETAYI ÇEKİLİYOR: {listing_id} | FORCE REFRESH: {force_refresh}")
    c = conn.cursor()
    
    c.execute("SELECT data, last_updated FROM full_json_cache WHERE target_id = ? AND target_type = 'listing'", (listing_id,))
    row = c.fetchone()
    
    # 24 Saat Sınırı Silindi, Süresiz Localden Yüklenir
    if row and not force_refresh:
        cached_res = json.loads(row[0])
        c.execute("SELECT capture_time, views, favorites, quantity, price, last_modified_timestamp FROM snapshots WHERE target_id = ? AND target_type = 'listing' ORDER BY capture_time DESC", (listing_id,))
        cached_res["history"] = [{"capture_time": r["capture_time"], "views": r["views"], "favorites": r["favorites"], "quantity": r["quantity"], "price": r["price"], "last_modified_timestamp": r["last_modified_timestamp"]} for r in c.fetchall()]
        
        c.execute("SELECT is_tracked FROM listings WHERE listing_id = ?", (listing_id,))
        l_row = c.fetchone()
        if cached_res.get("listing"): cached_res["listing"]["is_tracked"] = l_row["is_tracked"] if l_row else 0

        print(f"⚡ ÜRÜN LOKALDEN YÜKLENDİ: {listing_id}")
        return cached_res
    
    async with httpx.AsyncClient(headers=HEADERS, timeout=30.0) as client:
        core_res = await client.get(f"{BASE_URL}/listings/{listing_id}", params={"includes": "Images,Shop,Videos,Inventory"})
        if core_res.status_code != 200:
            return {"ERROR": {"http_error": core_res.status_code, "msg": core_res.text}}
        core = core_res.json()

        reviews_res = await client.get(f"{BASE_URL}/listings/{listing_id}/reviews")
        reviews = reviews_res.json() if reviews_res.status_code == 200 else {}


    c.execute("SELECT capture_time, views, favorites, quantity, price, last_modified_timestamp FROM snapshots WHERE target_id = ? AND target_type = 'listing' ORDER BY capture_time DESC", (listing_id,))
    history = [{"capture_time": r["capture_time"], "views": r["views"], "favorites": r["favorites"], "quantity": r["quantity"], "price": r["price"], "last_modified_timestamp": r["last_modified_timestamp"]} for r in c.fetchall()]

    p_data = core.get("price", {})
    price_val = float(p_data.get("amount", 0)) / float(p_data.get("divisor", 1)) if p_data else 0.0
    original_price_val = float(p_data.get("original_amount", 0)) / float(p_data.get("divisor", 1)) if p_data.get("on_sale") else None
    badges_json = json.dumps(core.get("badges", []))

    # --- YENİ SNAPSHOT KAYIT MANTIĞI ---
    # 1. Ana snapshot'ı kaydet
    c.execute("""
        INSERT INTO snapshots (target_id, target_type, views, favorites, quantity, price, original_price, badges_json, last_modified_timestamp, capture_time) 
        VALUES (?, 'listing', ?, ?, ?, ?, ?, ?, ?, ?)
    """, (listing_id, core.get("views"), core.get("num_favorers"), core.get("quantity"), price_val, original_price_val, badges_json, core.get("last_modified_timestamp"), datetime.now().isoformat()))
    
    snapshot_id = c.lastrowid # Yeni eklenen ana snapshot'ın ID'sini al

    # 2. Varyasyon snapshot'larını kaydet
    inventory = core.get("inventory", {})
    if inventory and "products" in inventory:
        variation_snapshots_to_save = []
        for product in inventory.get("products", []):
            offering = product.get("offerings", [{}])[0]
            var_price_data = offering.get("price", {})
            var_price = float(var_price_data.get("amount", 0)) / float(var_price_data.get("divisor", 1)) if var_price_data else 0.0
            
            variation_snapshots_to_save.append((
                snapshot_id,
                product.get("sku"),
                json.dumps(product.get("property_values", [])),
                var_price,
                offering.get("quantity")
            ))
        
        if variation_snapshots_to_save:
            c.executemany("INSERT INTO variation_snapshots (snapshot_id, sku, property_values_json, price, quantity) VALUES (?, ?, ?, ?, ?)", variation_snapshots_to_save)
    
    final_response = {
        "listing": core,
        "reviews": reviews.get("results", []) if isinstance(reviews, dict) else [],
        "history": history,
        "price": price_val
    }
    
    c.execute("INSERT OR REPLACE INTO full_json_cache (target_id, target_type, data, last_updated) VALUES (?, 'listing', ?, ?)", (listing_id, json.dumps(final_response), datetime.now().isoformat()))
    
    c.execute("SELECT is_tracked FROM listings WHERE listing_id = ?", (listing_id,))
    l_row = c.fetchone()
    final_response["listing"]["is_tracked"] = l_row["is_tracked"] if l_row else 0
    
    conn.commit()
    
    return final_response

# 4. TAKİP ET / TAKİBİ BIRAK (TOGGLE)
@app.post("/toggle-follow/{target_type}/{target_id}")
async def toggle_follow(target_type: str, target_id: str, conn: sqlite3.Connection = Depends(get_db)):
    c = conn.cursor()
    table = ""
    id_col = ""
    if target_type == "listing": table, id_col = "listings", "listing_id"
    elif target_type == "shop": table, id_col = "shops", "shop_id"
    elif target_type == "keyword": table, id_col = "keywords", "keyword"
    else: return {"status": "error", "message": "Geçersiz target türü"}

    c.execute(f"SELECT is_tracked FROM {table} WHERE {id_col} = ?", (target_id,))
    row = c.fetchone()
    
    if not row:
        if target_type == "shop": 
            async with httpx.AsyncClient(headers=HEADERS) as client:
                res = await client.get(f"{BASE_URL}/shops/{target_id}")
                if res.status_code == 200:
                    data = res.json()
                    icon = data.get("icon_url_fullxfull", "")
                    name = data.get("shop_name", "")
                    c.execute("INSERT INTO shops (shop_id, shop_name, icon_url, is_tracked) VALUES (?, ?, ?, 1)", (target_id, name, icon))
        elif target_type == "keyword": 
            c.execute("INSERT INTO keywords (keyword, is_tracked) VALUES (?, 1)", (target_id,))
        elif target_type == "listing": 
            async with httpx.AsyncClient(headers=HEADERS) as client:
                res = await client.get(f"{BASE_URL}/listings/{target_id}", params={"includes": "Images"})
                if res.status_code == 200:
                    data = res.json()
                    img = data.get("images", [{}])[0].get("url_570xN", "")
                    c.execute("INSERT INTO listings (listing_id, image_url, is_tracked) VALUES (?, ?, 1)", (target_id, img))
        new_status = 1
    else:
        new_status = 0 if row["is_tracked"] == 1 else 1
        c.execute(f"UPDATE {table} SET is_tracked = ? WHERE {id_col} = ?", (new_status, target_id))
        
    conn.commit()
    return {"status": "success", "is_tracked": new_status, "target": target_id}

# 5. FAVORİLERİ GETİR
@app.get("/favorites/{target_type}")
async def get_favorites(target_type: str, conn: sqlite3.Connection = Depends(get_db)):
    c = conn.cursor()
    results = []
    
    if target_type == "listings":
        c.execute('''SELECT l.listing_id, l.title, l.price, l.currency_code, l.views, l.num_favorers, l.image_url, s.shop_name 
                     FROM listings l 
                     LEFT JOIN shops s ON l.shop_id = s.shop_id 
                     WHERE l.is_tracked = 1''')
        for r in c.fetchall():
            results.append(dict(r))
    elif target_type == "shops":
        c.execute("SELECT shop_id, shop_name, icon_url, transaction_sold_count, listing_active_count FROM shops WHERE is_tracked = 1")
        for r in c.fetchall():
            results.append(dict(r))
    elif target_type == "keywords":
        c.execute("SELECT keyword, total_results, last_scanned FROM keywords WHERE is_tracked = 1")
        for r in c.fetchall():
            results.append(dict(r))
            
    return results

# 6. TÜM TAKİP EDİLENLERİ GÜNCELLE (SYNC ENGINE)
async def background_sync():
    """
    Takip edilen tüm listing ve shop'ları asenkron olarak günceller.
    API isteklerini `httpx` ile paralel olarak gönderir.
    """
    print(f"🔄 [{datetime.now()}] ASYNC SYNC ENGINE BAŞLADI...")
    conn = get_db_conn() # Yeni bağlantı fonksiyonunu kullan
    c = conn.cursor()
    
    async with httpx.AsyncClient(headers=HEADERS, timeout=30.0) as client:
        sem = asyncio.Semaphore(10)

        async def fetch_listing(l_id):
            async with sem:
                return await client.get(f"{BASE_URL}/listings/{l_id}")

        async def fetch_shop(s_id):
            async with sem:
                return await client.get(f"{BASE_URL}/shops/{s_id}")

        # --- Listings ---
        c.execute("SELECT listing_id FROM listings WHERE is_tracked = 1 AND (views >= 100 OR num_favorers >= 10)")
        listing_ids = [row['listing_id'] for row in c.fetchall()]
        listing_tasks = [fetch_listing(l_id) for l_id in listing_ids]
        listing_responses = await asyncio.gather(*listing_tasks, return_exceptions=True)

        snapshots_to_add = []
        listings_to_update = []
        for res in listing_responses:
            if isinstance(res, httpx.Response) and res.status_code == 200:
                data = res.json().get("results", [{}])[0] # API v3'te sonuçlar results listesinde döner
                if "listing_id" in data:
                    l_id = str(data["listing_id"])
                    p = data.get("price", {})
                    price_val = float(p.get("amount", 0)) / float(p.get("divisor", 1)) if p else 0.0
                    snapshots_to_add.append((l_id, 'listing', data.get("views"), data.get("num_favorers"), data.get("quantity"), price_val, None, data.get("last_modified_timestamp"), datetime.now().isoformat()))
                    listings_to_update.append((data.get("views"), data.get("num_favorers"), data.get("quantity"), price_val, datetime.now().isoformat(), l_id))

        # --- Shops ---
        c.execute("SELECT shop_id FROM shops WHERE is_tracked = 1")
        shop_ids = [row['shop_id'] for row in c.fetchall()]
        shop_tasks = [fetch_shop(s_id) for s_id in shop_ids]
        shop_responses = await asyncio.gather(*shop_tasks, return_exceptions=True)

        shops_to_update = []
        for res in shop_responses:
            if isinstance(res, httpx.Response) and res.status_code == 200:
                data = res.json().get("results", [{}])[0]
                if "shop_id" in data:
                    s_id = str(data["shop_id"])
                    snapshots_to_add.append((s_id, 'shop', None, None, None, None, data.get("transaction_sold_count"), None, datetime.now().isoformat()))
                    shops_to_update.append((data.get("transaction_sold_count"), data.get("listing_active_count"), datetime.now().isoformat(), s_id))

        # Toplu veritabanı yazma
        if snapshots_to_add: c.executemany("INSERT INTO snapshots (target_id, target_type, views, favorites, quantity, price, transaction_sold_count, last_modified_timestamp, capture_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", snapshots_to_add)
        if listings_to_update: c.executemany("UPDATE listings SET views=?, num_favorers=?, quantity=?, price=?, last_scan=? WHERE listing_id=?", listings_to_update)
        if shops_to_update: c.executemany("UPDATE shops SET transaction_sold_count=?, listing_active_count=?, last_scan=? WHERE shop_id=?", shops_to_update)

    conn.commit()
    conn.close()
    print(f"✅ [{datetime.now()}] ASYNC SYNC ENGINE TAMAMLANDI. {len(listings_to_update)} ürün, {len(shops_to_update)} mağaza güncellendi.")

@app.post("/sync-all")
async def trigger_sync(background_tasks: BackgroundTasks):
    background_tasks.add_task(background_sync)
    return {"message": "Tüm veriler arka planda güncelleniyor."}

@app.post("/import-keywords")
async def import_keywords(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    try:
        contents = await file.read()
        df = pd.read_excel(io.BytesIO(contents))
        keywords_list = df.iloc[:, 0].dropna().tolist()
        
        for kw in keywords_list:
            background_tasks.add_task(run_search_for_keyword, str(kw))
            
        return {"status": "success", "message": f"{len(keywords_list)} kelime kuyruğa eklendi ve taranıyor."}
    except Exception as e:
        return {"status": "error", "message": str(e)}

# --- HISTORY SECTION (YENİ) ---
@app.get("/history/{target_type}")
async def get_history(target_type: str, conn: sqlite3.Connection = Depends(get_db)):
    """Veritabanındaki tüm kayıtları (takip durumuna bakmaksızın) listeler."""
    c = conn.cursor()
    results = []
    
    if target_type == "listings":
        c.execute('''SELECT l.listing_id, l.title, l.price, l.currency_code, l.image_url, s.shop_name, l.is_tracked 
                     FROM listings l 
                     LEFT JOIN shops s ON l.shop_id = s.shop_id 
                     ORDER BY l.last_scan DESC LIMIT 500''')
        for r in c.fetchall():
            results.append({
                "listing_id": r["listing_id"], "title": r["title"], "price": r["price"], "currency": r["currency_code"], 
                "image": r["image_url"], "image_url": r["image_url"], "shop_name": r["shop_name"], "is_tracked": r["is_tracked"]
            })
            
    elif target_type == "shops":
        c.execute("SELECT shop_id, shop_name, icon_url, transaction_sold_count, is_tracked FROM shops ORDER BY last_scan DESC LIMIT 500")
        for r in c.fetchall():
            results.append(dict(r))
            
    elif target_type == "keywords":
        c.execute("SELECT keyword, total_results, last_scanned, is_tracked FROM keywords ORDER BY last_scanned DESC LIMIT 500")
        for r in c.fetchall():
            results.append(dict(r))
            
    return results

# Arka plan görevleri için bağımlılık enjeksiyonu olmadan çalışacak bir sarmalayıcı (wrapper)
async def run_search_for_keyword(keyword: str):
    conn = get_db_conn()
    try:
        await search_keyword(keyword=keyword, conn=conn)
    finally:
        conn.close()



class UserCreate(BaseModel):
    username: str
    password: str

@app.post("/api/register")
def register(user: UserCreate, conn: sqlite3.Connection = Depends(get_db)):
    c = conn.cursor()
    c.execute("SELECT id FROM users WHERE username = ?", (user.username,))
    if c.fetchone():
        raise HTTPException(status_code=400, detail="Username already registered")
    
    hashed_pw = get_password_hash(user.password)
    c.execute("INSERT INTO users (username, password_hash) VALUES (?, ?)", (user.username, hashed_pw))
    conn.commit()
    return {"msg": "User created successfully"}

@app.post("/api/login")
def login(form_data: OAuth2PasswordRequestForm = Depends(), conn: sqlite3.Connection = Depends(get_db)):
    c = conn.cursor()
    c.execute("SELECT id, password_hash FROM users WHERE username = ?", (form_data.username,))
    row = c.fetchone()
    if not row or not verify_password(form_data.password, row[1]):
        raise HTTPException(status_code=400, detail="Incorrect username or password")
    
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": form_data.username}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/api/me")
def read_users_me(current_user: User = Depends(get_current_user)):
    return {"username": current_user.username, "id": current_user.id}

# --- ETSY OAUTH 2.0 PKCE ENDPOINTS ---

ETSY_APP_ID = "34axrr0o1tzjvfcdn2mexpp4" # From current API Key
REDIRECT_URI = "http://localhost:5173/oauth/callback"

def generate_pkce_challenge():
    code_verifier = secrets.token_urlsafe(32)
    m = hashlib.sha256()
    m.update(code_verifier.encode('utf-8'))
    code_challenge = base64.urlsafe_b64encode(m.digest()).decode('utf-8').rstrip('=')
    return code_verifier, code_challenge

@app.get("/etsy/connect")
def etsy_connect(current_user: User = Depends(get_current_user), conn: sqlite3.Connection = Depends(get_db)):
    code_verifier, code_challenge = generate_pkce_challenge()
    state = secrets.token_urlsafe(16)
    
    c = conn.cursor()
    c.execute("INSERT INTO oauth_states (state, code_verifier, user_id, created_at) VALUES (?, ?, ?, ?)",
              (state, code_verifier, current_user.id, datetime.utcnow()))
    conn.commit()
    
    scopes = "listings_w listings_r listings_d shops_r shops_w transactions_r transactions_w profile_r email_r"
    encoded_scopes = urllib.parse.quote(scopes)
    
    auth_url = (f"https://www.etsy.com/oauth/connect"
                f"?response_type=code"
                f"&redirect_uri={urllib.parse.quote(REDIRECT_URI)}"
                f"&scope={encoded_scopes}"
                f"&client_id={ETSY_APP_ID}"
                f"&state={state}"
                f"&code_challenge={code_challenge}"
                f"&code_challenge_method=S256")
    
    return {"auth_url": auth_url}


@app.post("/etsy/callback")
def etsy_callback(code: str, state: str, current_user: User = Depends(get_current_user), conn: sqlite3.Connection = Depends(get_db)):
    c = conn.cursor()
    c.execute("SELECT code_verifier FROM oauth_states WHERE state = ? AND user_id = ?", (state, current_user.id))
    row = c.fetchone()
    if not row:
        raise HTTPException(status_code=400, detail="Invalid state or session expired")
    
    code_verifier = row[0]
    c.execute("DELETE FROM oauth_states WHERE state = ?", (state,))
    
    token_url = "https://api.etsy.com/v3/public/oauth/token"
    payload = {
        "grant_type": "authorization_code",
        "client_id": ETSY_APP_ID,
        "redirect_uri": REDIRECT_URI,
        "code": code,
        "code_verifier": code_verifier
    }
    
    resp = requests.post(token_url, json=payload)
    if resp.status_code != 200:
        raise HTTPException(status_code=400, detail=f"Failed to get token: {resp.text}")
    
    token_data = resp.json()
    access_token = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token")
    expires_in = token_data.get("expires_in")
    expires_at = datetime.utcnow() + timedelta(seconds=expires_in)
    
    # Extract etsy_user_id from access_token (format: user_id.token)
    etsy_user_id = access_token.split('.')[0] if '.' in access_token else None
    
    if etsy_user_id:
        shop_resp = requests.get(
            f"https://api.etsy.com/v3/application/users/{etsy_user_id}/shops", 
            headers={
                "x-api-key": f"{ETSY_API_KEY}:{ETSY_SHARED_SECRET}", 
                "Authorization": f"Bearer {access_token}"
            }
        )
        print(f"--- ETSY SHOP FETCH: STATUS {shop_resp.status_code} ---")
        print(f"--- ETSY SHOP RESPONSE: {shop_resp.text} ---")
        if shop_resp.status_code == 200:
            shop_data = shop_resp.json()
            results = shop_data.get("results", [])
            shop_name = None
            etsy_shop_id = None
            if results:
                shop_name = results[0].get("shop_name")
                etsy_shop_id = results[0].get("shop_id")
            
            c.execute("""INSERT INTO etsy_connections 
                         (user_id, etsy_shop_id, shop_name, access_token, refresh_token, expires_at) 
                         VALUES (?, ?, ?, ?, ?, ?)""",
                      (current_user.id, etsy_shop_id, shop_name, access_token, refresh_token, expires_at))
            conn.commit()
            return {"msg": "Connected successfully", "shop_name": shop_name}
    
    # Fallback if getting shop info fails
    c.execute("""INSERT INTO etsy_connections 
                 (user_id, access_token, refresh_token, expires_at) 
                 VALUES (?, ?, ?, ?)""",
              (current_user.id, access_token, refresh_token, expires_at))
    conn.commit()
    return {"msg": "Connected successfully (Shop info missing)"}

@app.get("/api/me/shops")
def get_my_shops(current_user: User = Depends(get_current_user), conn: sqlite3.Connection = Depends(get_db)):
    c = conn.cursor()
    c.execute("SELECT id, etsy_shop_id, shop_name, expires_at FROM etsy_connections WHERE user_id = ?", (current_user.id,))
    shops = [{"id": row[0], "etsy_shop_id": row[1], "shop_name": row[2], "expires_at": row[3]} for row in c.fetchall()]
    return shops

@app.delete("/api/me/shops/{connection_id}")
def delete_my_shop(connection_id: int, current_user: User = Depends(get_current_user), conn: sqlite3.Connection = Depends(get_db)):
    c = conn.cursor()
    c.execute("DELETE FROM etsy_connections WHERE id = ? AND user_id = ?", (connection_id, current_user.id))
    conn.commit()
    return {"msg": "Shop disconnected successfully"}

from pydantic import BaseModel
from typing import Optional, List

@app.get("/api/etsy/connections/{shop_id}/taxonomy")
def get_etsy_taxonomy(shop_id: str, current_user: User = Depends(get_current_user), conn: sqlite3.Connection = Depends(get_db)):
    c = conn.cursor()
    c.execute("SELECT access_token FROM etsy_connections WHERE etsy_shop_id = ? AND user_id = ?", (shop_id, current_user.id))
    row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Connection not found")
    
    access_token = row[0]
    resp = requests.get(
        "https://api.etsy.com/v3/application/seller-taxonomy/nodes",
        headers={
            "x-api-key": f"{ETSY_API_KEY}:{ETSY_SHARED_SECRET}",
            "Authorization": f"Bearer {access_token}"
        }
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=400, detail=f"Failed to fetch taxonomy: {resp.text}")
    return resp.json()

@app.get("/api/etsy/connections/{shop_id}/shipping-profiles")
def get_etsy_shipping_profiles(shop_id: str, current_user: User = Depends(get_current_user), conn: sqlite3.Connection = Depends(get_db)):
    c = conn.cursor()
    c.execute("SELECT access_token, etsy_shop_id FROM etsy_connections WHERE etsy_shop_id = ? AND user_id = ?", (shop_id, current_user.id))
    row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Connection not found")
    
    access_token = row[0]
    etsy_shop_id = row[1]
    
    resp = requests.get(
        f"https://api.etsy.com/v3/application/shops/{etsy_shop_id}/shipping-profiles",
        headers={
            "x-api-key": f"{ETSY_API_KEY}:{ETSY_SHARED_SECRET}",
            "Authorization": f"Bearer {access_token}"
        }
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=400, detail=f"Failed to fetch shipping profiles: {resp.text}")
    return resp.json()

class CreateListingRequest(BaseModel):
    title: str
    description: str
    price: float
    quantity: int
    who_made: str
    when_made: str
    taxonomy_id: int
    shipping_profile_id: Optional[int] = None
    is_supply: bool = False
    type: str = "physical"
    tags: Optional[str] = None
    materials: Optional[str] = None

@app.post("/api/etsy/connections/{shop_id}/create-listing")
def create_etsy_listing(shop_id: str, req: CreateListingRequest, current_user: User = Depends(get_current_user), conn: sqlite3.Connection = Depends(get_db)):
    c = conn.cursor()
    c.execute("SELECT access_token, etsy_shop_id FROM etsy_connections WHERE etsy_shop_id = ? AND user_id = ?", (shop_id, current_user.id))
    row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Connection not found")
    
    access_token = row[0]
    etsy_shop_id = row[1]
    
    payload = {
        "quantity": req.quantity,
        "title": req.title,
        "description": req.description,
        "price": req.price,
        "who_made": req.who_made,
        "when_made": req.when_made,
        "taxonomy_id": req.taxonomy_id,
        "is_supply": "true" if req.is_supply else "false",
        "type": req.type,
    }
    
    if req.shipping_profile_id and req.type == "physical":
        payload["shipping_profile_id"] = req.shipping_profile_id
        
    if req.tags:
        payload["tags"] = [t.strip() for t in req.tags.split(",") if t.strip()]
        
    if req.materials:
        payload["materials"] = [m.strip() for m in req.materials.split(",") if m.strip()]
        
    resp = requests.post(
        f"https://api.etsy.com/v3/application/shops/{etsy_shop_id}/listings",
        headers={
            "x-api-key": f"{ETSY_API_KEY}:{ETSY_SHARED_SECRET}",
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/x-www-form-urlencoded"
        },
        data=payload
    )
    
    if resp.status_code not in (200, 201):
        raise HTTPException(status_code=400, detail=f"Failed to create listing: {resp.text}")
        
    return resp.json()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
