// Fills the passenger car summary and table from data/cars.json and
// data/population.json (both fetched from SCB by the scripts in scripts/).

const number = new Intl.NumberFormat("en-GB");

function millions(value, digits = 1) {
  return `${(value / 1e6).toFixed(digits)}M`;
}

async function load() {
  const [cars, population] = await Promise.all(
    ["data/cars.json", "data/population.json"].map((url) => fetch(url).then((response) => {
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
      return response.json();
    })),
  );

  const people = new Map(population.data.map((row) => [row.year, row.population]));
  const rows = cars.data.map((row) => ({
    year: row.year,
    cars: row.cars,
    population: people.get(row.year),
    perThousand: people.has(row.year) ? (row.cars / people.get(row.year)) * 1000 : null,
  }));

  const first = rows[0];
  const last = rows[rows.length - 1];
  document.getElementById("cars-summary").textContent =
    `Sweden had ${millions(last.cars, 2).replace("M", " million")} passenger cars in traffic at the end of ${last.year}, ` +
    `up from ${millions(first.cars, 2).replace("M", " million")} in ${first.year}` +
    (first.perThousand && last.perThousand
      ? `. That is ${Math.round(last.perThousand)} cars per 1,000 inhabitants, compared with ${Math.round(first.perThousand)}.`
      : ".");

  document.querySelector("#cars-table tbody").replaceChildren(...rows.map((row) => {
    const tr = document.createElement("tr");
    const cells = [
      row.year,
      number.format(row.cars),
      row.population ? number.format(row.population) : "–",
      row.perThousand ? Math.round(row.perThousand) : "–",
    ];
    cells.forEach((text, i) => {
      const cell = document.createElement(i === 0 ? "th" : "td");
      if (i === 0) cell.scope = "row";
      else cell.className = "number";
      cell.textContent = text;
      tr.append(cell);
    });
    return tr;
  }));

  const source = document.getElementById("cars-source");
  source.textContent = `Source: ${cars.source} (retrieved ${cars.retrieved}); ${population.source} (retrieved ${population.retrieved}). ` +
    "Cars in traffic are counted at the end of December; population on 31 December.";
}

load().catch((error) => {
  document.getElementById("cars-summary").textContent =
    `Could not load the data (${error.message}). If you opened the file directly, serve the site with "python3 -m http.server".`;
});
