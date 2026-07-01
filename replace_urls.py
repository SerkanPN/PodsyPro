import os
import glob

def replace_in_files(directory, old_str, new_str):
    for root, dirs, files in os.walk(directory):
        for file in files:
            if file.endswith(('.tsx', '.ts')):
                path = os.path.join(root, file)
                with open(path, 'r', encoding='utf-8') as f:
                    content = f.read()
                if old_str in content:
                    content = content.replace(old_str, new_str)
                    with open(path, 'w', encoding='utf-8') as f:
                        f.write(content)
                    print(f"Updated {path}")

replace_in_files('src', 'http://127.0.0.1:8000', 'https://api.podsy.pro')
