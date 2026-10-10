# Trafik

A website for traffic data in Sweden.

The front page shows the number of passenger cars in traffic in Sweden,
1975–2025 in five-year intervals: a column chart of the total, a column chart of
cars per 1,000 inhabitants (so growth isn't just population growth), and a table
with the exact figures. Hover or tab to a column to see its values. The page is
drawn by `cars.js` from `data/cars.json` and `data/population.json`.

No build step is needed. Browsers block loading the data files on pages opened
straight from disk, so serve the folder to view it, for example with
`python3 -m http.server`, then open http://localhost:8000.

## Population data

`scripts/fetch_population.py` downloads Sweden's population (31 December) from
Statistics Sweden (SCB) for 1975–2025 in five-year steps and saves it to
`data/population.json`. It uses SCB's PxWebApi 2 and searches SCB's tables for
one that covers every year, so it keeps working when SCB replaces a table. It
needs only Python 3:

```sh
python3 scripts/fetch_population.py
```

You can also run it on GitHub: Actions → **Fetch SCB data** → Run workflow.
The workflow fetches both population and cars and commits the updated JSON
files to the branch.

The file looks like this:

```json
{
  "title": "Population of Sweden, 31 December",
  "source": "Statistics Sweden (SCB), table TAB4365: Befolkningsutvecklingen i riket efter kön. År 1749-2025",
  "retrieved": "2026-10-10",
  "data": [{ "year": 1975, "population": 8208442 }, ...]
}
```

## Passenger car data

`scripts/fetch_cars.py` downloads the number of passenger cars in traffic
("personbilar i trafik") in all of Sweden from SCB and saves it to
`data/cars.json`. SCB publishes this monthly from the vehicle register (table
TAB1277, *Fordon enligt bilregistret efter fordonsslag och bestånd*, from
1975), so the script takes the December figure for each year, which matches the
31 December population. Like the population script it finds the table through
SCB's table search instead of hard-coding it:

```sh
python3 scripts/fetch_cars.py
```

The file has the same layout, with `{ "year": 1975, "cars": 2760264 }` rows.

## Using the data

Read a data file from a script on the site:

```js
const response = await fetch("data/population.json");
const { data } = await response.json();
data.forEach(({ year, population }) => console.log(year, population));
```

Browsers block `fetch` on pages opened straight from disk (`file://`), so
serve the site locally when testing, for example with
`python3 -m http.server`.
