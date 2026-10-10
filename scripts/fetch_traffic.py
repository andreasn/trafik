#!/usr/bin/env python3
"""Fetch total vehicle-kilometres driven in Sweden and save them as JSON.

Uses the open API of Trafikanalys (Transport Analysis), the Swedish agency
for official transport statistics. Product t04010 "Trafikarbete" gives the
traffic volume on Swedish roads, all vehicle types together, in millions of
vehicle-kilometres per year. The series starts in 1990, so earlier years in
1975-2025 are listed as unavailable.

Usage:
    python3 scripts/fetch_traffic.py [output-path]

Only the Python standard library is needed. The default output path is
data/traffic.json, relative to the repository root.
"""

import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API_URL = "https://api.trafa.se/api/data"
PRODUCT = "t04010"  # Trafikarbete (traffic volume).
MEASURE = "fordonkm"  # Fordonskilometer, millions of km.
YEARS = list(range(1975, 2026, 5))
DEFAULT_OUTPUT = Path(__file__).resolve().parent.parent / "data" / "traffic.json"


def fetch():
    # Asking for years and the measure only gives the total over vehicle types.
    query = f"{PRODUCT}|ar|{MEASURE}"
    url = f"{API_URL}?{urllib.parse.urlencode({'lang': 'sv', 'query': query}, safe='|')}"
    with urllib.request.urlopen(url, timeout=60) as response:
        return url, json.loads(response.read().decode("utf-8-sig"))


def parse(result):
    if result.get("Errors"):
        sys.exit(f"Trafikanalys returned errors: {result['Errors']}")

    values = {}
    for row in result["Rows"]:
        cells = {cell["Column"]: cell for cell in row["Cell"]}
        value = cells[MEASURE]["Value"].replace(" ", "").replace(" ", "").replace(",", ".")
        if value:
            values[int(cells["ar"]["Value"])] = round(float(value))
    return values


def main():
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUTPUT

    try:
        source_url, result = fetch()
    except urllib.error.HTTPError as error:
        sys.exit(f"Trafikanalys returned HTTP {error.code}: {error.read().decode('utf-8', 'replace')}")
    except urllib.error.URLError as error:
        sys.exit(f"Could not reach Trafikanalys: {error.reason}")

    values = parse(result)
    if not values:
        sys.exit("Trafikanalys returned no data")
    print(f"Trafikanalys has {min(values)}-{max(values)}")

    rows = [{"year": year, "vehicleKmMillions": values[year]} for year in YEARS if year in values]
    unavailable = [year for year in YEARS if year not in values]
    if unavailable and unavailable[-1] > min(values):
        sys.exit(f"Trafikanalys is missing years inside its series: {unavailable}")

    payload = {
        "title": "Traffic volume on Swedish roads, all vehicles",
        "unit": "million vehicle-kilometres",
        "source": f"Trafikanalys, {result.get('Name') or 'Trafikarbete'} ({PRODUCT}, {MEASURE})",
        "sourceUrl": source_url,
        "retrieved": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "unavailableYears": unavailable,
        "data": rows,
    }

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(rows)} years to {output}; unavailable: {unavailable or 'none'}")


if __name__ == "__main__":
    main()
