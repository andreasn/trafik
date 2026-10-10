"""Temporary: list SCB tables with vehicles per municipality and their dimensions."""
import re
from fetch_population import find_api, get

base = find_api()
seen = set()
for query in ["fordon i trafik", "personbilar i trafik", "bilregistret", "fordon region", "personbilar region"]:
    result = get(f"{base}/tables", {"lang": "sv", "query": query, "pageSize": 100})
    for table in result["tables"]:
        if table["id"] in seen:
            continue
        seen.add(table["id"])
        meta = get(f"{base}/tables/{table['id']}/metadata", {"lang": "sv"})
        dims = meta["dimension"]
        region = dims.get("Region", {}).get("category", {}).get("label", {})
        munis = [k for k in region if re.match(r"^\d{4}$", k)]
        if len(munis) < 250:
            continue
        print(f"\n=== {table['id']}: {table['label']} ({table.get('firstPeriod')}-{table.get('lastPeriod')}) discontinued={table.get('discontinued')}")
        for code in meta["id"]:
            labels = dims[code]["category"]["label"]
            elim = dims[code].get("extension", {}).get("elimination")
            items = list(labels.items())
            show = items[:3] + [("...", "...")] + items[-3:] if code in ("Region", "Tid") else items[:25]
            print(f"  {code} ({dims[code].get('label')}), {len(labels)} values, elimination={elim}: {show}")
