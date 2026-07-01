
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
    
    # We should get the shop info to save shop_name and etsy_shop_id
    shop_resp = requests.get(
        "https://api.etsy.com/v3/application/shops?shop_name=", # wait, we can get me to get shop id
        headers={"x-api-key": ETSY_APP_ID, "Authorization": f"Bearer {access_token}"}
    )
    # Wait, the best way to get shop_id is via the /v3/application/users/me endpoint.
    me_resp = requests.get("https://api.etsy.com/v3/application/users/me", headers={"x-api-key": ETSY_APP_ID, "Authorization": f"Bearer {access_token}"})
    if me_resp.status_code == 200:
        etsy_user_id = me_resp.json().get("user_id")
        shop_resp = requests.get(f"https://api.etsy.com/v3/application/users/{etsy_user_id}/shops", headers={"x-api-key": ETSY_APP_ID, "Authorization": f"Bearer {access_token}"})
        if shop_resp.status_code == 200:
            shop_data = shop_resp.json()
            shop_name = shop_data.get("shop_name")
            etsy_shop_id = shop_data.get("shop_id")
            
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
