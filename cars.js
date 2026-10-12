// Fills the national table from data/cars.json and
// data/population.json (fetched from SCB), data/traffic.json (Trafikanalys)
// data/car_distance.json (Trafikanalys, passenger cars),
// data/historical_traffic.json (SIKA, for the years before Trafikanalys's
// series) and data/land_area.json (SCB), all but the SIKA file fetched by the
// scripts in scripts/.

const number = new Intl.NumberFormat("sv-SE");

async function load() {
  const load = (url) => fetch(url).then((response) => {
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.json();
  });
  const [cars, population, traffic, historical, land, carDistance] = await Promise.all([
    load("data/cars.json"),
    load("data/population.json"),
    load("data/traffic.json"),
    load("data/historical_traffic.json").catch(() => null),
    load("data/land_area.json").catch(() => null),
    load("data/car_distance.json").catch(() => null),
  ]);

  const people = new Map(population.data.map((row) => [row.year, row.population]));
  // Trafikanalys's distance series starts in 1990; earlier years come from
  // SIKA's historical series, whose 1990 total is the same as Trafikanalys's.
  const km = new Map(traffic.data.map((row) => [row.year, row.vehicleKmMillions * 1e6]));
  const firstKmYear = Math.min(...km.keys());
  const olderYears = [];
  for (const row of historical?.data ?? []) {
    if (km.has(row.year) || row.year > firstKmYear) continue;
    km.set(row.year, row.vehicleKmMillions * 1e6);
    olderYears.push(row.year);
  }

  // Passenger-car km for the distance per car: Trafikanalys's from 1990,
  // SIKA's before.
  const carKm = new Map(
    (historical?.data ?? []).filter((row) => row.passengerCarKmMillions).map((row) => [row.year, row.passengerCarKmMillions * 1e6]),
  );
  for (const [year, millions] of Object.entries(carDistance?.swedenCarKmMillions ?? {})) carKm.set(Number(year), millions * 1e6);
  const firstCarKmYear = Object.keys(carDistance?.swedenCarKmMillions ?? {}).sort()[0];

  const rows = cars.data.map((row) => {
    const inhabitants = people.get(row.year);
    const driven = km.get(row.year) ?? null;
    return {
      year: row.year,
      cars: row.cars,
      population: inhabitants,
      perThousand: inhabitants ? (row.cars / inhabitants) * 1000 : null,
      km: driven,
      kmPerPerson: inhabitants && driven ? driven / inhabitants : null,
      kmPerCar: carKm.has(row.year) && row.cars ? carKm.get(row.year) / row.cars : null,
    };
  });

  // Only shown while loading or if loading fails.
  document.getElementById("cars-status").hidden = true;

  const tableBody = document.querySelector("#cars-table tbody");
  tableBody.replaceChildren(...rows.map((row) => {
    const tr = document.createElement("tr");
    const cells = [
      { text: row.year },
      { text: number.format(row.cars) },
      { text: row.population ? number.format(row.population) : null },
      { text: density(row.population, land?.sweden, row.year) },
      { text: row.perThousand ? Math.round(row.perThousand) : null },
      // Distance in Swedish mil (10 km): millions in total, per inhabitant.
      { text: row.km ? number.format(Math.round(row.km / 1e7)) : null },
      { text: row.kmPerPerson ? number.format(Math.round(row.kmPerPerson / 10)) : null },
      { text: row.kmPerCar ? number.format(Math.round(row.kmPerCar / 10)) : null },
    ];
    cells.forEach(({ text }, i) => {
      const cell = document.createElement(i === 0 ? "th" : "td");
      if (i === 0) cell.scope = "row";
      else cell.className = text == null ? "number missing" : "number";
      cell.textContent = text ?? "–";
      tr.append(cell);
    });
    return tr;
  }));
  boldHighest(tableBody);

  const older = olderYears.filter((year) => rows.some((row) => row.year === year && row.km !== null));
  document.getElementById("cars-source").textContent =
    "Personbilar i trafik räknas i slutet av december, folkmängden den 31 december. " +
    "Körsträckan avser alla fordonsslag tillsammans, i mil (1 mil = 10 km)" +
    (older.length
      ? `. Trafikanalys serie börjar ${firstKmYear}, så ${joinSwedish(older)} kommer från SIKA:s historiska serie, ` +
        `vars siffra för ${firstKmYear} är densamma som Trafikanalys. `
      : ". ") +
    (carKm.size
      ? "Mil per bil är personbilarnas körsträcka delad med antalet personbilar i trafik vid årets slut " +
        `(körsträckan från Trafikanalys${firstCarKmYear ? `, före ${firstCarKmYear} från SIKA` : ""}). `
      : "") +
    (land
      ? `Invånare per km² är folkmängden delad med landarealen (utan sjöar och hav); åren före ${land.years[0]} ` +
        `använder arealen ${land.years[0]}. `
      : "") +
    `Källor: ${cars.source} (hämtad ${cars.retrieved}); ${population.source} (hämtad ${population.retrieved}); ` +
    `${traffic.source} (hämtad ${traffic.retrieved})` +
    (older.length ? `; ${historical.source}` : "") +
    (land ? `; ${land.source} (hämtad ${land.retrieved}).` : ".");
}

load().catch((error) => {
  const status = document.getElementById("cars-status");
  status.hidden = false;
  status.textContent =
    `Kunde inte läsa in data (${error.message}). Om du öppnade filen direkt, starta en webbserver med "python3 -m http.server".`;
});
