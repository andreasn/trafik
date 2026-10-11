"""Temporary: print RS Tab 1 of the newest Körsträckor workbook and the national car series."""
import io
import json
import re
import urllib.parse
import urllib.request

import openpyxl

HEADERS = {"User-Agent": "Mozilla/5.0 (trafik data probe)"}
page = urllib.request.urlopen(urllib.request.Request("https://www.trafa.se/vagtrafik/korstrackor/", headers=HEADERS), timeout=60).read().decode()
links = sorted(set(re.findall(r'href="([^"]+korstrackor[^"]+\.xlsx)"', page, re.I)))
print("links:", links)
newest = max(links, key=lambda href: re.findall(r"/(20\d\d)/", href)[0])
url = urllib.request.urljoin("https://www.trafa.se/", newest)
print("newest:", url)
body = urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=60).read()
book = openpyxl.load_workbook(io.BytesIO(body), data_only=True)
sheet = book["RS Tab 1"]
for row in sheet.iter_rows(values_only=True):
    if any(c is not None for c in row):
        print([c for c in row])

query = "t04010|ar|fslag:10|fordonkm"
api = f"https://api.trafa.se/api/data?{urllib.parse.urlencode({'lang': 'sv', 'query': query}, safe='|:,')}"
result = json.loads(urllib.request.urlopen(api, timeout=60).read().decode("utf-8-sig"))
print(query, len(result["Rows"]), "rows")
for row in result["Rows"]:
    cells = {c["Column"]: c["Value"] for c in row["Cell"]}
    print("  ", cells)
