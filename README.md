# Trafik

A website for traffic data in Sweden.

The front page shows the number of passenger cars in traffic in Sweden,
1975–2025 in five-year intervals: a short summary and a table of cars,
population and cars per 1,000 inhabitants (so growth isn't just population
growth). It is filled in by `cars.js` from `data/cars.json` and
`data/population.json`.

Below that, a table shows the distance driven on Swedish roads each year, in
billions of vehicle-kilometres and per inhabitant, drawn by `traffic.js` from
`data/traffic.json` and `data/population.json`.

Then you can pick any municipality (grouped by county) to see its
passenger cars in traffic, population and cars per 1,000 inhabitants for the
same years, in a table like the national one. It is drawn by
`municipalities.js` from `data/municipalities.json` and
`data/municipal_cars.json`. The address keeps the
municipality code, so for example `#0180` opens Stockholm.

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

You can also run it on GitHub: Actions → **Fetch data** → Run workflow.
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

The **Fetch data** workflow runs this script too. The file looks
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

## Passenger cars per municipality

`scripts/fetch_municipal_cars.py` downloads the number of passenger cars in
traffic at the end of each year in every municipality and saves it to
`data/municipal_cars.json`. SCB only has these figures per municipality from
2002 (table TAB1278, *Fordon i trafik efter län och kommun samt fordonsslag*),
so 1975–2000 are `null` and show as a dash on the site. It finds the table
through SCB's table search like the other scripts:

```sh
python3 scripts/fetch_municipal_cars.py
```

The file has `years`, the national total in `sweden`, and one
`{ "code": "0114", "cars": { "2005": ..., "2025": ... } }` entry per
municipality, matching the codes in `data/municipalities.json`.

## Distance driven

`scripts/fetch_traffic.py` downloads the total distance driven on Swedish
roads each year, all vehicle types together, from Trafikanalys (the Swedish
agency for official transport statistics) and saves it to `data/traffic.json`:

```sh
python3 scripts/fetch_traffic.py
```

It uses Trafikanalys's open API (`api.trafa.se`), product *Trafikarbete*
(`t04010`), measure *Fordonskilometer* in millions of vehicle-kilometres. The
series starts in 1990, so 1975, 1980 and 1985 are listed under
`unavailableYears` in the file:

```json
{
  "title": "Traffic volume on Swedish roads, all vehicles",
  "unit": "million vehicle-kilometres",
  "unavailableYears": [1975, 1980, 1985],
  "data": [{ "year": 1990, "vehicleKmMillions": 64310 }, ...]
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
