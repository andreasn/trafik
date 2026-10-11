#!/usr/bin/env python3
"""Fetch Sweden's long-run road transport trends from ITF/OECD as JSON.

Trafikanalys's vehicle-km series starts in 1990. To estimate 1975-1985, the
site scales the 1990 figures by the trend in two series the International
Transport Forum publishes back to 1970 on OECD's open data API:

- passenger-km travelled by passenger car (dataflow DF_TRENDSPASS), for
  car traffic;
- road freight tonne-km (dataflow DF_TRENDS), for lorries and buses.

Usage:
    python3 scripts/fetch_itf_trends.py [output-path]

Only the Python standard library is needed. The default output path is
data/itf_trends.json, relative to the repository root.
"""

import csv
import io
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SDMX = "https://sdmx.oecd.org/public/rest/data/OECD.ITF"
COUNTRY = "SWE"
YEARS = [str(year) for year in range(1975, 1996, 5)]  # Up to 1995 to overlap Trafikanalys.
# (dataflow, labels the series must have, labels it must not have)
SERIES = {
    "carPassengerKmMillions": ("DSD_TRENDS@DF_TRENDSPASS,1.0", {"Passenger-kilometres", "Passenger cars"}, set()),
    "roadTonneKmMillions": ("DSD_TRENDS@DF_TRENDS,1.0", {"Tonnes-kilometres", "Road"}, {"On own account", "For hire and reward"}),
}
HEADERS = {"User-Agent": "trafik data fetcher (github.com/andreasn/trafik)", "Accept": "application/vnd.sdmx.data+csv; charset=utf-8; labels=both"}
DEFAULT_OUTPUT = Path(__file__).resolve().parent.parent / "data" / "itf_trends.json"


def download(url):
    for attempt in range(1, 4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=120) as response:
                return response.read().decode("utf-8-sig")
        except TimeoutError:
            if attempt == 3:
                raise
            print(f"{url} timed out, retrying")


def series(flow, wanted, unwanted):
    url = f"{SDMX},{flow}/all?startPeriod={YEARS[0]}&endPeriod={YEARS[-1]}&dimensionAtObservation=AllDimensions&format=csvfilewithlabels"
    rows = list(csv.DictReader(io.StringIO(download(url))))
    matches = {}
    for row in rows:
        labels = {value.strip() for value in row.values() if value}
        if row.get("REF_AREA") != COUNTRY or row.get("FREQ") != "A" or not wanted <= labels or labels & unwanted:
            continue
        # The series key is every coded column except time and the observation's own fields.
        key = tuple(v for k, v in row.items() if k.isupper() and k != "TIME_PERIOD" and not k.startswith("OBS_"))
        matches.setdefault(key, {})[row["TIME_PERIOD"]] = float(row["OBS_VALUE"])
    if len(matches) != 1:
        sys.exit(f"Expected one ITF series with {sorted(wanted)} for {COUNTRY}, found {len(matches)}: {list(matches)[:5]}")
    return url, next(iter(matches.values()))


def main():
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUTPUT

    payload = {
        "title": "Sweden's road passenger-km by car and road freight tonne-km",
        "source": "International Transport Forum (ITF), annual transport trends, via OECD Data Explorer",
        "sources": {},
        "retrieved": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
    }
    try:
        for name, (flow, wanted, unwanted) in SERIES.items():
            url, values = series(flow, wanted, unwanted)
            missing = [year for year in YEARS if year not in values]
            if missing:
                sys.exit(f"ITF has no {name} for {', '.join(missing)}")
            payload[name] = {year: round(values[year]) for year in YEARS}
            payload["sources"][name] = url
            print(f"{name}: {payload[name]}")
    except urllib.error.HTTPError as error:
        sys.exit(f"OECD returned HTTP {error.code} for {error.url}")
    except urllib.error.URLError as error:
        sys.exit(f"Could not reach OECD: {error.reason}")

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {output}")


if __name__ == "__main__":
    main()
