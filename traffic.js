// Fills the distance-driven summary and table from data/traffic.json
// (fetched from Trafikanalys by scripts/fetch_traffic.py) and
// data/population.json.
async function loadTraffic() {
  const summary = document.getElementById("traffic-summary");
  const number = new Intl.NumberFormat("en-GB");
  const billions = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  const [traffic, population] = await Promise.all(
    ["data/traffic.json", "data/population.json"].map((url) => fetch(url).then((response) => {
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
      return response.json();
    })),
  );

  const people = new Map(population.data.map((row) => [row.year, row.population]));
  const km = new Map(traffic.data.map((row) => [row.year, row.vehicleKmMillions * 1e6]));
  const years = [...new Set([...traffic.unavailableYears, ...km.keys()])].sort((a, b) => a - b);
  const perPerson = (year) => (km.has(year) && people.has(year) ? km.get(year) / people.get(year) : null);

  const first = traffic.data[0];
  const last = traffic.data[traffic.data.length - 1];
  summary.textContent =
    `Vehicles drove ${billions.format(last.vehicleKmMillions / 1000)} billion km on Swedish roads in ${last.year}, ` +
    `${number.format(Math.round(perPerson(last.year)))} km per inhabitant, ` +
    `up from ${billions.format(first.vehicleKmMillions / 1000)} billion km in ${first.year}.`;

  document.querySelector("#traffic-table tbody").replaceChildren(...years.map((year) => {
    const tr = document.createElement("tr");
    const yearCell = document.createElement("th");
    yearCell.scope = "row";
    yearCell.textContent = year;
    tr.append(yearCell);
    const values = [
      km.has(year) ? billions.format(km.get(year) / 1e9) : null,
      perPerson(year) == null ? null : number.format(Math.round(perPerson(year))),
    ];
    for (const value of values) {
      const cell = document.createElement("td");
      cell.className = value == null ? "number missing" : "number";
      cell.textContent = value ?? "–";
      tr.append(cell);
    }
    return tr;
  }));

  document.getElementById("traffic-source").textContent =
    `All vehicle types together. A dash means there is no figure: Trafikanalys's series starts in ${first.year}. ` +
    `Source: ${traffic.source} (retrieved ${traffic.retrieved}); ${population.source} (retrieved ${population.retrieved}).`;
}

loadTraffic().catch((error) => {
  document.getElementById("traffic-summary").textContent = `Could not load the data (${error.message}).`;
});
