#!/usr/bin/env python3
"""Fetch the inputs for estimating distance driven by passenger cars per municipality.

Trafikanalys does not publish distance driven per municipality, so the site
estimates it from two official sources, saved together in one file:

- Sweden's total distance driven by passenger cars per year, from
  Trafikanalys's open API (product t04010 "Trafikarbete", fordonsslag 10,
  millions of vehicle-km).
- The average distance per passenger car in each county of registration,
  from table RS1 in Trafikanalys's yearly Körsträckor workbook. trafa.se
  links only the newest workbooks; older ones that are still there are
  listed in OLDER_WORKBOOKS. Together they cover 2015, 2020 and 2025 of
  1975-2025 at the time of writing; no workbook was found for 2010 or
  earlier.

municipalities.js then uses the county average where there is one and the
municipality's share of Sweden's cars otherwise.

Usage:
    python3 scripts/fetch_car_distance.py [output-path]

Only the Python standard library is needed. The default output path is
data/car_distance.json, relative to the repository root.
"""

import io
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone
from pathlib import Path

API_URL = "https://api.trafa.se/api/data"
QUERY = "t04010|ar|fslag:10|fordonkm"  # Passenger cars, millions of vehicle-km.
PAGE = "https://www.trafa.se/vagtrafik/korstrackor/"
# Workbooks no longer linked from PAGE but still on trafa.se. A missing one is
# reported and skipped.
OLDER_WORKBOOKS = [
    "https://www.trafa.se/globalassets/statistik/vagtrafik/korstrackor/2020/korstrackor-2020.xlsx",
    "https://www.trafa.se/globalassets/statistik/vagtrafik/korstrackor/korstrackor-2015.xlsx",
]
SHEET = "RS Tab 1"
YEARS = [str(year) for year in range(1975, 2026, 5)]
# Table RS1 names counties without their codes.
COUNTIES = {
    "Stockholm": "01", "Uppsala": "03", "Södermanland": "04", "Östergötland": "05",
    "Jönköping": "06", "Kronoberg": "07", "Kalmar": "08", "Gotland": "09", "Blekinge": "10",
    "Skåne": "12", "Halland": "13", "Västra Götaland": "14", "Värmland": "17", "Örebro": "18",
    "Västmanland": "19", "Dalarna": "20", "Gävleborg": "21", "Västernorrland": "22",
    "Jämtland": "23", "Västerbotten": "24", "Norrbotten": "25",
}
HEADERS = {"User-Agent": "trafik data fetcher (github.com/andreasn/trafik)"}
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
DEFAULT_OUTPUT = Path(__file__).resolve().parent.parent / "data" / "car_distance.json"


def download(url):
    request = urllib.request.Request(url, headers=HEADERS)
    for attempt in range(1, 4):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return response.geturl(), response.read()
        except TimeoutError:
            if attempt == 3:
                raise
            print(f"{url} timed out, retrying")


def national_car_km():
    url = f"{API_URL}?{urllib.parse.urlencode({'lang': 'sv', 'query': QUERY}, safe='|:,')}"
    _, body = download(url)
    result = json.loads(body.decode("utf-8-sig"))
    if result.get("Errors"):
        sys.exit(f"Trafikanalys returned errors: {result['Errors']}")
    values = {}
    for row in result["Rows"]:
        cells = {cell["Column"]: cell["Value"] for cell in row["Cell"]}
        value = cells["fordonkm"].replace(" ", "").replace(" ", "")
        if value:
            values[cells["ar"]] = int(float(value.replace(",", ".")))
    return url, values


def read_sheet(workbook, name):
    """Rows of one sheet as lists of cell values, using only the standard library."""
    book = zipfile.ZipFile(io.BytesIO(workbook))
    strings = []
    if "xl/sharedStrings.xml" in book.namelist():
        for item in ET.fromstring(book.read("xl/sharedStrings.xml")).findall("m:si", NS):
            strings.append("".join(text.text or "" for text in item.iter(f"{{{NS['m']}}}t")))
    sheets = {s.get("name"): s.get(REL) for s in ET.fromstring(book.read("xl/workbook.xml")).iter(f"{{{NS['m']}}}sheet")}
    if name not in sheets:
        return None
    rels = ET.fromstring(book.read("xl/_rels/workbook.xml.rels"))
    target = next(r.get("Target") for r in rels if r.get("Id") == sheets[name])
    path = "xl/" + target.lstrip("/").removeprefix("xl/")

    rows = []
    for row in ET.fromstring(book.read(path)).iter(f"{{{NS['m']}}}row"):
        values = []
        for cell in row.findall("m:c", NS):
            column = 0
            for letter in re.match(r"[A-Z]+", cell.get("r")).group():
                column = column * 26 + ord(letter) - 64
            values.extend([None] * (column - 1 - len(values)))
            raw = cell.find("m:v", NS)
            inline = cell.find("m:is", NS)
            if cell.get("t") == "s" and raw is not None:
                values.append(strings[int(raw.text)])
            elif inline is not None:
                values.append("".join(t.text or "" for t in inline.iter(f"{{{NS['m']}}}t")))
            elif raw is not None:
                try:
                    values.append(float(raw.text))
                except ValueError:
                    values.append(raw.text)
            else:
                values.append(None)
        rows.append(values)
    return rows


def county_averages(rows):
    """{county code: km per passenger car} and the year from table RS1.

    The layout varies between years: 2020 and later split passenger cars
    into owner columns with a "Totalt" under them, 2015 has a single
    passenger-car column.
    """
    year = next((m.group(1) for row in rows[:6] for c in row if isinstance(c, str)
                 for m in [re.search(r"år (\d{4})", c, re.I)] if m), None)
    header = next(i for i, row in enumerate(rows) if "Personbilar" in [str(c).strip() for c in row])
    labels = [str(c).strip() if c is not None else "" for c in rows[header]]
    cars_column = labels.index("Personbilar")
    # The passenger-car group runs until the next vehicle type's heading.
    group_end = next((i for i in range(cars_column + 1, len(labels)) if labels[i]), len(labels))
    sub = rows[header + 1]
    total_column = next(
        (i for i in range(cars_column, min(group_end, len(sub))) if str(sub[i]).strip() == "Totalt"),
        cars_column,
    )
    averages = {}
    for row in rows[header + 1:]:
        name = str(row[0] if row and row[0] is not None else "").strip()
        if name in COUNTIES and len(row) > total_column and isinstance(row[total_column], float):
            averages[COUNTIES[name]] = round(row[total_column] * 10)  # Mil (10 km) to km.
    return year, averages


def workbooks():
    final, body = download(PAGE)
    links = sorted(set(re.findall(r'href="([^"]+\.xlsx)"', body.decode("utf-8", "replace"), re.I)))
    return [urllib.parse.urljoin(final, link) for link in links]


def main():
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUTPUT

    try:
        api_url, national = national_car_km()
        print(f"Trafikanalys API: passenger-car km for {min(national)}-{max(national)}")
        counties = {}
        for url in workbooks() + OLDER_WORKBOOKS:
            # The first year in the path: the folder (2021/...) or the file name (korstrackor-2015.xlsx).
            linked_year = re.search(r"korstrackor/\D*(20\d\d)", url)
            if not linked_year or linked_year.group(1) not in YEARS:
                continue
            try:
                _, body = download(url)
            except urllib.error.HTTPError as error:
                print(f"{url}: HTTP {error.code}, skipped")
                continue
            rows = read_sheet(body, SHEET)
            if rows is None:
                print(f"{url}: no sheet {SHEET!r}")
                continue
            year, averages = county_averages(rows)
            print(f"{url}: {SHEET} for {year}, {len(averages)} counties")
            if year in YEARS and len(averages) == len(COUNTIES) and year not in counties:
                counties[year] = {"source": url, "kmPerCar": averages}
    except urllib.error.HTTPError as error:
        sys.exit(f"Trafikanalys returned HTTP {error.code} for {error.url}")
    except urllib.error.URLError as error:
        sys.exit(f"Could not reach Trafikanalys: {error.reason}")

    if YEARS[-1] not in national:
        sys.exit(f"Trafikanalys has no passenger-car km for {YEARS[-1]}")
    if not counties:
        sys.exit("Found no county averages in Trafikanalys's Körsträckor workbooks")

    payload = {
        "title": "Distance driven by passenger cars: Sweden's total and county averages",
        "source": "Trafikanalys, Trafikarbete (t04010, passenger cars) and Körsträckor table RS1",
        "sourceUrl": api_url,
        "retrieved": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "swedenCarKmMillions": {year: national[year] for year in YEARS if year in national},
        "countyKmPerCar": counties,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {output}: Sweden {sorted(payload['swedenCarKmMillions'])}, counties {sorted(counties)}")


if __name__ == "__main__":
    main()
