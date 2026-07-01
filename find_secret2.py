import json
import re

with open(r'C:\Users\Administrator\.gemini\antigravity\brain\12544dd1-5ceb-4f54-8e3e-3b35e5d27b9c\.system_generated\logs\transcript_full.jsonl', 'r', encoding='utf-8') as f:
    for line in f:
        if 'USER_INPUT' in line:
            try:
                data = json.loads(line)
                text = data.get('content', '')
                if 'secret' in text.lower() or len(text.strip()) == 10:
                    print("USER SAID:", text[:500].strip())
            except:
                pass
