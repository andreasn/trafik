#!/usr/bin/env python3
"""Fetch the population of every Swedish municipality from SCB as JSON.

Uses SCB's PxWebApi 2 to get the population ("Folkmängd", 31 December) of
each of Sweden's municipalities (kommuner), 1975-2025 in five-year steps.
Like fetch_population.py, it searches SCB's table list rather than naming
a table, so it keeps working when SCB replaces one. SCB splits the series
over several tables (TAB638 has 1968-2024 and TAB5557 has 2025, for
example), so the years are combined from as few tables as possible.

SCB gives the figures for today's municipalities. A municipality formed
after a given year (Knivsta in 2003, for example) has null for that year;
SCB itself gives 0 there.

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

from fetch_population import REGION, SEARCH, YEARS, find_api, get

MUNICIPALITY = re.compile(r"^\d{4}$")  # Municipality codes have four digits, counties two.
TOTAL = re.compile(r"^(tot|totalt|total|samtliga|alla)\b", re.IGNORECASE)
DEFAULT_OUTPUT = Path(__file__).resolve().parent.parent / "data" / "municipalities.json"


def find_tables(base):
    """Population tables that may have the municipalities, best match first."""
    result = get(f"{base}/tables", {"lang": "sv", "query": SEARCH, "pageSize": 100})
    tables = [
        table
        for table in result["tables"]
        if not table.get("discontinued")
        and table.get("firstPeriod", "9999") <= YEARS[-1]
        and table.get("lastPeriod", "") >= YEARS[0]
        # Projections reach past today; they are not counts.
        and "framskrivning" not in table["label"].lower()
        and table.get("lastPeriod", "")[:4] <= str(datetime.now(timezone.utc).year)
    ]
    # Prefer "Folkmängden efter region ...", then other tables named after the measure.
    tables.sort(key=lambda table: (
        not table["label"].lower().startswith("folkmängden efter region"),
        not table["label"].lower().startswith(SEARCH[:-1]),
    ))
    return tables


def build_query(metadata, needed):
    """Value codes, years and region labels for a request, or the reason the table doesn't fit."""
    dimensions = metadata["dimension"]
    time_code = metadata.get("role", {}).get("time", ["Tid"])[0]
    params = {}
    regions = None

    for code in metadata["id"]:
        dimension = dimensions[code]
        values = dimension["category"]["label"]
        if code == time_code:
            years = [year for year in needed if year in values]
            if not years:
                return f"no years in {', '.join(needed)}"
            params[f"valueCodes[{code}]"] = ",".join(years)
        elif code == "Region":
            municipalities = [key for key in values if MUNICIPALITY.match(key)]
            if len(municipalities) < 290 or REGION not in values:
                return f"{len(municipalities)} municipalities, national total {'present' if REGION in values else 'missing'}"
            regions = values
            params[f"valueCodes[{code}]"] = ",".join([REGION, *municipalities])
        elif code == "ContentsCode":
            matches = [key for key, label in values.items() if label.lower().startswith(SEARCH)]
            if not matches:
                return f"no {SEARCH!r} measure among {list(values.values())}"
            params[f"valueCodes[{code}]"] = matches[0]
        elif not dimension.get("extension", {}).get("elimination"):
            # Age, sex and so on: take the total if there is one, otherwise
            # every value, which parse adds up.
            totals = [key for key, label in values.items() if TOTAL.match(label) or TOTAL.match(key)]
            params[f"valueCodes[{code}]"] = totals[0] if totals else ",".join(values)

    if regions is None:
        return "no Region dimension"
    return params, years, regions


def name(label, code):
    """'0114 Upplands Väsby' or 'Upplands Väsby' -> 'Upplands Väsby'."""
    return label.removeprefix(code).strip()


def parse(dataset):
    """{region: {year: population or None}} from a json-stat2 dataset, summed over other dimensions."""
    codes, sizes = dataset["id"], dataset["size"]
    time_code = dataset.get("role", {}).get("time", ["Tid"])[0]

    def ordered(code):
        index = dataset["dimension"][code]["category"]["index"]
        return sorted(index, key=index.get) if isinstance(index, dict) else index

    # json-stat2 values are in row-major order over the dimensions.
    strides = [1] * len(codes)
    for i in range(len(codes) - 2, -1, -1):
        strides[i] = strides[i + 1] * sizes[i + 1]
    r, t = codes.index("Region"), codes.index(time_code)
    regions, years = ordered("Region"), ordered(time_code)

    table = {}
    for i, value in enumerate(dataset["value"]):
        cell = table.setdefault(regions[i // strides[r] % sizes[r]], {})
        year = years[i // strides[t] % sizes[t]]
        if value is None:
            cell.setdefault(year, None)
        else:
            cell[year] = (cell.get(year) or 0) + int(value)
    return table


def fetch():
    base = find_api()
    print(f"Using {base}")
    needed = list(YEARS)
    values, labels, sources = {}, {}, []

    candidates = []
    for table in find_tables(base):
        url = f"{base}/tables/{table['id']}"
        metadata = get(f"{url}/metadata", {"lang": "sv"})
        query = build_query(metadata, YEARS)
        skipped = f" - skipped: {query}" if isinstance(query, str) else ""
        print(f"  {table['id']}: {table['label']}{skipped}")
        if not skipped:
            candidates.append((table, url, metadata, query[1]))
            if len(query[1]) == len(YEARS):
                break  # This table has every year.

    while needed:
        # Take the table that has the most of the years still needed; the
        # order from find_tables breaks ties.
        coverage = [(len(set(years) & set(needed)), i) for i, (*_, years) in enumerate(candidates)]
        count, best = max(coverage, key=lambda item: (item[0], -item[1]), default=(0, None))
        if not count:
            sys.exit(f"No SCB table has the municipalities' population for {', '.join(needed)}")
        table, url, metadata, _ = candidates[best]
        params, years, regions = build_query(metadata, needed)
        print(f"Fetching {', '.join(years)} from {table['id']}")
        dataset = get(f"{url}/data", {"lang": "sv", "outputFormat": "json-stat2", **params})
        for region, by_year in parse(dataset).items():
            values.setdefault(region, {}).update(by_year)
        labels.update(regions)
        sources.append((table, f"{url}/data", years))
        needed = [year for year in needed if year not in years]

    counties = {code: name(label, code) for code, label in labels.items() if len(code) == 2}
    municipalities = [
        {
            "code": code,
            "name": name(labels[code], code),
            "county": counties.get(code[:2]),
            # SCB gives 0 for years before a municipality existed.
            "population": {year: values[code].get(year) or None for year in YEARS},
        }
        for code in sorted(values)
        if MUNICIPALITY.match(code)
    ]
    return sources, values[REGION], municipalities


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
    # SCB counts a handful of people in Sweden but in no municipality (9 in
    # 2025), so allow a gap of up to 0.01%.
    gap = abs(national.get(latest, 0) - sum(m["population"][latest] for m in municipalities))
    if gap > national.get(latest, 0) / 10_000:
        sys.exit(f"The municipalities are {gap:,} away from Sweden's population in {latest}")


def main():
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUTPUT

    try:
        sources, national, municipalities = fetch()
    except urllib.error.HTTPError as error:
        sys.exit(f"SCB returned HTTP {error.code} for {error.url}: {error.read().decode('utf-8', 'replace')}")
    except urllib.error.URLError as error:
        sys.exit(f"Could not reach SCB: {error.reason}")

    print(f"Got {len(municipalities)} municipalities:")
    check(national, municipalities)

    payload = {
        "title": "Population of Sweden's municipalities, 31 December",
        "source": "Statistics Sweden (SCB), " + "; ".join(
            f"table {table['id']}: {table['label']}" for table, _, _ in sources
        ),
        "sources": [
            {"table": table["id"], "label": table["label"], "url": url, "years": [int(year) for year in years]}
            for table, url, years in sources
        ],
        "retrieved": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "years": [int(year) for year in YEARS],
        # Sweden's total from the same tables; it can be a few people more
        # than the sum of the municipalities.
        "sweden": {year: national.get(year) for year in YEARS},
        "data": municipalities,
    }

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(municipalities)} municipalities to {output}")


if __name__ == "__main__":
    main()
