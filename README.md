# Trafik

A website for traffic data in Sweden.

The front page shows the number of passenger cars in traffic in Sweden,
1975–2025 in five-year intervals: a column chart of the total, a column chart of
cars per 1,000 inhabitants (so growth isn't just population growth), and a table
with the exact figures. Hover or tab to a column to see its values. The page is
drawn by `cars.js` from `data/cars.json` and `data/population.json`.

Below that, a table lists the population of every municipality for the same
years, drawn by `municipalities.js` from `data/municipalities.json`. Type in the
box to filter by municipality or county, and click a column heading to sort.

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

## Population per municipality

`scripts/fetch_municipalities.py` downloads the population (31 December) of
each of Sweden's 290 municipalities for the same years and saves it to
`data/municipalities.json`. It searches SCB's tables the same way. SCB splits
this series over several tables (TAB638 has 1968–2024 and TAB5557 has 2025),
so the script combines the years from as few tables as possible, adding up
marital status, age and so on where SCB has no total. It stops with an error if
the municipalities are more than 0.01% away from Sweden's population for the
latest year. (SCB counts a few people in Sweden but in no municipality: 9 in
2025. The file's `sweden` field has the national totals.)
SCB gives the figures for today's municipalities, so a municipality formed
later (Knivsta in 2003, for example) has `null` for the years before it
existed.

```sh
python3 scripts/fetch_municipalities.py
```

The **Fetch SCB data** workflow runs this script too. The file looks
like this:

```json
{
  "title": "Population of Sweden's municipalities, 31 December",
  "source": "Statistics Sweden (SCB), table ...",
  "retrieved": "2026-10-10",
  "years": [1975, 1980, ...],
  "sweden": { "1975": 8208442, ..., "2025": 10605529 },
  "data": [
    {
      "code": "0114",
      "name": "Upplands Väsby",
      "county": "Stockholms län",
      "population": { "1975": 30000, ..., "2025": 50000 }
    },
    ...
  ]
}
```

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
