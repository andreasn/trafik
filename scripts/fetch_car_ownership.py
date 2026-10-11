#!/usr/bin/env python3
"""Fetch cars per 1,000 inhabitants in every Swedish municipality before 2003.

SCB's API only has passenger cars per municipality from 2002 (see
fetch_municipal_cars.py). RUS, the county administrative boards' joint
environmental objectives site, republishes SCB's cars in traffic per 1,000
inhabitants per municipality for some earlier years (1974, 1980, 1990, 1995,
1998 and 2000 at the time of writing) in Tabell 1 of its Körsträckor
statistics. The file name changes every year, so the script finds the link on
the RUS page. Years from 2003 on are left out: the site uses SCB's own counts
for those.

Usage:
    python3 scripts/fetch_car_ownership.py [output-path]

Only the Python standard library is needed. The default output path is
data/car_ownership.json, relative to the repository root.
"""

import json
import re
import sys
import urllib.error
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

from fetch_car_distance import download, read_sheet

PAGE = "https://www.rus.se/statistik-och-indikatorer/korstrackor/"
LINK = re.compile(r'href="([^"]*Tabell-1-Bilinnehav[^"]*\.xlsx)"', re.IGNORECASE)
SHEET = "Tabell 1"
FIRST_SCB_YEAR = 2003  # SCB's municipal counts cover the years from here on.
MIN_MUNICIPALITIES = 280  # Some municipalities were formed after 1974.
DEFAULT_OUTPUT = Path(__file__).resolve().parent.parent / "data" / "car_ownership.json"


def workbook_url():
    final, body = download(PAGE)
    links = {urllib.parse.urljoin(final, link) for link in LINK.findall(body.decode("utf-8", "replace"))}
    if not links:
        sys.exit(f"No Tabell 1 (Bilinnehav) workbook linked from {PAGE}")
    # The newest, by the year in the file name (...-till-ar-2025.xlsx).
    return max(links, key=lambda url: re.findall(r"\d{4}", url)[-1:])


def code(value):
    """1, 180.0 or '0180' -> '01' or '0180'; None for anything else."""
    try:
        number = int(float(str(value).strip()))
    except ValueError:
        return None
    return f"{number:04d}" if number >= 100 else f"{number:02d}"


def parse(rows):
    header_index = next((i for i, row in enumerate(rows) if row and str(row[0]).strip() == "Kod"), None)
    if header_index is None:
        sys.exit(f"No header row starting with 'Kod' in {SHEET}")
    header = rows[header_index]
    # Each year's rate is under a year heading; the 'Därav företagsbilar' columns are left out.
    columns = {
        i: str(int(value)) for i, value in enumerate(header)
        if isinstance(value, float) and value.is_integer() and 1900 < value < FIRST_SCB_YEAR
    }
    sweden, municipalities = None, {}
    for row in rows[header_index + 1:]:
        region = code(row[0]) if row else None
        if region is None or len(row) < 2 or not isinstance(row[1], str):
            continue
        rates = {year: round(row[i], 2) if i < len(row) and isinstance(row[i], float) else None for i, year in columns.items()}
        if region == "00":
            sweden = rates
        elif len(region) == 4:
            municipalities[region] = rates
    return list(columns.values()), sweden, municipalities


def main():
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUTPUT

    try:
        url = workbook_url()
        print(f"Reading {url}")
        _, body = download(url)
    except urllib.error.HTTPError as error:
        sys.exit(f"RUS returned HTTP {error.code} for {error.url}")
    except urllib.error.URLError as error:
        sys.exit(f"Could not reach RUS: {error.reason}")
    rows = read_sheet(body, SHEET)
    if rows is None:
        sys.exit(f"{url} has no sheet {SHEET!r}")

    years, sweden, municipalities = parse(rows)
    if not years or sweden is None:
        sys.exit(f"Found no years before {FIRST_SCB_YEAR} or no national row in {url}")
    print(f"{len(municipalities)} municipalities:")
    for year in years:
        count = sum(rates[year] is not None for rates in municipalities.values())
        print(f"  {year}: {count} with a figure, Sweden {sweden[year]}")
    if sum(rates[years[-1]] is not None for rates in municipalities.values()) < MIN_MUNICIPALITIES:
        sys.exit(f"Fewer than {MIN_MUNICIPALITIES} municipalities have a figure for {years[-1]}")

    payload = {
        "title": "Passenger cars in traffic per 1,000 inhabitants in Sweden's municipalities, end of year",
        "unit": "cars per 1,000 inhabitants",
        "source": "RUS (the county administrative boards' environmental objectives site), Körsträckor table 1: "
                  "Bilinnehav per 1000 invånare, from Statistics Sweden (SCB)",
        "sourceUrl": url,
        "retrieved": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "years": [int(year) for year in years],
        "sweden": sweden,
        "data": [{"code": region, "carsPerThousand": rates} for region, rates in sorted(municipalities.items())],
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {output}")


if __name__ == "__main__":
    main()
