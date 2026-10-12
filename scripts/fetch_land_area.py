#!/usr/bin/env python3
"""Fetch the land area of Sweden and every municipality from SCB.

The site divides the population by the land area (lakes and sea excluded) to
show inhabitants per square kilometre. SCB publishes land area per
municipality from 1991, in its table of population density, so 1975-1990 use
the earliest year's area; land area hardly changes but for boundary changes,
and the population figures already follow today's municipalities. Like the
other scripts, it finds the table through SCB's table search.

Usage:
    python3 scripts/fetch_land_area.py [output-path]

Only the Python standard library is needed. The default output path is
data/land_area.json, relative to the repository root.
"""

import json
import sys
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

from fetch_municipal_cars import merge_renamed
from fetch_municipalities import MUNICIPALITY, TOTAL
from fetch_population import REGION, YEARS, find_api, get

SEARCHES = ["befolkningstäthet", "landareal"]
MEASURE = "landareal"
DEFAULT_OUTPUT = Path(__file__).resolve().parent.parent / "data" / "land_area.json"


def build_query(metadata):
    """Value codes and years for the data request, or the reason the table doesn't fit."""
    dimensions = metadata["dimension"]
    time_code = metadata.get("role", {}).get("time", ["Tid"])[0]
    params, years, regions = {}, [], {}
    for code in metadata["id"]:
        dimension = dimensions[code]
        values = dimension["category"]["label"]
        if code == time_code:
            available = sorted(values)
            # The years the site shows, and the first year for the ones before it.
            years = sorted({year for year in YEARS if year in values} | set(available[:1]))
            if not years:
                return "no years"
            params[f"valueCodes[{code}]"] = ",".join(years)
        elif code == "Region":
            municipalities = [key for key in values if MUNICIPALITY.match(key)]
            if len(municipalities) < 290 or REGION not in values:
                return f"{len(municipalities)} municipalities"
            params[f"valueCodes[{code}]"] = ",".join([REGION, *municipalities])
            regions = values
        elif code == "ContentsCode":
            matches = [key for key, label in values.items() if label.lower().startswith(MEASURE)]
            if not matches:
                return f"no land area among {list(values.values())}"
            params[f"valueCodes[{code}]"] = matches[0]
        elif not dimension.get("extension", {}).get("elimination"):
            # Sex and the like: the total, since land area is the same for each.
            totals = [key for key, label in values.items() if TOTAL.match(label) or TOTAL.match(key)]
            if not totals:
                return f"no total in {code}"
            params[f"valueCodes[{code}]"] = totals[0]
    if not regions:
        return "no Region dimension"
    return params, years, regions


def parse(dataset):
    """{region: {year: km² or None}} from a json-stat2 dataset with one value per region and year."""
    codes, sizes = dataset["id"], dataset["size"]
    time_code = dataset.get("role", {}).get("time", ["Tid"])[0]

    def ordered(code):
        index = dataset["dimension"][code]["category"]["index"]
        return sorted(index, key=index.get) if isinstance(index, dict) else index

    strides = [1] * len(codes)
    for i in range(len(codes) - 2, -1, -1):
        strides[i] = strides[i + 1] * sizes[i + 1]
    r, t = codes.index("Region"), codes.index(time_code)
    regions, years = ordered("Region"), ordered(time_code)
    table = {}
    for i, value in enumerate(dataset["value"]):
        region = regions[i // strides[r] % sizes[r]]
        year = years[i // strides[t] % sizes[t]]
        # SCB gives 0 for a code in years it wasn't in use.
        table.setdefault(region, {})[year] = round(value, 2) if value else None
    return table


def fetch():
    base = find_api()
    print(f"Using {base}")
    tables = {}
    for search in SEARCHES:
        for table in get(f"{base}/tables", {"lang": "sv", "query": search, "pageSize": 100})["tables"]:
            tables.setdefault(table["id"], table)
    best = None
    for table in tables.values():
        if table.get("discontinued") or "areal" not in table["label"].lower() and "täthet" not in table["label"].lower():
            continue
        url = f"{base}/tables/{table['id']}"
        query = build_query(get(f"{url}/metadata", {"lang": "sv"}))
        skipped = f" - skipped: {query}" if isinstance(query, str) else ""
        print(f"  {table['id']}: {table['label']}{skipped}")
        # Keep the table reaching furthest back; on a tie the one with the most years.
        if not skipped and (best is None or (query[1][0], -len(query[1])) < (best[2][1][0], -len(best[2][1]))):
            best = (table, url, query)
    if best is None:
        sys.exit("No SCB table has the land area of every municipality")
    table, url, (params, years, regions) = best
    print(f"Fetching {', '.join(years)} from {table['id']}")
    dataset = get(f"{url}/data", {"lang": "sv", "outputFormat": "json-stat2", **params})
    return table, f"{url}/data", years, regions, parse(dataset)


def main():
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUTPUT

    try:
        table, source_url, years, regions, values = fetch()
    except urllib.error.HTTPError as error:
        sys.exit(f"SCB returned HTTP {error.code} for {error.url}: {error.read().decode('utf-8', 'replace')}")
    except urllib.error.URLError as error:
        sys.exit(f"Could not reach SCB: {error.reason}")

    sweden = values.pop(REGION)
    merge_renamed(values, regions)
    municipalities = [
        {"code": code, "landAreaKm2": {year: by_year.get(year) for year in years}}
        for code, by_year in sorted(values.items())
        if MUNICIPALITY.match(code)
    ]
    latest = years[-1]
    total = sum(m["landAreaKm2"][latest] or 0 for m in municipalities)
    print(f"{len(municipalities)} municipalities; {latest}: Sweden {sweden.get(latest):,} km², municipalities {total:,.0f} km²")
    if len(municipalities) < 290 or any(m["landAreaKm2"][latest] is None for m in municipalities):
        sys.exit(f"Some municipalities have no land area for {latest}")
    if abs(total - sweden[latest]) > sweden[latest] / 1000:
        sys.exit("The municipalities' land area doesn't add up to Sweden's")

    payload = {
        "title": "Land area of Sweden and its municipalities, excluding lakes and sea",
        "unit": "km²",
        "source": f"Statistiska centralbyrån (SCB), tabell {table['id']}: {table['label']}",
        "sourceUrl": source_url,
        "retrieved": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "years": [int(year) for year in years],
        "sweden": {year: sweden.get(year) for year in years},
        "data": municipalities,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {output}")


if __name__ == "__main__":
    main()
