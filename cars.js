// Fills the national table from data/cars.json and
// data/population.json (fetched from SCB), data/traffic.json (Trafikanalys)
// and data/historical_traffic.json (SIKA, for the years before Trafikanalys's
// series), all but the last fetched by the scripts in scripts/.

const number = new Intl.NumberFormat("sv-SE");

async function load() {
  const load = (url) => fetch(url).then((response) => {
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.json();
  });
  const [cars, population, traffic, historical] = await Promise.all([
    load("data/cars.json"),
    load("data/population.json"),
    load("data/traffic.json"),
    load("data/historical_traffic.json").catch(() => null),
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
      { text: row.perThousand ? Math.round(row.perThousand) : null },
      // Distance in Swedish mil (10 km): millions in total, per inhabitant.
      { text: row.km ? number.format(Math.round(row.km / 1e7)) : null },
      { text: row.kmPerPerson ? number.format(Math.round(row.kmPerPerson / 10)) : null },
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
    `Källor: ${cars.source} (hämtad ${cars.retrieved}); ${population.source} (hämtad ${population.retrieved}); ` +
    `${traffic.source} (hämtad ${traffic.retrieved})` +
    (older.length ? `; ${historical.source}.` : ".");
}

load().catch((error) => {
  const status = document.getElementById("cars-status");
  status.hidden = false;
  status.textContent =
    `Kunde inte läsa in data (${error.message}). Om du öppnade filen direkt, starta en webbserver med "python3 -m http.server".`;
});
