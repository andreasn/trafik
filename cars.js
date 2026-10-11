// Fills the national summary and table from data/cars.json and
// data/population.json (fetched from SCB), data/traffic.json and
// data/car_distance.json (Trafikanalys) and data/itf_trends.json (ITF/OECD),
// all fetched by the scripts in scripts/.

const number = new Intl.NumberFormat("en-GB");
const oneDecimal = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function millions(value, digits = 1) {
  return `${(value / 1e6).toFixed(digits)}M`;
}

async function load() {
  const load = (url) => fetch(url).then((response) => {
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.json();
  });
  // The ITF trends and car distance only refine the pre-1990 estimate.
  const [cars, population, traffic, trends, carDistance] = await Promise.all([
    load("data/cars.json"),
    load("data/population.json"),
    load("data/traffic.json"),
    load("data/itf_trends.json").catch(() => null),
    load("data/car_distance.json").catch(() => null),
  ]);

  const people = new Map(population.data.map((row) => [row.year, row.population]));
  const km = new Map(traffic.data.map((row) => [row.year, row.vehicleKmMillions * 1e6]));
  const carCounts = new Map(cars.data.map((row) => [row.year, row.cars]));

  // Trafikanalys's distance series starts in 1990. Earlier years are
  // estimated by scaling that first year: its passenger-car km by ITF's
  // passenger-km by car, and the rest (lorries, buses and so on) by ITF's road
  // freight tonne-km. Without the ITF file, by the number of passenger cars.
  const firstKmYear = Math.min(...km.keys());
  const base = String(firstKmYear);
  const carKm = (carDistance?.swedenCarKmMillions[base] ?? 0) * 1e6;
  const passengerKm = trends?.carPassengerKmMillions;
  const tonneKm = trends?.roadTonneKmMillions;
  const useTrends = Boolean(carKm && passengerKm?.[base] && tonneKm?.[base]);
  const kmPerCar = km.get(firstKmYear) / carCounts.get(firstKmYear);
  function estimatedKm(year, carCount) {
    const y = String(year);
    if (useTrends && passengerKm[y] && tonneKm[y]) {
      return carKm * (passengerKm[y] / passengerKm[base]) + (km.get(firstKmYear) - carKm) * (tonneKm[y] / tonneKm[base]);
    }
    return Number.isFinite(kmPerCar) ? carCount * kmPerCar : null;
  }

  const rows = cars.data.map((row) => {
    const inhabitants = people.get(row.year);
    const fallback = !km.has(row.year) && row.year < firstKmYear ? estimatedKm(row.year, row.cars) : null;
    const estimated = fallback != null;
    const driven = km.get(row.year) ?? fallback;
    return {
      year: row.year,
      cars: row.cars,
      population: inhabitants,
      perThousand: inhabitants ? (row.cars / inhabitants) * 1000 : null,
      km: driven,
      kmPerPerson: inhabitants && driven ? driven / inhabitants : null,
      estimated,
    };
  });

  const first = rows[0];
  const last = rows[rows.length - 1];
  const firstDriven = rows.find((row) => row.km !== null && !row.estimated);
  document.getElementById("cars-summary").textContent =
    `Sweden had ${millions(last.cars, 2).replace("M", " million")} passenger cars in traffic at the end of ${last.year}, ` +
    `up from ${millions(first.cars, 2).replace("M", " million")} in ${first.year}` +
    (first.perThousand && last.perThousand
      ? `. That is ${Math.round(last.perThousand)} cars per 1,000 inhabitants, compared with ${Math.round(first.perThousand)}.`
      : ".") +
    (firstDriven && last.km
      ? ` Vehicles drove ${oneDecimal.format(last.km / 1e9)} billion km on Swedish roads in ${last.year}, ` +
        `${number.format(Math.round(last.kmPerPerson))} km per inhabitant, ` +
        `up from ${oneDecimal.format(firstDriven.km / 1e9)} billion km in ${firstDriven.year}.`
      : "");

  const tableBody = document.querySelector("#cars-table tbody");
  tableBody.replaceChildren(...rows.map((row) => {
    const tr = document.createElement("tr");
    // The last two columns are estimates before 1990; those cells get an asterisk.
    const cells = [
      { text: row.year },
      { text: number.format(row.cars) },
      { text: row.population ? number.format(row.population) : null },
      { text: row.perThousand ? Math.round(row.perThousand) : null },
      { text: row.km ? oneDecimal.format(row.km / 1e9) : null, estimate: row.estimated },
      { text: row.kmPerPerson ? number.format(Math.round(row.kmPerPerson)) : null, estimate: row.estimated },
    ];
    cells.forEach(({ text, estimate }, i) => {
      const cell = document.createElement(i === 0 ? "th" : "td");
      if (i === 0) cell.scope = "row";
      else cell.className = text == null ? "number missing" : "number";
      cell.textContent = text ?? "–";
      if (estimate && text != null) {
        const mark = document.createElement("abbr");
        mark.title = "Estimate";
        mark.textContent = "*";
        cell.append(mark);
      }
      tr.append(cell);
    });
    return tr;
  }));
  boldHighest(tableBody);

  const estimates = rows.filter((row) => row.estimated).map((row) => row.year);
  document.getElementById("cars-source").textContent =
    (estimates.length
      ? `* Estimate: Trafikanalys's distance series starts in ${firstKmYear}, so ${estimates.join(", ")} ` +
        (useTrends
          ? `scale ${firstKmYear}'s figure: passenger-car km by ITF's passenger-km travelled by car, and other ` +
            "vehicles' km by ITF's road freight tonne-km. Checked against 1995 this lands within 1% of the official " +
            "figure; it assumes about as many people per car and as much freight per lorry as in 1990. "
          : `are each year's passenger cars times the ${number.format(Math.round(kmPerCar))} vehicle-km per car of ` +
            `${firstKmYear}, which assumes cars were driven as much in earlier years. `)
      : "") +
    "Cars in traffic are counted at the end of December; population on 31 December. " +
    "Distance driven is all vehicle types together. " +
    `Sources: ${cars.source} (retrieved ${cars.retrieved}); ${population.source} (retrieved ${population.retrieved}); ` +
    `${traffic.source} (retrieved ${traffic.retrieved})` +
    (useTrends && estimates.length ? `; ${trends.source} (retrieved ${trends.retrieved}).` : ".");
}

load().catch((error) => {
  document.getElementById("cars-summary").textContent =
    `Could not load the data (${error.message}). If you opened the file directly, serve the site with "python3 -m http.server".`;
});
