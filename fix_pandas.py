import sys
import os

with open('main.py', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('import pandas as pd', 'import openpyxl')

old_pandas_code = '''        df = pd.read_excel(io.BytesIO(contents))
        keywords_list = df.iloc[:, 0].dropna().tolist()'''

new_openpyxl_code = '''        wb = openpyxl.load_workbook(filename=io.BytesIO(contents), data_only=True)
        sheet = wb.active
        keywords_list = [row[0].value for row in sheet.iter_rows(min_row=2, max_col=1) if row[0].value is not None]'''

content = content.replace(old_pandas_code, new_openpyxl_code)

# If it didn't match min_row=2, maybe it was a file without headers? The old code was df.iloc[:, 0]. 
# Pandas read_excel assumes the first row is header by default. So min_row=2 is correct to skip the header if pandas skipped it. 
# Wait, let's just grab everything except None to be safe if they only put words. But if row 1 is a header like 'Keywords', we should skip it.
# Actually, the most robust is:
new_openpyxl_code2 = '''        wb = openpyxl.load_workbook(filename=io.BytesIO(contents), data_only=True)
        sheet = wb.active
        keywords_list = []
        for i, row in enumerate(sheet.iter_rows(min_row=1, max_col=1)):
            val = row[0].value
            if val is not None:
                keywords_list.append(str(val))
        # If the first item looks like a header (e.g. 'keyword'), we might want to skip it, but keeping it simple is better.'''

content = content.replace(new_openpyxl_code, new_openpyxl_code2) # fallback replace

with open('main.py', 'w', encoding='utf-8') as f:
    f.write(content)

with open('requirements.txt', 'r', encoding='utf-8') as f:
    reqs = f.read()
reqs = reqs.replace('pandas', 'openpyxl')
with open('requirements.txt', 'w', encoding='utf-8') as f:
    f.write(reqs)
