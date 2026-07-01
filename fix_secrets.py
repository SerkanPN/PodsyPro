import sys
import os

with open('main.py', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace(
    'ETSY_API_KEY = "34axrr0o1tzjvfcdn2mexpp4"\nETSY_SHARED_SECRET = "f5njekm23y"',
    'ETSY_API_KEY = os.getenv("ETSY_APP_ID", "34axrr0o1tzjvfcdn2mexpp4")\nETSY_SHARED_SECRET = os.getenv("ETSY_APP_SECRET", "f5njekm23y")'
)

with open('main.py', 'w', encoding='utf-8') as f:
    f.write(content)
