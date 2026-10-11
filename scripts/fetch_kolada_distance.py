#!/usr/bin/env python3
"""Fetch passenger-car distance per inhabitant for every Swedish municipality.

Trafikanalys's own tables stop at county level, but Kolada, the open database
of municipal statistics, publishes Trafikanalys's figures per municipality:
indicator U07917, "Genomsnittlig körsträcka med personbil, mil/inv", the
total distance driven by passenger cars registered in the municipality
divided by its inhabitants. It is owner-based like the national statistics:
cars count where they are registered, wherever they were driven, and
company cars count where the company is registered.

Kolada has 1999, 2000, 2005 and every year from 2008; a year Kolada hasn't
published yet (for example the latest one before its release) is left out
and the site keeps its estimate for it.

Usage:
    python3 scripts/fetch_kolada_distance.py [output-path]

Only the Python standard library is needed. The default output path is
data/municipal_distance.json, relative to the repository root.
"""

import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API = "https://api.kolada.se/v3"
KPI = "U07917"  # Mil (10 km) per inhabitant.
YEARS = [str(year) for year in range(1975, 2026, 5)]
MUNICIPALITY = re.compile(r"^\d{4}$")
# Keep a year if nearly every municipality has a figure; municipalities formed
# later (Knivsta in 2003) have none for earlier years, and the site estimates
# any gaps.
MIN_MUNICIPALITIES = 280
HEADERS = {"User-Agent": "trafik data fetcher (github.com/andreasn/trafik)"}
DEFAULT_OUTPUT = Path(__file__).resolve().parent.parent / "data" / "municipal_distance.json"


def get(url):
    for attempt in range(1, 4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=60) as response:
                return json.loads(response.read().decode("utf-8-sig"))
        except TimeoutError:
            if attempt == 3:
                raise
            print(f"{url} timed out, retrying")


def year_values(year):
    """{municipality code: km per inhabitant} for one year, following Kolada's paging."""
    url = f"{API}/data/kpi/{KPI}/year/{year}"
    values = {}
    while url:
        page = get(url)
        for entry in page.get("values", []):
            code = entry.get("municipality", "")
            # Kolada codes counties as 00xx and Sweden as 0000.
            if not MUNICIPALITY.match(code) or code.startswith("00"):
                continue
            total = next((v.get("value") for v in entry.get("values", []) if v.get("gender") == "T"), None)
            if total is not None:
                values[code] = round(total * 10)  # Mil to km.
        url = page.get("next_page") or page.get("next_url")
    return values


def main():
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUTPUT

    try:
        meta = get(f"{API}/kpi/{KPI}").get("values", [{}])[0]
        print(f"{KPI}: {meta.get('title')}")
        by_year = {}
        for year in YEARS:
            values = year_values(year)
            print(f"  {year}: {len(values)} municipalities")
            if len(values) >= MIN_MUNICIPALITIES:
                by_year[year] = values
            elif values:
                print(f"  {year}: skipped, only {len(values)} municipalities")
        everyone = set().union(*by_year.values()) if by_year else set()
        for year, values in by_year.items():
            if len(values) < len(everyone):
                print(f"  {year}: no figure for {', '.join(sorted(everyone - set(values)))}")
    except urllib.error.HTTPError as error:
        sys.exit(f"Kolada returned HTTP {error.code} for {error.url}")
    except urllib.error.URLError as error:
        sys.exit(f"Could not reach Kolada: {error.reason}")

    if not by_year:
        sys.exit(f"Kolada has no {KPI} data for any of {', '.join(YEARS)}")

    codes = sorted({code for values in by_year.values() for code in values})
    payload = {
        "title": "Distance driven by passenger cars per inhabitant, by municipality",
        "unit": "km per inhabitant",
        "source": f"Trafikanalys via Kolada, {KPI}: {meta.get('title', 'Genomsnittlig körsträcka med personbil, mil/inv')}",
        "sourceUrl": f"{API}/data/kpi/{KPI}",
        "retrieved": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "years": [int(year) for year in by_year],
        "data": [
            {"code": code, "kmPerInhabitant": {year: values.get(code) for year, values in by_year.items()}}
            for code in codes
        ],
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(codes)} municipalities for {', '.join(by_year)} to {output}")


if __name__ == "__main__":
    main()
