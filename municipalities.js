// Shows one municipality's population, picked from a list grouped by county,
// in a table like the national one. Reads data/municipalities.json (fetched
// from SCB by scripts/fetch_municipalities.py). The choice is kept in the
// address (#0180 for Stockholm) so a link opens the same municipality.
async function loadMunicipalities() {
  const select = document.getElementById("municipality-select");
  const caption = document.getElementById("municipality-caption");
  const body = document.querySelector("#municipality-table tbody");
  const source = document.getElementById("municipality-source");
  const number = new Intl.NumberFormat("en-GB");

  let json;
  try {
    const response = await fetch("data/municipalities.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    json = await response.json();
  } catch (error) {
    source.textContent = `Could not load municipality data (${error.message}).`;
    return;
  }
  const byCode = new Map(json.data.map((m) => [m.code, m]));
  source.textContent =
    `Population on 31 December. A dash means the municipality did not exist yet. ` +
    `Source: ${json.source}, retrieved ${json.retrieved}.`;

  // One group per county, both in Swedish alphabetical order.
  const byName = (a, b) => a.localeCompare(b, "sv");
  const counties = [...new Set(json.data.map((m) => m.county ?? ""))].sort(byName);
  for (const county of counties) {
    const group = document.createElement("optgroup");
    group.label = county || "Other";
    json.data
      .filter((m) => (m.county ?? "") === county)
      .sort((a, b) => byName(a.name, b.name))
      .forEach((m) => group.append(new Option(m.name, m.code)));
    select.append(group);
  }

  function show(code) {
    const municipality = byCode.get(code);
    select.value = code;
    caption.textContent = `${municipality.name}, ${municipality.county ?? "Sweden"}: population, five-year intervals`;
    body.replaceChildren(...json.years.map((year) => {
      const tr = document.createElement("tr");
      const yearCell = document.createElement("th");
      yearCell.scope = "row";
      yearCell.textContent = year;
      const value = municipality.population[year];
      const cell = document.createElement("td");
      cell.className = value == null ? "number missing" : "number";
      cell.textContent = value == null ? "–" : number.format(value);
      tr.append(yearCell, cell);
      return tr;
    }));
  }

  const fromHash = () => location.hash.slice(1);
  select.addEventListener("change", () => {
    history.replaceState(null, "", `#${select.value}`);
    show(select.value);
  });
  addEventListener("hashchange", () => byCode.has(fromHash()) && show(fromHash()));
  show(byCode.has(fromHash()) ? fromHash() : byCode.has("0180") ? "0180" : json.data[0].code);
}

loadMunicipalities();
