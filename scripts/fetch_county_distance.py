#!/usr/bin/env python3
"""Fetch distance driven by passenger cars in each Swedish county from Trafikanalys.

Uses Trafikanalys's open API, product t04010 "Trafikarbete", for passenger
cars (fordonsslag 10) by county of registration: the total distance driven
(korstr) and the average distance per car (mkorstr), both in Swedish miles
(10 km) per year. 1975-2025 in five-year steps; years Trafikanalys doesn't
have are left out.

Trafikanalys does not publish distance driven per municipality. The site
estimates it by sharing each county's total out over its municipalities in
proportion to their passenger cars (see municipalities.js).

Usage:
    python3 scripts/fetch_county_distance.py [output-path]

Only the Python standard library is needed. The default output path is
data/county_distance.json, relative to the repository root.
"""

import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API_URL = "https://api.trafa.se/api/data"
PRODUCT = "t04010"  # Trafikarbete.
CARS = "10"  # Fordonsslag: personbil.
MEASURES = {"korstr": "total", "mkorstr": "average"}  # Both in mil (10 km).
YEARS = [str(year) for year in range(1975, 2026, 5)]
DEFAULT_OUTPUT = Path(__file__).resolve().parent.parent / "data" / "county_distance.json"


def number(text):
    text = text.replace(" ", "").replace(" ", "").replace(",", ".")
    return float(text) if text not in ("", "..", "-") else None


def request(query):
    url = f"{API_URL}?{urllib.parse.urlencode({'lang': 'sv', 'query': query}, safe='|:,')}"
    for attempt in range(1, 4):
        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                return url, json.loads(response.read().decode("utf-8-sig"))
        except TimeoutError:
            if attempt == 3:
                raise
            print("Timed out, retrying")


def fetch():
    """One request per measure; the API returns nothing for some combinations."""
    results = []
    for measure in MEASURES:
        for query in (
            f"{PRODUCT}|ar|fslag:{CARS}|reglan|{measure}",
            f"{PRODUCT}|ar|fslag|reglan|{measure}",
        ):
            url, result = request(query)
            rows = len(result.get("Rows") or [])
            print(f"{query}: {rows} rows{', errors ' + str(result['Errors']) if result.get('Errors') else ''}")
            if rows:
                results.append((url, result))
                break
    return results


def parse(results):
    counties = {}
    labels = {}
    print(f"First row: {json.dumps(results[0][1]['Rows'][:1], ensure_ascii=False)[:600]}")
    for _, result in results:
        for row in result["Rows"]:
            cells = {cell["Column"]: cell for cell in row["Cell"]}
            # Unfiltered requests include every vehicle type; keep passenger cars.
            if "fslag" in cells and str(cells["fslag"].get("Name") or cells["fslag"]["Value"]) not in (CARS, "Personbil"):
                continue
            year = str(cells["ar"]["Value"])
            county = cells["reglan"]
            code = county.get("Name") or county["Value"]
            labels[code] = county.get("Value")
            for measure, key in MEASURES.items():
                if measure in cells:
                    value = number(str(cells[measure]["Value"]))
                    if value is not None:
                        # Mil (10 km) to km.
                        counties.setdefault(code, {}).setdefault(year, {})[key] = round(value * 10)
    return counties, labels


def main():
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUTPUT

    try:
        results = fetch()
    except urllib.error.HTTPError as error:
        sys.exit(f"Trafikanalys returned HTTP {error.code}: {error.read().decode('utf-8', 'replace')}")
    except urllib.error.URLError as error:
        sys.exit(f"Could not reach Trafikanalys: {error.reason}")

    if not results:
        sys.exit("Trafikanalys returned no county data")
    source_url, result = results[0]
    counties, labels = parse(results)
    years = sorted({year for by_year in counties.values() for year in by_year})
    print(f"Trafikanalys has {len(counties)} counties, {years[0]}-{years[-1]}: {labels}")

    kept = [year for year in YEARS if year in years]
    if YEARS[-1] not in kept:
        sys.exit(f"Trafikanalys has no county figures for {YEARS[-1]}")
    data = {
        code: {year: by_year[year] for year in kept if year in by_year}
        for code, by_year in sorted(counties.items())
        if code.isdigit() and len(code) == 2  # Skip totals and unknown county.
    }
    if len(data) < 21:
        sys.exit(f"Expected 21 counties, got {sorted(data)}")
    for year in kept:
        total = sum(by_year.get(year, {}).get("total", 0) for by_year in data.values())
        print(f"  {year}: counties' passenger cars drove {total / 1e9:.1f} billion km")

    payload = {
        "title": "Distance driven by passenger cars per county of registration",
        "unit": "km",
        "source": f"Trafikanalys, {result.get('Name') or 'Trafikarbete'} ({PRODUCT}, passenger cars by county)",
        "sourceUrl": source_url,
        "retrieved": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "years": [int(year) for year in kept],
        "data": data,
    }

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(data)} counties to {output}")


if __name__ == "__main__":
    main()
