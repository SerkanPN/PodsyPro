import httpx
import sys
import re

def check_shop(shop_name):
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
    }
    res = httpx.get(f'https://www.etsy.com/shop/{shop_name}', headers=headers)
    
    html = res.text
    sold_link_pattern = re.compile(rf'href="[^"]*/shop/{shop_name}/sold[^"]*"', re.IGNORECASE)
    admirers_link_pattern = re.compile(rf'href="[^"]*/shop/{shop_name}/favoriters[^"]*"', re.IGNORECASE)
    
    sold_visible = bool(sold_link_pattern.search(html))
    admirers_visible = bool(admirers_link_pattern.search(html))
    
    print(f"Shop: {shop_name}")
    print(f"Sold Visible: {sold_visible}")
    print(f"Admirers Visible: {admirers_visible}")

if __name__ == '__main__':
    check_shop('CaitlynMinimalist')
    check_shop('MignonandMignon')
