#!/usr/bin/env python3
"""Fetch Sweden's population from SCB and save it as JSON for the website.

Uses SCB's PxWebApi 2 to get the population ("Folkmängd", 31 December) of
the whole country, 1975-2025 in five-year steps. The script searches SCB's
table list for a population table covering every year, so it keeps working
when SCB replaces a table with a newer one.

Usage:
    python3 scripts/fetch_population.py [output-path]

Only the Python standard library is needed. The default output path is
data/population.json, relative to the repository root.
"""

import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# SCB's PxWebApi 2. The first address that answers is used.
BASE_URLS = [
    "https://statistikdatabasen.scb.se/api/v2",
    "https://api.scb.se/OV0104/v2beta/api/v2",
]
YEARS = [str(year) for year in range(1975, 2026, 5)]
REGION = "00"  # The whole of Sweden.
SEARCH = "folkmängd"
DEFAULT_OUTPUT = Path(__file__).resolve().parent.parent / "data" / "population.json"


def get(url, params, attempts=3):
    query = urllib.parse.urlencode(params, safe="[],")
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(f"{url}?{query}", timeout=30) as response:
                # SCB may send a UTF-8 byte order mark before the JSON.
                return json.loads(response.read().decode("utf-8-sig"))
        except TimeoutError:
            # SCB sometimes stalls on a single request; try it again.
            if attempt == attempts:
                raise
            print(f"{url} timed out, retrying")


def find_api():
    for base in BASE_URLS:
        try:
            get(f"{base}/config", {})
            return base
        except (urllib.error.URLError, ValueError) as error:
            print(f"{base}: {error}")
    sys.exit("Could not reach SCB's API")


def find_tables(base):
    """Population tables, best match first, that cover all of YEARS."""
    result = get(f"{base}/tables", {"lang": "sv", "query": SEARCH, "pageSize": 100})
    tables = []
    for table in result["tables"]:
        covers = table.get("firstPeriod", "9999") <= YEARS[0] and table.get("lastPeriod", "") >= YEARS[-1]
        print(
            f"  {table['id']}: {table['label']} "
            f"({table.get('firstPeriod')}-{table.get('lastPeriod')})"
            f"{'' if covers else ' - skipped'}"
        )
        if covers and not table.get("discontinued"):
            tables.append(table)
    # Prefer tables named after the measure itself, e.g. "Folkmängden efter region ...".
    tables.sort(key=lambda table: not table["label"].lower().startswith(SEARCH[:-1]))
    return tables


def build_query(metadata):
    """Value codes for the data request, or None if the table doesn't fit."""
    dimensions = metadata["dimension"]
    time_code = metadata.get("role", {}).get("time", ["Tid"])[0]
    params = {}

    for code in metadata["id"]:
        dimension = dimensions[code]
        values = dimension["category"]["label"]
        if code == time_code:
            if any(year not in values for year in YEARS):
                return None
            params[f"valueCodes[{code}]"] = ",".join(YEARS)
        elif code == "Region":
            if REGION not in values:
                return None
            params[f"valueCodes[{code}]"] = REGION
        elif code == "ContentsCode":
            matches = [key for key, label in values.items() if label.lower().startswith(SEARCH)]
            if not matches:
                return None
            params[f"valueCodes[{code}]"] = matches[0]
        elif not dimension.get("extension", {}).get("elimination"):
            # Age, sex and so on must be leavable out to get totals.
            return None

    return params


def parse(dataset):
    time_code = dataset.get("role", {}).get("time", ["Tid"])[0]
    if any(size != 1 for code, size in zip(dataset["id"], dataset["size"]) if code != time_code):
        sys.exit(f"Expected one value per year, got dimensions {dataset['id']} sized {dataset['size']}")

    index = dataset["dimension"][time_code]["category"]["index"]
    years = sorted(index, key=index.get) if isinstance(index, dict) else index
    rows = [
        {"year": int(year), "population": int(value)}
        for year, value in zip(years, dataset["value"])
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
            print(f"{table['id']} does not have the national total for every year")
            continue
        print(f"Fetching from {table['id']}: {params}")
        dataset = get(f"{url}/data", {"lang": "sv", "outputFormat": "json-stat2", **params})
        return table, f"{url}/data", parse(dataset)

    sys.exit(f"No SCB table has the population for every year in {YEARS[0]}-{YEARS[-1]}")


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
        "title": "Population of Sweden, 31 December",
        "source": f"Statistiska centralbyrån (SCB), tabell {table['id']}: {table['label']}",
        "sourceUrl": source_url,
        "retrieved": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "data": rows,
    }

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(rows)} years to {output}")


if __name__ == "__main__":
    main()
