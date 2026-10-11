# Trafik

A website for traffic data in Sweden.

The front page shows one table for Sweden as a whole, 1975–2025 in five-year
intervals: passenger cars in traffic, population, cars per 1,000 inhabitants (so
growth isn't just population growth), and the distance driven on Swedish roads
in billions of vehicle-kilometres and per inhabitant, with a short summary above
it. Trafikanalys's distance series starts in 1990, so 1975–1985 come from
SIKA's historical series (see below). It is filled in by `cars.js` from
`data/cars.json`, `data/population.json`, `data/traffic.json` and
`data/historical_traffic.json`.

Below that, you can pick any municipality (grouped by county, or by typing
part of its name in the search box, accents optional) to see its
passenger cars in traffic, population and cars per 1,000 inhabitants for the
same years, in a table like the national one, with an estimate of the distance
driven by its passenger cars. Two columns compare it with Sweden as a whole, as
a percentage above or below Sweden's cars per inhabitant and passenger-car km
per inhabitant. Estimates are marked with an asterisk. It is
drawn by `municipalities.js` from `data/municipalities.json`,
`data/municipal_cars.json`, `data/car_ownership.json`,
`data/municipal_distance.json`, `data/car_distance.json` and
`data/historical_traffic.json`. The address keeps the
municipality code, so for example `#0180` opens Stockholm.

In both tables the highest number in each column is bold, and the cars in
traffic, population and total distance columns are hidden until you tick their
"Show columns" checkboxes (`tables.js`).

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
so 1975–2000 are `null` in the file (see the next section for those years). It
finds the table through SCB's table search like the other scripts:

```sh
python3 scripts/fetch_municipal_cars.py
```

The file has `years`, the national total in `sweden`, and one
`{ "code": "0114", "cars": { "2005": ..., "2025": ... } }` entry per
municipality, matching the codes in `data/municipalities.json`.

## Earlier cars per 1,000 inhabitants per municipality

`scripts/fetch_car_ownership.py` fills in some of the years before SCB's
municipal counts. RUS, the county administrative boards' site for the
environmental objectives, republishes SCB's passenger cars in traffic per 1,000
inhabitants for every municipality in table 1 of its *Körsträckor* statistics
(https://www.rus.se/statistik-och-indikatorer/korstrackor/), including 1974,
1980, 1990, 1995, 1998 and 2000. The script finds the workbook on that page (its
name changes every year), reads it with Python's standard library and saves
the years before 2003 to `data/car_ownership.json`:

```sh
python3 scripts/fetch_car_ownership.py
```

The site multiplies a rate by the municipality's population to get its cars
in traffic, which for Sweden as a whole lands within 0.03% of SCB's count.
Municipalities that didn't exist yet in a year have no figure (`null`); 268
have one for 1974 and 289 for 2000 (all but Knivsta).

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
`unavailableYears` in the file (the site takes them from SIKA, below):

```json
{
  "title": "Traffic volume on Swedish roads, all vehicles",
  "unit": "million vehicle-kilometres",
  "unavailableYears": [1975, 1980, 1985],
  "data": [{ "year": 1990, "vehicleKmMillions": 64310 }, ...]
}
```

### Before 1990: SIKA's historical series

`data/historical_traffic.json` has million vehicle-km on Swedish roads in 1975,
1980, 1985 and 1990, all vehicles and passenger cars, from table 16 of SIKA
PM 1999:5 (also published as VTI rapport 439,
https://www.trafa.se/globalassets/sika/sika-pm/pm_199905.pdf). SIKA was the
agency for transport statistics before Trafikanalys. The report is a fixed
PDF, so the figures were typed in by hand rather than fetched. Its 1990 total
(64,310) is the same as Trafikanalys's, so the national table uses its totals
for 1975–1985 as they are.

## Distance driven per municipality

`scripts/fetch_kolada_distance.py` downloads Trafikanalys's distance driven by
passenger cars per inhabitant for every municipality from Kolada, the open
database of municipal statistics (indicator `U07917`, *Genomsnittlig
körsträcka med personbil, mil/inv*), and saves it in km to
`data/municipal_distance.json`. Kolada has 1999, 2000, 2005 and every year from
2008, so of the site's years 2000–2020 are official; 2025 is filled in once
Kolada publishes it, and the rest are estimated as below. Like the national
statistics it is owner-based: cars count where they are registered, wherever
they were driven, and company cars count where the company is registered,
which raises the figures for municipalities with many head offices.

```sh
python3 scripts/fetch_kolada_distance.py
```

The site shows car-km as the km per inhabitant times the population.

### Estimates for the other years

Trafikanalys doesn't publish distance driven per municipality: its finest
breakdown is the county the vehicle is registered in. So the site estimates it
for passenger cars from two official sources, which
`scripts/fetch_car_distance.py` saves to `data/car_distance.json`:

- Sweden's total distance driven by passenger cars per year, from
  Trafikanalys's open API (product `t04010`, *Trafikarbete*), in
  `swedenCarKmMillions`.
- The average distance per passenger car in each county, from table RS1 in
  Trafikanalys's yearly *Körsträckor* workbook on trafa.se, in
  `countyKmPerCar`. trafa.se links only the newest workbooks, so the script
  also reads two older ones that are still there (2015 and 2020, listed in
  `OLDER_WORKBOOKS`). Of 1975–2025 this covers 2015, 2020 and 2025; no
  workbook was found for 2010 or earlier. The script reads the workbooks with
  Python's standard library and handles the slightly different table layouts.

```sh
python3 scripts/fetch_car_distance.py
```

Each year, Sweden's passenger-car distance is shared out over the
municipalities, so the estimates add up to the official total. A
municipality's share is:

- for a year with county averages (2015, 2020 and 2025), its passenger cars
  weighted by its county's average distance per car;
- for other years with SCB's municipal car counts (2005 and 2010), simply its
  share of Sweden's passenger cars, which ignores regional differences;
- before those counts (1975–2000), its population times its cars per
  inhabitant: RUS's figure where there is one (1980, 1990, 1995 and 2000),
  otherwise interpolated between the nearest years with a figure from RUS or
  SCB (1975 between 1974 and 1980, 1985 between 1980 and 1990), or the nearest
  such year for municipalities with none on one side.

Cars in traffic per municipality are SCB's count from 2005 and RUS's rate
times the population for 1980, 1990, 1995 and 2000. For 1975, 1985 and
municipalities RUS has no figure for, they are estimated: Sweden's passenger
cars shared out by the same population times cars per inhabitant. These, and
the cars per 1,000 derived from them, are marked with an asterisk.

Sweden's passenger-car distance itself is official from 1990. For 1975–1985 it
is 1990's figure scaled by SIKA's passenger-car km (the two series differ by
about 2% in 1990, so their figures aren't used as they are). Municipalities
formed after 1975 have no estimate before they existed. (The county averages can't be multiplied straight by SCB's car counts:
they are per car in traffic at any time in the year, SCB counts cars at year
end, and the product falls about 10% short of Sweden's total.)

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
