#!/usr/bin/env python3
"""Temporary: list SCB tables about cars and their dimensions."""
import json, urllib.parse, urllib.request

BASE = "https://statistikdatabasen.scb.se/api/v2"

def get(path, params):
    q = urllib.parse.urlencode(params)
    with urllib.request.urlopen(f"{BASE}{path}?{q}", timeout=30) as r:
        return json.loads(r.read().decode("utf-8-sig"))

seen = {}
for query in ["personbilar", "fordon i trafik", "fordonsbestånd", "bilar", "fordon"]:
    for t in get("/tables", {"lang": "sv", "query": query, "pageSize": 100})["tables"]:
        seen.setdefault(t["id"], t)

for tid, t in sorted(seen.items(), key=lambda kv: kv[1].get("firstPeriod") or "9999"):
    print(f"{tid} {t.get('firstPeriod')}-{t.get('lastPeriod')} disc={t.get('discontinued')} {t['label']}")

for tid, t in seen.items():
    if (t.get("firstPeriod") or "9999") > "1990" or "bil" not in t["label"].lower() and "fordon" not in t["label"].lower():
        continue
    print(f"\n=== {tid}: {t['label']}")
    meta = get(f"/tables/{tid}/metadata", {"lang": "sv"})
    for code in meta["id"]:
        d = meta["dimension"][code]
        labels = d["category"]["label"]
        items = list(labels.items())
        print(f"  {code} ({d.get('label')}) elim={d.get('extension', {}).get('elimination')} n={len(items)}: {items[:12]}")
