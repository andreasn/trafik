# Trafik

A website for traffic data in Sweden.

Open `index.html` in a browser to view the site. No build step is needed.

## Population data

`scripts/fetch_population.py` downloads Sweden's population (31 December) from
Statistics Sweden (SCB) for 1975–2025 in five-year steps and saves it to
`data/population.json`. It needs only Python 3:

```sh
python3 scripts/fetch_population.py
```

You can also run it on GitHub: Actions → **Fetch population data** → Run
workflow. The workflow commits the updated JSON file to the branch.

The file looks like this:

```json
{
  "title": "Population of Sweden, 31 December",
  "source": "Statistics Sweden (SCB), table BE0101A/BefolkningNy",
  "retrieved": "2026-10-10",
  "data": [{ "year": 1975, "population": … }, ...]
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
