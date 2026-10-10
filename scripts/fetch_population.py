#!/usr/bin/env python3
"""Fetch Sweden's population from SCB and save it as JSON for the website.

Uses SCB's PxWeb API (table BE0101A/BefolkningNy, "Folkmängd", population
on 31 December) for the whole country, 1975-2025 in five-year steps.

Usage:
    python3 scripts/fetch_population.py [output-path]

Only the Python standard library is needed. The default output path is
data/population.json, relative to the repository root.
"""

import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API_URL = "https://api.scb.se/OV0104/v1/doris/sv/ssd/START/BE/BE0101/BE0101A/BefolkningNy"
YEARS = [str(year) for year in range(1975, 2026, 5)]
DEFAULT_OUTPUT = Path(__file__).resolve().parent.parent / "data" / "population.json"

REGION = "00"  # The whole of Sweden.
CONTENTS = "BE0101N1"  # Folkmängd (population).


def request(data=None):
    """GET the table's metadata, or POST a query when data is given."""
    req = urllib.request.Request(API_URL)
    if data is not None:
        req.data = json.dumps(data).encode("utf-8")
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=30) as response:
        # SCB sends a UTF-8 byte order mark before the JSON.
        return json.loads(response.read().decode("utf-8-sig"))


def build_query(metadata):
    """Check the table offers what we need and build the data query."""
    variables = {variable["code"]: variable for variable in metadata["variables"]}
    print("Table variables:", ", ".join(variables))

    for code, value in (("Region", REGION), ("ContentsCode", CONTENTS)):
        if code not in variables or value not in variables[code]["values"]:
            sys.exit(f"Table has no {code} value {value!r}")

    available = set(variables["Tid"]["values"])
    print(f"Years available: {min(available)}-{max(available)}")
    missing = [year for year in YEARS if year not in available]
    if missing:
        sys.exit(f"SCB has no data yet for: {', '.join(missing)}")

    # Age, sex and marital status are left out so SCB returns totals across
    # them. That only works for variables SCB lets us leave out.
    required = [
        code
        for code, variable in variables.items()
        if code not in ("Region", "ContentsCode", "Tid") and not variable.get("elimination")
    ]
    if required:
        sys.exit(f"Table requires a selection for: {', '.join(required)}")

    return {
        "query": [
            {"code": "Region", "selection": {"filter": "item", "values": [REGION]}},
            {"code": "ContentsCode", "selection": {"filter": "item", "values": [CONTENTS]}},
            {"code": "Tid", "selection": {"filter": "item", "values": YEARS}},
        ],
        "response": {"format": "json"},
    }


def parse(result):
    key_codes = [column["code"] for column in result["columns"] if column["type"] in ("d", "t")]
    year_index = key_codes.index("Tid")
    rows = [
        {"year": int(row["key"][year_index]), "population": int(row["values"][0])}
        for row in result["data"]
    ]
    return sorted(rows, key=lambda row: row["year"])


def main():
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUTPUT

    try:
        rows = parse(request(build_query(request())))
    except urllib.error.HTTPError as error:
        sys.exit(f"SCB returned HTTP {error.code}: {error.read().decode('utf-8', 'replace')}")
    except urllib.error.URLError as error:
        sys.exit(f"Could not reach SCB: {error.reason}")

    missing = sorted(set(map(int, YEARS)) - {row["year"] for row in rows})
    if missing:
        sys.exit(f"SCB returned no data for: {', '.join(map(str, missing))}")

    payload = {
        "title": "Population of Sweden, 31 December",
        "source": "Statistics Sweden (SCB), table BE0101A/BefolkningNy",
        "sourceUrl": API_URL,
        "retrieved": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "data": rows,
    }

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(rows)} years to {output}")


if __name__ == "__main__":
    main()
