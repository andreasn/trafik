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

QUERY = {
    "query": [
        # "00" is the whole of Sweden. Age, sex and marital status are left
        # out, so SCB returns totals across them.
        {"code": "Region", "selection": {"filter": "item", "values": ["00"]}},
        {"code": "ContentsCode", "selection": {"filter": "item", "values": ["BE0101N1"]}},
        {"code": "Tid", "selection": {"filter": "item", "values": YEARS}},
    ],
    "response": {"format": "json"},
}


def fetch():
    request = urllib.request.Request(
        API_URL,
        data=json.dumps(QUERY).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        # SCB sends a UTF-8 byte order mark before the JSON.
        return json.loads(response.read().decode("utf-8-sig"))


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
        rows = parse(fetch())
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
