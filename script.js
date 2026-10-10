// Fills the population column from data/population.json.
async function loadPopulation() {
  const source = document.getElementById("population-source");

  try {
    const response = await fetch("data/population.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { data, source: name, retrieved } = await response.json();

    for (const { year, population } of data) {
      const cell = document.querySelector(`td[data-year="${year}"]`);
      if (cell) cell.textContent = population.toLocaleString("en");
    }
    source.textContent = `Population on 31 December. Source: ${name}, retrieved ${retrieved}.`;
  } catch (error) {
    source.textContent = `Could not load population data (${error.message}).`;
  }
}

loadPopulation();

// Builds the municipality table from data/municipalities.json, with a
// filter box and sortable columns.
async function loadMunicipalities() {
  const table = document.getElementById("municipalities");
  const headRow = table.querySelector("thead tr");
  const body = table.querySelector("tbody");
  const filter = document.getElementById("municipality-filter");
  const source = document.getElementById("municipality-source");

  let json;
  try {
    const response = await fetch("data/municipalities.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    json = await response.json();
  } catch (error) {
    source.textContent = `Could not load municipality data (${error.message}).`;
    return;
  }
  const municipalities = json.data;
  const years = json.years.map(String);
  source.textContent =
    `Population on 31 December. A dash means the municipality did not exist yet. ` +
    `Source: ${json.source}, retrieved ${json.retrieved}.`;

  const columns = [
    { label: "Municipality", value: (m) => m.name },
    { label: "County", value: (m) => m.county ?? "" },
    ...years.map((year) => ({ label: year, value: (m) => m.population[year], number: true })),
  ];
  let sortColumn = 0;
  let ascending = true;

  for (const [index, column] of columns.entries()) {
    const th = document.createElement("th");
    th.scope = "col";
    if (column.number) th.className = "number";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = column.label;
    button.addEventListener("click", () => {
      // Numbers sort largest first on the first click, names A–Z.
      ascending = sortColumn === index ? !ascending : !column.number;
      sortColumn = index;
      render();
    });
    th.append(button);
    headRow.append(th);
  }

  function compare(a, b) {
    const { value } = columns[sortColumn];
    const x = value(a);
    const y = value(b);
    // Missing years go last whichever way the column is sorted.
    if (x == null || y == null) return (x == null) - (y == null);
    const order = typeof x === "number" ? x - y : x.localeCompare(y, "sv");
    return ascending ? order : -order;
  }

  function render() {
    const query = filter.value.trim().toLocaleLowerCase("sv");
    const rows = municipalities
      .filter((m) => !query || `${m.name} ${m.county ?? ""}`.toLocaleLowerCase("sv").includes(query))
      .sort(compare);

    body.replaceChildren(
      ...rows.map((m) => {
        const tr = document.createElement("tr");
        for (const column of columns) {
          const td = document.createElement("td");
          const value = column.value(m);
          if (column.number) {
            td.className = value == null ? "number missing" : "number";
            td.textContent = value == null ? "–" : value.toLocaleString("en");
          } else {
            td.textContent = value;
          }
          tr.append(td);
        }
        return tr;
      }),
    );

    headRow.querySelectorAll("th").forEach((th, index) => {
      if (index === sortColumn) th.setAttribute("aria-sort", ascending ? "ascending" : "descending");
      else th.removeAttribute("aria-sort");
    });
  }

  filter.addEventListener("input", render);
  render();
}

loadMunicipalities();
