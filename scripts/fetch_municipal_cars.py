#!/usr/bin/env python3
"""Fetch passenger cars in traffic in every Swedish municipality from SCB.

Uses SCB's PxWebApi 2 to get the number of passenger cars in traffic
("personbilar i trafik") at the end of each year in each municipality,
1975-2025 in five-year steps. SCB only has these figures per municipality
from 2002 (table TAB1278, "Fordon i trafik efter län och kommun samt
fordonsslag"), so earlier years are null. Like the other scripts, it finds
the table through SCB's table search instead of hard-coding it.

Usage:
    python3 scripts/fetch_municipal_cars.py [output-path]

Only the Python standard library is needed. The default output path is
data/municipal_cars.json, relative to the repository root.
"""

import json
import sys
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

from fetch_municipalities import MUNICIPALITY, parse
from fetch_population import REGION, YEARS, find_api, get

# SCB's search is picky about phrases; these together found TAB1278 and TAB3276.
SEARCHES = ["fordon i trafik", "personbilar i trafik", "bilregistret", "fordon region", "personbilar region"]
# Values wanted in the table's other dimensions, matched on SCB's Swedish labels.
WANTED = {"personbilar", "totalt"}
DEFAULT_OUTPUT = Path(__file__).resolve().parent.parent / "data" / "municipal_cars.json"


def build_query(metadata):
    """Value codes and years for the data request, or the reason the table doesn't fit."""
    dimensions = metadata["dimension"]
    time_code = metadata.get("role", {}).get("time", ["Tid"])[0]
    params = {}
    years = []
    regions = {}

    for code in metadata["id"]:
        values = dimensions[code]["category"]["label"]
        if code == time_code:
            years = [year for year in YEARS if year in values]
            if not years:
                return f"no years in {YEARS[0]}-{YEARS[-1]}"
            params[f"valueCodes[{code}]"] = ",".join(years)
        elif code == "Region":
            municipalities = [key for key in values if MUNICIPALITY.match(key)]
            if len(municipalities) < 290 or REGION not in values:
                return f"{len(municipalities)} municipalities"
            params[f"valueCodes[{code}]"] = ",".join([REGION, *municipalities])
            regions = values
        else:
            matches = [key for key, label in values.items() if label.lower() in WANTED]
            if matches:
                params[f"valueCodes[{code}]"] = matches[0]
            elif len(values) == 1:
                params[f"valueCodes[{code}]"] = next(iter(values))  # E.g. ContentsCode "Antal".
            else:
                return f"no passenger car total in {code}"

    if not any(key.startswith("valueCodes[Region]") for key in params):
        return "no Region dimension"
    return params, years, regions


def fetch():
    base = find_api()
    print(f"Using {base}")
    tables = {}
    for search in SEARCHES:
        result = get(f"{base}/tables", {"lang": "sv", "query": search, "pageSize": 100})
        print(f"Search {search!r}: {len(result['tables'])} tables")
        for table in result["tables"]:
            tables.setdefault(table["id"], table)
    print("Vehicle tables:")

    best = None
    for table in tables.values():
        label = table["label"].lower()
        if table.get("discontinued") or not ("personbilar" in label or "fordon" in label):
            continue
        url = f"{base}/tables/{table['id']}"
        query = build_query(get(f"{url}/metadata", {"lang": "sv"}))
        skipped = f" - skipped: {query}" if isinstance(query, str) else ""
        print(f"  {table['id']}: {table['label']}{skipped}")
        # Keep the table with the most years; on a tie the first, best-ranked one.
        if not skipped and (best is None or len(query[1]) > len(best[2][1])):
            best = (table, url, query)

    if best is None:
        sys.exit("No SCB table has passenger cars in traffic for every municipality")
    table, url, (params, years, regions) = best
    print(f"Fetching {', '.join(years)} from {table['id']}")
    dataset = get(f"{url}/data", {"lang": "sv", "outputFormat": "json-stat2", **params})
    return table, f"{url}/data", regions, parse(dataset)


def merge_renamed(values, regions):
    """Fold old codes into the current code of the same municipality.

    SCB lists a municipality that changed county under both codes, e.g. Heby
    as 1917 (Västmanland) until 2006 and 0331 (Uppsala) after. Keep the code
    with the latest figure and fill its missing years from the other.
    """
    by_name = {}
    for code in values:
        if MUNICIPALITY.match(code):
            by_name.setdefault(regions.get(code, code).removeprefix(code).strip(), []).append(code)
    for name, codes in by_name.items():
        if len(codes) < 2:
            continue
        current = max(codes, key=lambda code: max((y for y, v in values[code].items() if v is not None), default=""))
        for old in codes:
            if old == current:
                continue
            for year, value in values.pop(old).items():
                if values[current].get(year) is None:
                    values[current][year] = value
            print(f"Merged {name} {old} into {current}")


def main():
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUTPUT

    try:
        table, source_url, regions, values = fetch()
    except urllib.error.HTTPError as error:
        sys.exit(f"SCB returned HTTP {error.code} for {error.url}: {error.read().decode('utf-8', 'replace')}")
    except urllib.error.URLError as error:
        sys.exit(f"Could not reach SCB: {error.reason}")

    national = values.pop(REGION)
    # SCB gives 0 for a code in years it wasn't in use; no municipality has no cars.
    for by_year in values.values():
        for year, value in by_year.items():
            by_year[year] = value or None
    merge_renamed(values, regions)
    municipalities = [
        {"code": code, "cars": {year: by_year.get(year) for year in YEARS}}
        for code, by_year in sorted(values.items())
        if MUNICIPALITY.match(code)
    ]

    print(f"Got {len(municipalities)} municipalities:")
    for year in YEARS:
        counted = [m["cars"][year] for m in municipalities if m["cars"][year] is not None]
        if counted:
            print(f"  {year}: municipalities {sum(counted):,}, Sweden {national.get(year) or 0:,}")
    latest = YEARS[-1]
    if len(municipalities) < 290 or any(m["cars"][latest] is None for m in municipalities):
        sys.exit(f"Some municipalities have no passenger cars for {latest}")

    payload = {
        "title": "Passenger cars in traffic in Sweden's municipalities, end of year",
        "source": f"Statistiska centralbyrån (SCB), tabell {table['id']}: {table['label']}",
        "sourceUrl": source_url,
        "retrieved": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "years": [int(year) for year in YEARS],
        "sweden": {year: national.get(year) for year in YEARS},
        "data": municipalities,
    }

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(municipalities)} municipalities to {output}")


if __name__ == "__main__":
    main()
