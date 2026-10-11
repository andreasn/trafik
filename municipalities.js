// Shows one municipality's passenger cars and population, picked from a list
// grouped by county, in a table like the national one. Reads
// data/municipalities.json and data/municipal_cars.json (fetched from SCB by
// scripts/fetch_municipalities.py and scripts/fetch_municipal_cars.py). The
// choice is kept in the address (#0180 for Stockholm) so a link opens the
// same municipality.
async function loadMunicipalities() {
  const select = document.getElementById("municipality-select");
  const caption = document.getElementById("municipality-caption");
  const body = document.querySelector("#municipality-table tbody");
  const source = document.getElementById("municipality-source");
  const number = new Intl.NumberFormat("en-GB");

  const load = (url) => fetch(url).then((response) => {
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.json();
  });
  let population;
  let cars;
  let distance;
  try {
    // The page still works without the car and distance figures.
    [population, cars, distance] = await Promise.all([
      load("data/municipalities.json"),
      load("data/municipal_cars.json").catch(() => null),
      load("data/county_distance.json").catch(() => null),
    ]);
  } catch (error) {
    source.textContent = `Could not load municipality data (${error.message}).`;
    return;
  }
  const byCode = new Map(population.data.map((m) => [m.code, m]));
  const carsByCode = new Map((cars?.data ?? []).map((m) => [m.code, m.cars]));
  const oneDecimal = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  // Trafikanalys has distance driven only per county of registration, so each
  // municipality gets its county's total in proportion to its share of the
  // county's passenger cars. The estimates add up to the county totals.
  const countyCars = {};
  for (const [code, counts] of carsByCode) {
    for (const [year, count] of Object.entries(counts)) {
      const key = `${code.slice(0, 2)}:${year}`;
      countyCars[key] = (countyCars[key] ?? 0) + (count ?? 0);
    }
  }
  function estimatedKm(code, year) {
    const vehicles = carsByCode.get(code)?.[year];
    const countyTotal = distance?.data[code.slice(0, 2)]?.[year]?.total;
    const carsInCounty = countyCars[`${code.slice(0, 2)}:${year}`];
    return vehicles && countyTotal && carsInCounty ? (countyTotal * vehicles) / carsInCounty : null;
  }
  source.textContent =
    "A dash means there is no figure: SCB has cars per municipality from 2002, and some " +
    "municipalities were formed after 1975. Cars in traffic at the end of the year; population on 31 December. " +
    (distance
      ? "Distance driven is an estimate: Trafikanalys publishes passenger-car distance only per county of " +
        "registration, so each county's total is shared out over its municipalities by their number of cars. "
      : "") +
    (cars ? `Source: ${cars.source} (retrieved ${cars.retrieved}); ` : "Source: ") +
    (distance ? `${distance.source} (retrieved ${distance.retrieved}); ` : "") +
    `${population.source} (retrieved ${population.retrieved}).`;

  // One group per county, both in Swedish alphabetical order.
  const byName = (a, b) => a.localeCompare(b, "sv");
  const counties = [...new Set(population.data.map((m) => m.county ?? ""))].sort(byName);
  for (const county of counties) {
    const group = document.createElement("optgroup");
    group.label = county || "Other";
    population.data
      .filter((m) => (m.county ?? "") === county)
      .sort((a, b) => byName(a.name, b.name))
      .forEach((m) => group.append(new Option(m.name, m.code)));
    select.append(group);
  }

  function show(code) {
    const municipality = byCode.get(code);
    const carCounts = carsByCode.get(code) ?? {};
    select.value = code;
    caption.textContent = `${municipality.name}, ${municipality.county ?? "Sweden"}: passenger cars, population and estimated distance driven, five-year intervals`;
    body.replaceChildren(...population.years.map((year) => {
      const people = municipality.population[year];
      const vehicles = carCounts[year];
      const perThousand = people && vehicles != null ? Math.round((vehicles / people) * 1000) : null;
      const km = estimatedKm(code, year);
      const kmPerPerson = km && people ? Math.round(km / people) : null;
      const tr = document.createElement("tr");
      const yearCell = document.createElement("th");
      yearCell.scope = "row";
      yearCell.textContent = year;
      tr.append(yearCell);
      const cells = [
        vehicles,
        people,
        perThousand,
        km == null ? null : oneDecimal.format(km / 1e6),
        kmPerPerson,
      ];
      for (const value of cells) {
        const cell = document.createElement("td");
        cell.className = value == null ? "number missing" : "number";
        cell.textContent = value == null ? "–" : typeof value === "string" ? value : number.format(value);
        tr.append(cell);
      }
      return tr;
    }));
  }

  const fromHash = () => location.hash.slice(1);
  select.addEventListener("change", () => {
    history.replaceState(null, "", `#${select.value}`);
    show(select.value);
  });
  addEventListener("hashchange", () => byCode.has(fromHash()) && show(fromHash()));
  show(byCode.has(fromHash()) ? fromHash() : byCode.has("0180") ? "0180" : population.data[0].code);
}

loadMunicipalities();
