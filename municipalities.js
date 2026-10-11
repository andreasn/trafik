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
      load("data/car_distance.json").catch(() => null),
    ]);
  } catch (error) {
    source.textContent = `Could not load municipality data (${error.message}).`;
    return;
  }
  const byCode = new Map(population.data.map((m) => [m.code, m]));
  const carsByCode = new Map((cars?.data ?? []).map((m) => [m.code, m.cars]));
  const oneDecimal = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  // Trafikanalys doesn't publish distance driven per municipality, so it is
  // estimated. Where the Körsträckor report has an average distance per car
  // for the county (2025), that average times the municipality's cars;
  // otherwise Sweden's passenger-car distance shared out by the
  // municipality's share of Sweden's cars.
  const swedenCars = {};
  for (const counts of carsByCode.values()) {
    for (const [year, count] of Object.entries(counts)) swedenCars[year] = (swedenCars[year] ?? 0) + (count ?? 0);
  }
  function estimatedKm(code, year) {
    const vehicles = carsByCode.get(code)?.[year];
    if (!vehicles || !distance) return null;
    const countyAverage = distance.countyKmPerCar[year]?.kmPerCar[code.slice(0, 2)];
    if (countyAverage) return vehicles * countyAverage;
    const swedenKm = distance.swedenCarKmMillions[year] * 1e6;
    return swedenKm && swedenCars[year] ? (swedenKm * vehicles) / swedenCars[year] : null;
  }
  const countyYears = Object.keys(distance?.countyKmPerCar ?? {});

  source.textContent =
    "A dash means there is no figure: SCB has cars per municipality from 2002, and some " +
    "municipalities were formed after 1975. Cars in traffic at the end of the year; population on 31 December. " +
    (distance
      ? "Distance driven by passenger cars is an estimate, as Trafikanalys doesn't publish it per municipality: " +
        (countyYears.length
          ? `for ${countyYears.join(", ")} the municipality's cars times its county's average distance per car; ` +
            "for other years "
          : "") +
        "Sweden's passenger-car distance shared out by the municipality's share of Sweden's cars. "
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
