#!/usr/bin/env python3
"""Fetch the number of passenger cars in Sweden from SCB and save it as JSON.

Uses SCB's PxWebApi 2 to get the number of passenger cars in traffic
("personbilar i trafik") in the whole country at the end of each year,
1975-2025 in five-year steps. SCB publishes this from the vehicle register
(bilregistret) as monthly figures, so the December figure is used for each
year. Like fetch_population.py, the script searches SCB's table list rather
than hard-coding a table, so it keeps working when SCB replaces a table.

Usage:
    python3 scripts/fetch_cars.py [output-path]

Only the Python standard library is needed. The default output path is
data/cars.json, relative to the repository root.
"""

import json
import sys
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

from fetch_population import find_api, get

YEARS = [str(year) for year in range(1975, 2026, 5)]
MONTHS = [f"{year}M12" for year in YEARS]  # End of year, like population on 31 December.
SEARCH = "bilregistret"
# Values wanted in the table's other dimensions, matched on SCB's Swedish labels.
WANTED = {"personbilar", "i trafik"}
DEFAULT_OUTPUT = Path(__file__).resolve().parent.parent / "data" / "cars.json"


def find_tables(base):
    """Vehicle register tables with monthly figures for every month in MONTHS."""
    result = get(f"{base}/tables", {"lang": "sv", "query": SEARCH, "pageSize": 100})
    tables = []
    for table in result["tables"]:
        covers = table.get("firstPeriod", "9999") <= MONTHS[0] and table.get("lastPeriod", "") >= MONTHS[-1]
        print(
            f"  {table['id']}: {table['label']} "
            f"({table.get('firstPeriod')}-{table.get('lastPeriod')})"
            f"{'' if covers else ' - skipped'}"
        )
        if covers and not table.get("discontinued"):
            tables.append(table)
    return tables


def build_query(metadata):
    """Value codes for the data request, or None if the table doesn't fit."""
    dimensions = metadata["dimension"]
    time_code = metadata.get("role", {}).get("time", ["Tid"])[0]
    params = {}
    found = set()

    for code in metadata["id"]:
        dimension = dimensions[code]
        values = dimension["category"]["label"]
        if code == time_code:
            if any(month not in values for month in MONTHS):
                return None
            params[f"valueCodes[{code}]"] = ",".join(MONTHS)
            continue

        matches = [key for key, label in values.items() if label.lower() in WANTED]
        if matches:
            params[f"valueCodes[{code}]"] = matches[0]
            found.add(values[matches[0]].lower())
        elif len(values) == 1:
            params[f"valueCodes[{code}]"] = next(iter(values))  # E.g. ContentsCode "Antal".
        elif not dimension.get("extension", {}).get("elimination"):
            return None

    return params if found == WANTED else None


def parse(dataset):
    time_code = dataset.get("role", {}).get("time", ["Tid"])[0]
    if any(size != 1 for code, size in zip(dataset["id"], dataset["size"]) if code != time_code):
        sys.exit(f"Expected one value per year, got dimensions {dataset['id']} sized {dataset['size']}")

    index = dataset["dimension"][time_code]["category"]["index"]
    months = sorted(index, key=index.get) if isinstance(index, dict) else index
    rows = [
        {"year": int(month[:4]), "cars": int(value)}
        for month, value in zip(months, dataset["value"])
        if value is not None
    ]
    return sorted(rows, key=lambda row: row["year"])


def fetch():
    base = find_api()
    print(f"Using {base}")
    print(f"Tables matching {SEARCH!r}:")

    for table in find_tables(base):
        url = f"{base}/tables/{table['id']}"
        params = build_query(get(f"{url}/metadata", {"lang": "sv"}))
        if params is None:
            print(f"{table['id']} does not have passenger cars in traffic for every year")
            continue
        print(f"Fetching from {table['id']}: {params}")
        dataset = get(f"{url}/data", {"lang": "sv", "outputFormat": "json-stat2", **params})
        return table, f"{url}/data", parse(dataset)

    sys.exit(f"No SCB table has passenger cars in traffic for every year in {YEARS[0]}-{YEARS[-1]}")


def main():
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUTPUT

    try:
        table, source_url, rows = fetch()
    except urllib.error.HTTPError as error:
        sys.exit(f"SCB returned HTTP {error.code} for {error.url}: {error.read().decode('utf-8', 'replace')}")
    except urllib.error.URLError as error:
        sys.exit(f"Could not reach SCB: {error.reason}")

    missing = sorted(set(map(int, YEARS)) - {row["year"] for row in rows})
    if missing:
        sys.exit(f"SCB returned no data for: {', '.join(map(str, missing))}")

    payload = {
        "title": "Passenger cars in traffic in Sweden, end of December",
        "source": f"Statistics Sweden (SCB), table {table['id']}: {table['label']}",
        "sourceUrl": source_url,
        "retrieved": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "data": rows,
    }

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(rows)} years to {output}")


if __name__ == "__main__":
    main()
