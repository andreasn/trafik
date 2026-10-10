#!/usr/bin/env python3
"""Fetch population density for each Swedish municipality from SCB as JSON.

Uses SCB's PxWebApi 2 to get the population density (inhabitants per square
kilometre of land) of all 290 municipalities ("kommuner") for the latest year
SCB has published, along with population and land area when the table has
them. Like fetch_population.py, it searches SCB's table list rather than
naming a table, so it keeps working when SCB replaces a table.

Usage:
    python3 scripts/fetch_density.py [output-path]

Only the Python standard library is needed. The default output path is
data/municipality-density.json, relative to the repository root.
"""

import json
import sys
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

from fetch_population import find_api, get

SEARCH = "befolkningstäthet"
DEFAULT_OUTPUT = Path(__file__).resolve().parent.parent / "data" / "municipality-density.json"
MUNICIPALITIES = 290

# Output field -> test on the lower-cased label of a ContentsCode value.
CONTENTS = {
    "density": lambda label: "täthet" in label or "per kvadratkilometer" in label or "per km" in label,
    "population": lambda label: label.startswith("folkmängd"),
    "landArea": lambda label: "landareal" in label,
}


def find_tables(base):
    """Density tables that are still updated, in SCB's order of relevance."""
    result = get(f"{base}/tables", {"lang": "sv", "query": SEARCH, "pageSize": 100})
    tables = []
    for table in result["tables"]:
        print(f"  {table['id']}: {table['label']} ({table.get('firstPeriod')}-{table.get('lastPeriod')})")
        if not table.get("discontinued"):
            tables.append(table)
    return tables


def is_municipality(code):
    """Municipality codes are four digits, e.g. 0180 Stockholm."""
    return len(code) == 4 and code.isdigit()


def build_query(metadata):
    """Value codes for the data request plus the chosen year and contents,
    or None if the table doesn't have municipal density."""
    dimensions = metadata["dimension"]
    time_code = metadata.get("role", {}).get("time", ["Tid"])[0]
    params = {}
    year = None
    contents = {}

    for code in metadata["id"]:
        dimension = dimensions[code]
        values = dimension["category"]["label"]
        if code == time_code:
            year = max(values)
            params[f"valueCodes[{code}]"] = year
        elif code == "Region":
            municipalities = [value for value in values if is_municipality(value)]
            if len(municipalities) < MUNICIPALITIES:
                return None
            params[f"valueCodes[{code}]"] = ",".join(municipalities)
        elif code == "ContentsCode":
            for field, matches in CONTENTS.items():
                found = [key for key, label in values.items() if matches(label.lower())]
                if found:
                    contents[found[0]] = field
            if "density" not in contents.values():
                return None
            params[f"valueCodes[{code}]"] = ",".join(contents)
        else:
            # Sex and the like: take the total. Density can't be summed, so
            # prefer an explicit total value over leaving the dimension out.
            totals = [
                key for key, label in values.items()
                if "+" in key or label.lower().startswith(("total", "båda", "samtliga"))
            ]
            if totals:
                params[f"valueCodes[{code}]"] = totals[0]
            elif not dimension.get("extension", {}).get("elimination"):
                return None

    if year is None:
        return None
    return params, year, contents


def parse(dataset, contents):
    """One row per municipality from a json-stat2 dataset."""
    ids, sizes = dataset["id"], dataset["size"]
    positions = {}
    for code in ids:
        index = dataset["dimension"][code]["category"]["index"]
        positions[code] = index if isinstance(index, dict) else {key: i for i, key in enumerate(index)}

    def value_at(**chosen):
        offset = 0
        for code, size in zip(ids, sizes):
            offset = offset * size + (positions[code][chosen[code]] if code in chosen else 0)
        return dataset["value"][offset]

    for code, size in zip(ids, sizes):
        if code not in ("Region", "ContentsCode") and size != 1:
            sys.exit(f"Expected one value for {code}, got {size}")

    labels = dataset["dimension"]["Region"]["category"]["label"]
    rows = []
    for region in positions["Region"]:
        name = labels[region]
        # Some tables label regions "0180 Stockholm"; keep only the name.
        if name.startswith(region):
            name = name[len(region):].strip()
        row = {"code": region, "name": name}
        for content, field in contents.items():
            value = value_at(Region=region, ContentsCode=content)
            row[field] = value
        if row["density"] is not None:
            rows.append(row)
    return sorted(rows, key=lambda row: row["code"])


def fetch():
    base = find_api()
    print(f"Using {base}")
    print(f"Tables matching {SEARCH!r}:")

    for table in find_tables(base):
        url = f"{base}/tables/{table['id']}"
        query = build_query(get(f"{url}/metadata", {"lang": "sv"}))
        if query is None:
            print(f"{table['id']} does not have density for every municipality")
            continue
        params, year, contents = query
        print(f"Fetching {year} from {table['id']}: {', '.join(contents.values())}")
        dataset = get(f"{url}/data", {"lang": "sv", "outputFormat": "json-stat2", **params})
        return table, f"{url}/data", year, parse(dataset, contents)

    sys.exit("No SCB table has population density for every municipality")


def main():
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUTPUT

    try:
        table, source_url, year, rows = fetch()
    except urllib.error.HTTPError as error:
        sys.exit(f"SCB returned HTTP {error.code} for {error.url}: {error.read().decode('utf-8', 'replace')}")
    except urllib.error.URLError as error:
        sys.exit(f"Could not reach SCB: {error.reason}")

    if len(rows) != MUNICIPALITIES:
        print(f"Warning: expected {MUNICIPALITIES} municipalities, got {len(rows)}")

    payload = {
        "title": "Population density of Swedish municipalities, inhabitants per km² of land",
        "source": f"Statistics Sweden (SCB), table {table['id']}: {table['label']}",
        "sourceUrl": source_url,
        "retrieved": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "year": int(year),
        "data": rows,
    }

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(rows)} municipalities for {year} to {output}")


if __name__ == "__main__":
    main()
