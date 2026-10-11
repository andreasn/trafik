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
  let swedenCars;
  try {
    // The page still works without the car and distance figures.
    [population, cars, distance, swedenCars] = await Promise.all([
      load("data/municipalities.json"),
      load("data/municipal_cars.json").catch(() => null),
      load("data/car_distance.json").catch(() => null),
      load("data/cars.json").catch(() => null),
    ]);
  } catch (error) {
    source.textContent = `Could not load municipality data (${error.message}).`;
    return;
  }
  const byCode = new Map(population.data.map((m) => [m.code, m]));
  const carsByCode = new Map((cars?.data ?? []).map((m) => [m.code, m.cars]));
  const oneDecimal = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  // Trafikanalys doesn't publish distance driven per municipality, so it is
  // estimated by sharing out Sweden's passenger-car distance; the estimates
  // add up to Sweden's total. A municipality's share is:
  // - its passenger cars, weighted by its county's average distance per car
  //   where the Körsträckor report has one (2025);
  // - otherwise its passenger cars;
  // - before SCB's municipal car counts (2002), its population times its
  //   cars per inhabitant in the first year with counts (2005).
  const carYears = [...new Set([...carsByCode.values()].flatMap((counts) => Object.keys(counts)))].sort();
  const baseYear = carYears.find((year) => [...carsByCode.values()].some((counts) => counts[year]));
  const carsPerPerson = (code) => {
    const vehicles = carsByCode.get(code)?.[baseYear];
    const people = byCode.get(code)?.population[baseYear];
    return vehicles && people ? vehicles / people : 0;
  };
  const weight = (code, year) => {
    const vehicles = carsByCode.get(code)?.[year];
    if (vehicles == null) return (byCode.get(code)?.population[year] ?? 0) * carsPerPerson(code);
    const countyAverage = distance?.countyKmPerCar[year]?.kmPerCar[code.slice(0, 2)];
    return countyAverage ? vehicles * countyAverage : vehicles;
  };
  const totalWeight = {};
  for (const year of population.years.map(String)) {
    totalWeight[year] = population.data.reduce((sum, m) => sum + weight(m.code, year), 0);
  }

  // Sweden's passenger-car distance from Trafikanalys starts in 1990; earlier
  // years are Sweden's passenger cars times the vehicle-km per car of the
  // first year with a figure, as in the national table.
  const swedenCarKm = Object.fromEntries(
    Object.entries(distance?.swedenCarKmMillions ?? {}).map(([year, millions]) => [year, millions * 1e6]),
  );
  const firstKmYear = Object.keys(swedenCarKm).sort()[0];
  const nationalCars = new Map((swedenCars?.data ?? []).map((row) => [String(row.year), row.cars]));
  const kmPerCar = firstKmYear && nationalCars.get(firstKmYear) ? swedenCarKm[firstKmYear] / nationalCars.get(firstKmYear) : null;
  for (const [year, count] of nationalCars) {
    if (!(year in swedenCarKm) && kmPerCar && year < firstKmYear) swedenCarKm[year] = count * kmPerCar;
  }

  // Before SCB's municipal car counts, cars in traffic are estimated the same
  // way: Sweden's passenger cars shared out by the same weights.
  function estimatedCars(code, year) {
    if (!baseYear || String(year) >= baseYear) return null;
    const swedenCount = nationalCars.get(String(year));
    const share = weight(code, String(year));
    return swedenCount && share && totalWeight[year] ? Math.round((swedenCount * share) / totalWeight[year]) : null;
  }

  function estimatedKm(code, year) {
    const swedenKm = swedenCarKm[year];
    const share = weight(code, String(year));
    return swedenKm && share && totalWeight[year] ? (swedenKm * share) / totalWeight[year] : null;
  }
  const countyYears = Object.keys(distance?.countyKmPerCar ?? {});

  source.textContent =
    (distance
      ? "* Estimate: Trafikanalys doesn't publish distance driven per municipality, so " +
        (countyYears.length
          ? `Sweden's passenger-car distance is shared out by the municipality's passenger cars, weighted for ${countyYears.join(", ")} ` +
            "by its county's average distance per car and for other years unweighted. "
          : "Sweden's passenger-car distance is shared out by the municipality's share of Sweden's cars. "
        ) +
        (baseYear
          ? `Before ${baseYear}, when SCB has no municipal car counts, the share is the municipality's population ` +
            `times its cars per inhabitant in ${baseYear}` +
            (firstKmYear ? `, and before ${firstKmYear} Sweden's passenger-car distance is itself estimated from the number of cars. ` : ". ") +
            `Cars in traffic before ${baseYear} are estimated the same way, by sharing out Sweden's passenger cars. `
          : "")
      : "") +
    "A dash means there is no figure: some municipalities were formed after 1975. " +
    "Cars in traffic at the end of the year; population on 31 December. " +
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
    caption.textContent = `${municipality.name}, ${municipality.county ?? "Sweden"}: passenger cars, population and distance driven, five-year intervals`;
    body.replaceChildren(...population.years.map((year) => {
      const people = municipality.population[year];
      const counted = carCounts[year];
      const carsEstimated = counted == null;
      const vehicles = counted ?? estimatedCars(code, year);
      const perThousand = people && vehicles != null ? Math.round((vehicles / people) * 1000) : null;
      const km = estimatedKm(code, year);
      const kmPerPerson = km && people ? Math.round(km / people) : null;
      const tr = document.createElement("tr");
      const yearCell = document.createElement("th");
      yearCell.scope = "row";
      yearCell.textContent = year;
      tr.append(yearCell);
      // Distance driven, and cars before SCB's counts, are estimated; those
      // cells get an asterisk.
      const cells = [
        { value: vehicles, estimate: carsEstimated },
        { value: people },
        { value: perThousand, estimate: carsEstimated },
        { value: km == null ? null : oneDecimal.format(km / 1e6), estimate: true },
        { value: kmPerPerson, estimate: true },
      ];
      for (const { value, estimate } of cells) {
        const cell = document.createElement("td");
        cell.className = value == null ? "number missing" : "number";
        if (value == null) {
          cell.textContent = "–";
        } else {
          cell.textContent = typeof value === "string" ? value : number.format(value);
          if (estimate) {
            const mark = document.createElement("abbr");
            mark.title = "Estimate";
            mark.textContent = "*";
            cell.append(mark);
          }
        }
        tr.append(cell);
      }
      return tr;
    }));
    boldHighest(body);
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
