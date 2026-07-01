import sys

with open('main.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Add ETSY_APP_SECRET
if 'ETSY_APP_SECRET' not in content:
    content = content.replace(
        'ETSY_APP_ID = os.getenv("ETSY_APP_ID", "34axrr0o1tzjvfcdn2mexpp4")',
        'ETSY_APP_ID = os.getenv("ETSY_APP_ID", "34axrr0o1tzjvfcdn2mexpp4")\nETSY_APP_SECRET = os.getenv("ETSY_APP_SECRET", "")'
    )

# Add client_secret to payload
if '"client_secret": ETSY_APP_SECRET' not in content:
    content = content.replace(
        '"client_id": ETSY_APP_ID,\n          "redirect_uri"',
        '"client_id": ETSY_APP_ID,\n          "client_secret": ETSY_APP_SECRET,\n          "redirect_uri"'
    )

with open('main.py', 'w', encoding='utf-8') as f:
    f.write(content)
