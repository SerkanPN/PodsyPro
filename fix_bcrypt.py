import sys

with open('requirements.txt', 'r', encoding='utf-8') as f:
    reqs = f.read()

reqs = reqs.replace('bcrypt', 'bcrypt==3.2.2')

with open('requirements.txt', 'w', encoding='utf-8') as f:
    f.write(reqs)
