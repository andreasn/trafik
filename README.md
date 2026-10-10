# Trafik

A website for traffic data in Sweden.

No build step is needed. The page loads `data/population.json`, which browsers
block on pages opened straight from disk, so serve the folder to view it, for
example with `python3 -m http.server`, then open http://localhost:8000.

## Population data

`scripts/fetch_population.py` downloads Sweden's population (31 December) from
Statistics Sweden (SCB) for 1975–2025 in five-year steps and saves it to
`data/population.json`. It uses SCB's PxWebApi 2 and searches SCB's tables for
one that covers every year, so it keeps working when SCB replaces a table. It
needs only Python 3:

```sh
python3 scripts/fetch_population.py
```

You can also run it on GitHub: Actions → **Fetch population data** → Run
workflow. The workflow commits the updated JSON file to the branch.

The file looks like this:

```json
{
  "title": "Population of Sweden, 31 December",
  "source": "Statistics Sweden (SCB), table TAB4365: Befolkningsutvecklingen i riket efter kön. År 1749-2025",
  "retrieved": "2026-10-10",
  "data": [{ "year": 1975, "population": 8208442 }, ...]
}
```

Read it from a script on the site:

```js
const response = await fetch("data/population.json");
const { data } = await response.json();
data.forEach(({ year, population }) => console.log(year, population));
```

Browsers block `fetch` on pages opened straight from disk (`file://`), so
serve the site locally when testing, for example with
`python3 -m http.server`.
