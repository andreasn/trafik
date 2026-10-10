#!/usr/bin/env python3
"""Fetch the population of every Swedish municipality from SCB as JSON.

Uses SCB's PxWebApi 2 to get the population ("Folkmängd", 31 December) of
each of Sweden's municipalities (kommuner), 1975-2025 in five-year steps.
Like fetch_population.py, it searches SCB's table list for a population
table that covers every year and has the municipalities, so it keeps
working when SCB replaces a table.

SCB gives the figures for today's municipalities. A municipality formed
after a given year (Knivsta in 2003, for example) has null for that year.

Usage:
    python3 scripts/fetch_municipalities.py [output-path]

Only the Python standard library is needed. The default output path is
data/municipalities.json, relative to the repository root.
"""

import re
import json
import sys
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

from fetch_population import REGION, SEARCH, YEARS, find_api, find_tables, get

MUNICIPALITY = re.compile(r"^\d{4}$")  # Municipality codes have four digits, counties two.
DEFAULT_OUTPUT = Path(__file__).resolve().parent.parent / "data" / "municipalities.json"


def build_query(metadata):
    """Value codes for the data request and the region labels, or None if the table doesn't fit."""
    dimensions = metadata["dimension"]
    time_code = metadata.get("role", {}).get("time", ["Tid"])[0]
    params = {}
    regions = None

    for code in metadata["id"]:
        dimension = dimensions[code]
        values = dimension["category"]["label"]
        if code == time_code:
            if any(year not in values for year in YEARS):
                return None
            params[f"valueCodes[{code}]"] = ",".join(YEARS)
        elif code == "Region":
            municipalities = [key for key in values if MUNICIPALITY.match(key)]
            if len(municipalities) < 290 or REGION not in values:
                return None
            regions = values
            params[f"valueCodes[{code}]"] = ",".join([REGION, *municipalities])
        elif code == "ContentsCode":
            matches = [key for key, label in values.items() if label.lower().startswith(SEARCH)]
            if not matches:
                return None
            params[f"valueCodes[{code}]"] = matches[0]
        elif not dimension.get("extension", {}).get("elimination"):
            # Age, sex and so on must be leavable out to get totals.
            return None

    if regions is None:
        return None
    return params, regions


def name(label, code):
    """'0114 Upplands Väsby' or 'Upplands Väsby' -> 'Upplands Väsby'."""
    return label.removeprefix(code).strip()


def parse(dataset, regions):
    codes = dataset["id"]
    sizes = dict(zip(codes, dataset["size"]))
    time_code = dataset.get("role", {}).get("time", ["Tid"])[0]
    if any(size != 1 for code, size in sizes.items() if code not in (time_code, "Region")):
        sys.exit(f"Expected one value per region and year, got dimensions {codes} sized {dataset['size']}")

    def ordered(code):
        index = dataset["dimension"][code]["category"]["index"]
        return sorted(index, key=index.get) if isinstance(index, dict) else index

    # json-stat2 values are in row-major order over the dimensions; only
    # Region and time have more than one value, so walk those two.
    region_order, years = ordered("Region"), ordered(time_code)
    region_first = codes.index("Region") < codes.index(time_code)
    table = {}
    for i, value in enumerate(dataset["value"]):
        if region_first:
            region, year = region_order[i // len(years)], years[i % len(years)]
        else:
            year, region = years[i // len(region_order)], region_order[i % len(region_order)]
        table.setdefault(region, {})[year] = None if value is None else int(value)

    counties = {code: name(label, code) for code, label in regions.items() if len(code) == 2}
    municipalities = [
        {
            "code": code,
            "name": name(regions[code], code),
            "county": counties.get(code[:2]),
            "population": {year: table[code].get(year) for year in YEARS},
        }
        for code in sorted(table)
        if MUNICIPALITY.match(code)
    ]
    return table[REGION], municipalities


def fetch():
    base = find_api()
    print(f"Using {base}")
    print(f"Tables matching {SEARCH!r}:")

    for table in find_tables(base):
        url = f"{base}/tables/{table['id']}"
        query = build_query(get(f"{url}/metadata", {"lang": "sv"}))
        if query is None:
            print(f"{table['id']} does not have every municipality for every year")
            continue
        params, regions = query
        print(f"Fetching from {table['id']}")
        dataset = get(f"{url}/data", {"lang": "sv", "outputFormat": "json-stat2", **params})
        return table, f"{url}/data", *parse(dataset, regions)

    sys.exit(f"No SCB table has the municipalities' population for every year in {YEARS[0]}-{YEARS[-1]}")


def check(national, municipalities):
    """Compare the municipalities' sum with the national total for each year."""
    for year in YEARS:
        values = [m["population"][year] for m in municipalities]
        missing = [m["name"] for m in municipalities if m["population"][year] is None]
        total = sum(value for value in values if value is not None)
        note = f", no data for {', '.join(missing)}" if missing else ""
        print(f"  {year}: municipalities {total:,}, Sweden {national.get(year) or 0:,}{note}")
    latest = YEARS[-1]
    if any(m["population"][latest] is None for m in municipalities):
        sys.exit(f"Some municipalities have no population for {latest}")
    if sum(m["population"][latest] for m in municipalities) != national.get(latest):
        sys.exit(f"The municipalities do not add up to Sweden's population in {latest}")


def main():
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUTPUT

    try:
        table, source_url, national, municipalities = fetch()
    except urllib.error.HTTPError as error:
        sys.exit(f"SCB returned HTTP {error.code} for {error.url}: {error.read().decode('utf-8', 'replace')}")
    except urllib.error.URLError as error:
        sys.exit(f"Could not reach SCB: {error.reason}")

    print(f"Got {len(municipalities)} municipalities:")
    check(national, municipalities)

    payload = {
        "title": "Population of Sweden's municipalities, 31 December",
        "source": f"Statistics Sweden (SCB), table {table['id']}: {table['label']}",
        "sourceUrl": source_url,
        "retrieved": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "years": [int(year) for year in YEARS],
        "data": municipalities,
    }

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(municipalities)} municipalities to {output}")


if __name__ == "__main__":
    main()
