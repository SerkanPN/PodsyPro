import os

with open('main.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace Redirect URI
content = content.replace(
    'REDIRECT_URI = "http://localhost:5173/etsy/callback"',
    'REDIRECT_URI = "https://podsy.pro/etsy/callback"'
)

# Replace CORS
content = content.replace(
    'allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],',
    'allow_origins=["https://podsy.pro", "https://www.podsy.pro", "http://localhost:5173"],'
)

with open('main.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("Updated main.py")
