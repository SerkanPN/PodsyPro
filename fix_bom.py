import json
with open('package.json', 'r', encoding='utf-8-sig') as f:
    data = json.load(f)
with open('package.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2)
