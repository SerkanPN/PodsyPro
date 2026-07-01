import json
import re

with open(r'C:\Users\Administrator\.gemini\antigravity\brain\12544dd1-5ceb-4f54-8e3e-3b35e5d27b9c\.system_generated\logs\transcript.jsonl', 'r', encoding='utf-8') as f:
    for line in f:
        if 'USER_INPUT' in line:
            try:
                data = json.loads(line)
                if 'secret' in data.get('content', '').lower() or 'shared' in data.get('content', '').lower() or 'etsy' in data.get('content', '').lower():
                    print("USER SAID:", data.get('content')[:1000])
            except:
                pass
