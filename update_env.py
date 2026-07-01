import sys

with open('main.py', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace(
    'SECRET_KEY = os.getenv("SECRET_KEY", "TRENDSAVVY_SUPER_SECRET_KEY_CHANGE_ME")',
    'SECRET_KEY = os.getenv("SECRET_KEY", "TRENDSAVVY_SUPER_SECRET_KEY_CHANGE_ME") # LUTFEN BUNU DEGISTIRIN VEYA .ENV KULLANIN'
)

with open('main.py', 'w', encoding='utf-8') as f:
    f.write(content)
