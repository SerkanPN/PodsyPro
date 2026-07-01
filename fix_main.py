import requests
import sqlite3
import json

with open('main.py', 'r', encoding='utf-8') as f:
    lines = f.readlines()

start_idx = -1
for i, line in enumerate(lines):
    if line.startswith('def etsy_callback(code: str'):
        start_idx = i - 1
        break

if start_idx != -1:
    new_lines = lines[:start_idx]
    with open('main.py', 'w', encoding='utf-8') as f:
        f.writelines(new_lines)
        f.write('''
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
''')
