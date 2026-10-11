// Shows one municipality's passenger cars, population and distance driven,
// picked from a list grouped by county, in a table like the national one.
// Reads the data files fetched by the scripts in scripts/: SCB's population and
// cars, RUS's cars per 1,000 inhabitants for earlier years, Trafikanalys's
// distance (per municipality via Kolada where published) and the inputs for
// estimating the rest. The choice is kept in the address (#0180 for
// Stockholm) so a link opens the same municipality.
const SWEDEN = "sweden";

async function loadMunicipalities() {
  const select = document.getElementById("municipality-select");
  const swedenSection = document.getElementById("sweden-section");
  const municipalitySection = document.getElementById("municipality-section");
  const heading = document.getElementById("municipalities-heading");
  const search = document.getElementById("municipality-search");
  const names = document.getElementById("municipality-names");
  const body = document.querySelector("#municipality-table tbody");
  const source = document.getElementById("municipality-source");
  const number = new Intl.NumberFormat("en-GB");

  const load = (url) => fetch(url).then((response) => {
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.json();
  });
  let population;
  let cars;
  let ownership;
  let distance;
  let swedenCars;
  let historical;
  let official;
  try {
    // The page still works without the car and distance figures.
    [population, cars, ownership, distance, swedenCars, historical, official] = await Promise.all([
      load("data/municipalities.json"),
      load("data/municipal_cars.json").catch(() => null),
      load("data/car_ownership.json").catch(() => null),
      load("data/car_distance.json").catch(() => null),
      load("data/cars.json").catch(() => null),
      load("data/historical_traffic.json").catch(() => null),
      load("data/municipal_distance.json").catch(() => null),
    ]);
  } catch (error) {
    source.textContent = `Could not load municipality data (${error.message}).`;
    source.closest("details")?.setAttribute("open", "");
    return;
  }
  const byCode = new Map(population.data.map((m) => [m.code, m]));
  const carsByCode = new Map((cars?.data ?? []).map((m) => [m.code, m.cars]));
  const ratesByCode = new Map((ownership?.data ?? []).map((m) => [m.code, m.carsPerThousand]));
  // Trafikanalys's own per-municipality figures (via Kolada) where published;
  // other years are estimated below.
  const officialKm = new Map((official?.data ?? []).map((m) => [m.code, m.kmPerInhabitant]));
  const officialYears = (official?.years ?? []).map(String);
  const oneDecimal = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  // SCB counts cars per municipality from 2002 (baseYear is the first table
  // year with counts). Before that, RUS has SCB's cars per 1,000 inhabitants
  // for some years, which times the population gives the cars.
  const carYears = [...new Set([...carsByCode.values()].flatMap((counts) => Object.keys(counts)))].sort();
  const baseYear = carYears.find((year) => [...carsByCode.values()].some((counts) => counts[year]));
  const ownershipCars = (code, year) => {
    const rate = String(year) < baseYear ? ratesByCode.get(code)?.[year] : null;
    const people = byCode.get(code)?.population[year];
    return rate != null && people ? Math.round((rate * people) / 1000) : null;
  };
  const ownershipYears = population.years.map(String).filter((year) => population.data.some((m) => ownershipCars(m.code, year) != null));

  // Cars per inhabitant in the years with figures, from RUS and SCB, and for
  // other years interpolated between the nearest ones (or the nearest one).
  const knownRates = new Map(population.data.map((m) => {
    const known = [];
    for (const year of new Set([...Object.keys(ratesByCode.get(m.code) ?? {}), ...carYears])) {
      const people = m.population[year];
      const counted = carsByCode.get(m.code)?.[year];
      const perThousand = ratesByCode.get(m.code)?.[year];
      const rate = counted != null ? people && counted / people : perThousand != null && perThousand / 1000;
      if (rate) known.push([Number(year), rate]);
    }
    return [m.code, known.sort((x, y) => x[0] - y[0])];
  }));
  const carsPerPerson = (code, year) => {
    const known = knownRates.get(code) ?? [];
    const after = known.findIndex(([y]) => y >= Number(year));
    if (after === -1) return known.at(-1)?.[1] ?? 0;
    const [y1, r1] = known[after];
    if (y1 === Number(year) || after === 0) return r1;
    const [y0, r0] = known[after - 1];
    return r0 + ((r1 - r0) * (Number(year) - y0)) / (y1 - y0);
  };

  // Trafikanalys doesn't publish distance driven per municipality for every
  // year, so it is estimated by sharing out Sweden's passenger-car distance;
  // the estimates add up to Sweden's total. A municipality's share is:
  // - its passenger cars, weighted by its county's average distance per car
  //   where the Körsträckor report has one;
  // - otherwise its passenger cars;
  // - before SCB's municipal car counts, its population times its cars per
  //   inhabitant from RUS, interpolated for years RUS doesn't have.
  const weight = (code, year) => {
    const vehicles = carsByCode.get(code)?.[year];
    if (vehicles == null) return (byCode.get(code)?.population[year] ?? 0) * carsPerPerson(code, year);
    const countyAverage = distance?.countyKmPerCar[year]?.kmPerCar[code.slice(0, 2)];
    return countyAverage ? vehicles * countyAverage : vehicles;
  };
  const totalWeight = {};
  for (const year of population.years.map(String)) {
    totalWeight[year] = population.data.reduce((sum, m) => sum + weight(m.code, year), 0);
  }

  // Sweden's passenger-car distance from Trafikanalys starts in 1990. Earlier
  // years scale the first year by SIKA's historical passenger-car km.
  const swedenCarKm = Object.fromEntries(
    Object.entries(distance?.swedenCarKmMillions ?? {}).map(([year, millions]) => [year, millions * 1e6]),
  );
  const firstKmYear = Object.keys(swedenCarKm).sort()[0];
  const historicalCarKm = new Map((historical?.data ?? []).map((row) => [String(row.year), row.passengerCarKmMillions]));
  for (const [year, millions] of historicalCarKm) {
    if (firstKmYear && year < firstKmYear && historicalCarKm.get(firstKmYear)) {
      swedenCarKm[year] = swedenCarKm[firstKmYear] * (millions / historicalCarKm.get(firstKmYear));
    }
  }
  const scaledYears = Object.keys(swedenCarKm).filter((year) => year < firstKmYear);
  const nationalCars = new Map((swedenCars?.data ?? []).map((row) => [String(row.year), row.cars]));

  // For years without figures, cars in traffic are estimated the same way:
  // Sweden's passenger cars shared out by the same weights.
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
  // Years where the county weighting is used, i.e. not replaced by official figures.
  const countyYears = Object.keys(distance?.countyKmPerCar ?? {}).filter((year) => !officialYears.includes(year)).sort();
  const list = (years) => years.join(", ");

  // Sweden's averages to compare each municipality with: cars per inhabitant
  // and passenger-car km per inhabitant (the national distance the estimates
  // share out, so it matches the municipal figures' scope).
  const swedenPeople = (year) => population.sweden?.[year];
  const swedenCarsPerPerson = (year) => (nationalCars.get(String(year)) ?? 0) / (swedenPeople(year) || Infinity);
  const swedenKmPerPerson = (year) => (swedenCarKm[year] ?? 0) / (swedenPeople(year) || Infinity);
  const percent = new Intl.NumberFormat("en-GB", { style: "percent", signDisplay: "exceptZero" });
  // "+12%" or "−8%" from a municipality's figure and Sweden's.
  const versus = (value, average) => (value != null && average ? percent.format(value / average - 1).replace("-", "−") : null);

  source.textContent =
    (baseYear
      ? "Cars in traffic are SCB's count from " + baseYear +
        (ownershipYears.length
          ? ` and for ${list(ownershipYears)} RUS's figure of cars per 1,000 inhabitants (from SCB) times the population`
          : "") +
        ". * Estimate: for other years, Sweden's passenger cars are shared out by each municipality's population " +
        "times its cars per inhabitant, interpolated between the nearest years with figures. "
      : "") +
    (distance
      ? (officialYears.length
          ? `Distance driven by passenger cars for ${list(officialYears)} is Trafikanalys's figure per municipality ` +
            "(published through Kolada): cars registered in the municipality, wherever they were driven, with company " +
            "cars counted where the company is registered. "
          : "") +
        `* Estimate: ${officialYears.length ? "for other years" : "Trafikanalys doesn't publish distance driven per municipality, so"} ` +
        "Sweden's passenger-car distance is shared out by the municipality's passenger cars" +
        (countyYears.length ? `, weighted for ${list(countyYears)} by its county's average distance per car` : "") +
        ". " +
        (scaledYears.length
          ? `Before ${firstKmYear}, Sweden's passenger-car distance is ${firstKmYear}'s figure scaled by SIKA's historical series. `
          : "")
      : "") +
    "The “vs Sweden” columns compare the municipality with Sweden as a whole: cars per inhabitant with " +
    "Sweden's passenger cars per inhabitant, and distance per inhabitant with Sweden's passenger-car distance per " +
    "inhabitant; +12% means 12% above Sweden's average. Distances are in Swedish mil (1 mil = 10 km). " +
    "A dash means there is no figure: some municipalities were formed after 1975. " +
    "Cars in traffic at the end of the year; population on 31 December. " +
    (cars ? `Source: ${cars.source} (retrieved ${cars.retrieved}); ` : "Source: ") +
    (ownershipYears.length ? `${ownership.source} (retrieved ${ownership.retrieved}); ` : "") +
    (distance ? `${distance.source} (retrieved ${distance.retrieved}); ` : "") +
    (scaledYears.length ? `${historical.source}; ` : "") +
    (officialYears.length ? `${official.source} (retrieved ${official.retrieved}); ` : "") +
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

  // "sweden" shows the national table (filled in by cars.js); a
  // municipality code shows that municipality's table instead.
  function show(code) {
    select.value = code;
    swedenSection.hidden = code !== SWEDEN;
    municipalitySection.hidden = code === SWEDEN;
    if (code === SWEDEN) return;
    const municipality = byCode.get(code);
    const carCounts = carsByCode.get(code) ?? {};
    const place = municipality.county ? `${municipality.name}, ${municipality.county}` : municipality.name;
    // The word joiners (\u2060) keep the year range on one line.
    heading.textContent = `Cars, population and distance driven in ${place}, 1975\u2060–\u20602025`;
    body.replaceChildren(...population.years.map((year) => {
      const people = municipality.population[year];
      const counted = carCounts[year] ?? ownershipCars(code, year);
      const carsEstimated = counted == null;
      const vehicles = counted ?? estimatedCars(code, year);
      const perThousand = people && vehicles != null ? Math.round((vehicles / people) * 1000) : null;
      const kmPerInhabitant = officialKm.get(code)?.[year];
      const kmOfficial = kmPerInhabitant != null && people != null;
      const km = kmOfficial ? kmPerInhabitant * people : estimatedKm(code, year);
      // In Swedish mil (10 km), as Trafikanalys and Kolada publish averages.
      const milPerPerson = kmOfficial ? Math.round(kmPerInhabitant / 10) : km && people ? Math.round(km / people / 10) : null;
      const tr = document.createElement("tr");
      const yearCell = document.createElement("th");
      yearCell.scope = "row";
      yearCell.textContent = year;
      tr.append(yearCell);
      // Estimated cars and distance get an asterisk.
      const cells = [
        { value: vehicles, estimate: carsEstimated },
        { value: people },
        { value: perThousand, estimate: carsEstimated },
        { value: versus(people && vehicles != null ? vehicles / people : null, swedenCarsPerPerson(year)), estimate: carsEstimated },
        { value: km == null ? null : oneDecimal.format(km / 1e7), estimate: !kmOfficial },
        { value: milPerPerson, estimate: !kmOfficial },
        { value: versus(km != null && people ? km / people : null, swedenKmPerPerson(year)), estimate: !kmOfficial },
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

  // The address keeps a municipality's code (#0180); Sweden has none.
  const fromHash = () => (byCode.has(location.hash.slice(1)) ? location.hash.slice(1) : SWEDEN);
  const choose = (code) => {
    history.replaceState(null, "", code === SWEDEN ? location.pathname + location.search : `#${code}`);
    show(code);
  };
  select.addEventListener("change", () => choose(select.value));

  // The search box suggests names as you type (the browser filters the
  // list). Picking a suggestion, or pressing Enter, shows the best match;
  // accents and case are ignored, so "malmo" finds Malmö.
  const plain = (text) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
  // Sweden can be searched for too, in English or Swedish.
  const sweden = { code: SWEDEN, name: "Sweden (whole country)", county: "" };
  const listed = [sweden, ...[...population.data].sort((a, b) => byName(a.name, b.name))];
  const byPlainName = [
    ...listed.map((m) => [plain(m.name), m]),
    ...["Sweden", "Sverige"].map((name) => [plain(name), sweden]),
  ];
  names.replaceChildren(...listed.map((m) => {
    const option = new Option(m.name);
    option.label = m.county ?? "";
    return option;
  }));
  const find = (text, exact) => {
    const query = plain(text);
    if (!query) return null;
    const hit = byPlainName.find(([name]) => name === query) ??
      (exact ? undefined : byPlainName.find(([name]) => name.startsWith(query)) ?? byPlainName.find(([name]) => name.includes(query)));
    return hit?.[1] ?? null;
  };
  const pick = (m) => {
    choose(m.code);
    search.value = "";
    search.blur();
  };
  search.addEventListener("input", (event) => {
    // Only a picked suggestion, not typing: "Mark" is also the start of "Markaryd".
    if (event instanceof InputEvent && event.inputType !== "insertReplacementText") return;
    const m = find(search.value, true);
    if (m) pick(m);
  });
  search.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const m = find(search.value, false);
    if (m) pick(m);
  });
  addEventListener("hashchange", () => show(fromHash()));
  show(fromHash());
}

loadMunicipalities();
