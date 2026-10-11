// Fills the national summary and table from data/cars.json and
// data/population.json (fetched from SCB) and data/traffic.json (fetched from
// Trafikanalys) by the scripts in scripts/.

const number = new Intl.NumberFormat("en-GB");
const oneDecimal = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function millions(value, digits = 1) {
  return `${(value / 1e6).toFixed(digits)}M`;
}

async function load() {
  const [cars, population, traffic] = await Promise.all(
    ["data/cars.json", "data/population.json", "data/traffic.json"].map((url) => fetch(url).then((response) => {
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
      return response.json();
    })),
  );

  const people = new Map(population.data.map((row) => [row.year, row.population]));
  const km = new Map(traffic.data.map((row) => [row.year, row.vehicleKmMillions * 1e6]));
  const rows = cars.data.map((row) => {
    const inhabitants = people.get(row.year);
    return {
      year: row.year,
      cars: row.cars,
      population: inhabitants,
      perThousand: inhabitants ? (row.cars / inhabitants) * 1000 : null,
      km: km.get(row.year) ?? null,
      kmPerPerson: inhabitants && km.has(row.year) ? km.get(row.year) / inhabitants : null,
    };
  });

  const first = rows[0];
  const last = rows[rows.length - 1];
  const firstDriven = rows.find((row) => row.km !== null);
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

  document.querySelector("#cars-table tbody").replaceChildren(...rows.map((row) => {
    const tr = document.createElement("tr");
    const cells = [
      row.year,
      number.format(row.cars),
      row.population ? number.format(row.population) : null,
      row.perThousand ? Math.round(row.perThousand) : null,
      row.km ? oneDecimal.format(row.km / 1e9) : null,
      row.kmPerPerson ? number.format(Math.round(row.kmPerPerson)) : null,
    ];
    cells.forEach((text, i) => {
      const cell = document.createElement(i === 0 ? "th" : "td");
      if (i === 0) cell.scope = "row";
      else cell.className = text == null ? "number missing" : "number";
      cell.textContent = text ?? "–";
      tr.append(cell);
    });
    return tr;
  }));

  document.getElementById("cars-source").textContent =
    "Cars in traffic are counted at the end of December; population on 31 December. " +
    `Distance driven is all vehicle types together; a dash means there is no figure (Trafikanalys's series starts in ${firstDriven?.year ?? 1990}). ` +
    `Sources: ${cars.source} (retrieved ${cars.retrieved}); ${population.source} (retrieved ${population.retrieved}); ` +
    `${traffic.source} (retrieved ${traffic.retrieved}).`;
}

load().catch((error) => {
  document.getElementById("cars-summary").textContent =
    `Could not load the data (${error.message}). If you opened the file directly, serve the site with "python3 -m http.server".`;
});
