"""Temporary: which t04010 queries with county return rows?"""
import json
import urllib.parse
import urllib.request

for query in [
    "t04010|ar|reglan|fordonkm",
    "t04010|ar|reglan|korstr",
    "t04010|ar|reglan|mkorstr",
    "t04010|ar:2024|reglan|mkorstr",
    "t04010|ar:2024|fslag:10|reglan|mkorstr",
    "t04010|ar:2024|fslag:10|mkorstr",
    "t04010|ar:2024|fslag:10|korstr",
    "t04010|ar:2024|fslag:10|fordonkm",
    "t04010|ar:2024|reglan",
    "t04010|reglan|mkorstr",
]:
    url = f"https://api.trafa.se/api/data?{urllib.parse.urlencode({'lang': 'sv', 'query': query}, safe='|:,')}"
    with urllib.request.urlopen(url, timeout=60) as response:
        result = json.loads(response.read().decode("utf-8-sig"))
    rows = result.get("Rows") or []
    print(f"{query}: {len(rows)} rows, errors={result.get('Errors')}, header={[h.get('Column') for h in result.get('Header', {}).get('Column', [])] if isinstance(result.get('Header'), dict) else result.get('Header')}")
    if rows:
        print("   first:", json.dumps(rows[0], ensure_ascii=False)[:400])
