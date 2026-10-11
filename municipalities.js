// Shows one municipality's passenger cars, population and distance driven,
// picked from an alphabetical list, in a table like the national one.
// Reads the data files fetched by the scripts in scripts/: SCB's population and
// cars, RUS's cars per 1,000 inhabitants for earlier years, Trafikanalys's
// distance (per municipality via Kolada where published) and the inputs for
// estimating the rest. The choice is kept in the address (#0180 for
// Stockholm) so a link opens the same municipality.
const SWEDEN = "sweden";

// The region each municipality belongs to, by the first two digits of its
// code (the county code). Names as Kolada (SKR's and the government's
// database) lists the regions, except Kalmar, which calls itself "Region
// Kalmar län" where Kolada has "Region Kalmar". On Gotland the municipality
// itself is the region.
const GOTLAND = "0980";

// Municipalities split off another after 1974, by code: the municipality
// they were part of and the first year on their own (SCB's list of
// municipal changes). SCB gives their population for the earlier years too,
// but RUS counts their cars in the other municipality, against that
// municipality's population alone.
const SPLITS = {
  "0117": ["0187", 1983], // Österåker from Vaxholm
  "0128": ["0127", 1983], // Salem from Botkyrka
  "0584": ["0583", 1980], // Vadstena from Motala
  "1445": ["1470", 1983], // Essunga from Vara
  "2403": ["2460", 1983], // Bjurholm from Vännäs
  "2418": ["2417", 1983], // Malå from Norsjö
  "2425": ["2463", 1980], // Dorotea from Åsele
};

// A note under the table for municipalities where company cars, counted
// where the company is registered, inflate the figures. Shares are from
// RUS table 1 ("därav företagsbilar"), which has them for 1990-2012.
const COMPANY_CARS = {
  "0180": "Bilar räknas i den kommun där ägaren är registrerad, och många företag har sitt huvudkontor i " +
    "Stockholm. Omkring 4 av 10 personbilar var företagsbilar (39 % år 2000, riket 19 %), så bilar per 1\u00a0000 " +
    "invånare och mil per invånare är högre än vad invånarna själva äger och kör.",
  "0182": "Bilar räknas i den kommun där ägaren är registrerad, och i Nacka är många bilar registrerade på " +
    "företag: 42 % av personbilarna år 2012 (riket 22 %). Bilar per 1\u00a0000 invånare och mil per invånare är " +
    "därför högre än vad invånarna själva äger och kör.",
  "0184": "Bilar räknas i den kommun där ägaren är registrerad, och många företag har sitt huvudkontor i Solna. " +
    "År 2010 var 65 % av personbilarna företagsbilar (riket 20 %). Utan dem hade Solna haft omkring 240 bilar " +
    "per 1\u00a0000 invånare i stället för 670, och mil per invånare är på samma sätt kraftigt uppblåst.",
  "1281": "Bilar räknas i den kommun där ägaren är registrerad, och i Lund var många bilar registrerade på " +
    "företag: 40 % av personbilarna år 2012 (riket 22 %). Under 2024 bytte ett stort antal företagsbilar " +
    "registreringsort från Lund (enligt RUS till Täby), så antalet bilar föll från 65 323 år 2020 till 46 153 " +
    "år 2025. Siffrorna före 2025 är därför högre än vad invånarna själva äger och kör.",
  "1402": "Bilar räknas i den kommun där ägaren är registrerad. Runt år 2000 var många bilar i Partille " +
    "registrerade på företag (35 % år 2000, riket 19 %), vilket höjer bilar per 1\u00a0000 invånare och mil per " +
    "invånare för de åren.",
};
const REGIONS = {
  "01": "Region Stockholm",
  "03": "Region Uppsala",
  "04": "Region Sörmland",
  "05": "Region Östergötland",
  "06": "Region Jönköpings län",
  "07": "Region Kronoberg",
  "08": "Region Kalmar län",
  "09": "Region Gotland",
  "10": "Region Blekinge",
  "12": "Region Skåne",
  "13": "Region Halland",
  "14": "Västra Götalandsregionen",
  "17": "Region Värmland",
  "18": "Region Örebro län",
  "19": "Region Västmanland",
  "20": "Region Dalarna",
  "21": "Region Gävleborg",
  "22": "Region Västernorrland",
  "23": "Region Jämtland Härjedalen",
  "24": "Region Västerbotten",
  "25": "Region Norrbotten",
};

async function loadMunicipalities() {
  const select = document.getElementById("municipality-select");
  const swedenSection = document.getElementById("sweden-section");
  const municipalitySection = document.getElementById("municipality-section");
  const heading = document.getElementById("municipalities-heading");
  const companyNote = document.getElementById("company-note");
  const search = document.getElementById("municipality-search");
  const names = document.getElementById("municipality-names");
  const body = document.querySelector("#municipality-table tbody");
  const source = document.getElementById("municipality-source");
  const number = new Intl.NumberFormat("sv-SE");

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
    source.textContent = `Kunde inte läsa in kommundata (${error.message}).`;
    source.closest("details")?.setAttribute("open", "");
    return;
  }
  const byCode = new Map(population.data.map((m) => [m.code, m]));
  const carsByCode = new Map((cars?.data ?? []).map((m) => [m.code, m.cars]));
  const ratesByCode = new Map((ownership?.data ?? []).map((m) => [m.code, { ...m.carsPerThousand }]));
  // Trafikanalys's own per-municipality figures (via Kolada) where published;
  // other years are estimated below.
  const officialKm = new Map((official?.data ?? []).map((m) => [m.code, m.kmPerInhabitant]));
  const officialYears = (official?.years ?? []).map(String);
  const oneDecimal = new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  // SCB counts cars per municipality from 2002 (baseYear is the first table
  // year with counts). Before that, RUS has SCB's cars per 1,000 inhabitants
  // for some years, which times the population gives the cars.
  const carYears = [...new Set([...carsByCode.values()].flatMap((counts) => Object.keys(counts)))].sort();
  const baseYear = carYears.find((year) => [...carsByCode.values()].some((counts) => counts[year]));
  // Where a municipality was part of another (SPLITS), RUS's rate is both
  // municipalities' cars over the larger one's population. Both get the
  // combined rate instead, from SCB's population for the nearest table year,
  // and their cars for that year count as estimates.
  const nearestPeople = (code, year) => {
    const nearest = population.years.reduce((a, b) => (Math.abs(b - year) < Math.abs(a - year) ? b : a));
    return byCode.get(code)?.population[String(nearest)];
  };
  const pooled = new Set();
  for (const [child, [parent, separate]] of Object.entries(SPLITS)) {
    const rates = ratesByCode.get(parent) ?? {};
    for (const [year, rate] of Object.entries(rates)) {
      const together = nearestPeople(parent, Number(year));
      const apart = nearestPeople(child, Number(year));
      if (Number(year) >= separate || rate == null || ratesByCode.get(child)?.[year] != null || !together || !apart) continue;
      const combined = (rate * together) / (together + apart);
      rates[year] = combined;
      (ratesByCode.get(child) ?? ratesByCode.set(child, {}).get(child))[year] = combined;
      pooled.add(`${parent}:${year}`).add(`${child}:${year}`);
    }
  }
  const ownershipCars = (code, year) => {
    const rate = String(year) < baseYear && !pooled.has(`${code}:${year}`) ? ratesByCode.get(code)?.[year] : null;
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
  const list = joinSwedish;

  // Sweden's averages to compare each municipality with: cars per inhabitant
  // and passenger-car km per inhabitant (the national distance the estimates
  // share out, so it matches the municipal figures' scope).
  const swedenPeople = (year) => population.sweden?.[year];
  const swedenCarsPerPerson = (year) => (nationalCars.get(String(year)) ?? 0) / (swedenPeople(year) || Infinity);
  const swedenKmPerPerson = (year) => (swedenCarKm[year] ?? 0) / (swedenPeople(year) || Infinity);
  const percent = new Intl.NumberFormat("sv-SE", { style: "percent", signDisplay: "exceptZero" });
  // "+12 %" or "−8 %" from a municipality's figure and Sweden's.
  const versus = (value, average) => (value != null && average ? percent.format(value / average - 1).replace("-", "−") : null);

  source.textContent =
    (baseYear
      ? "Personbilar i trafik är SCB:s antal från " + baseYear +
        (ownershipYears.length
          ? ` och för ${list(ownershipYears)} RUS:s uppgift om bilar per 1 000 invånare (från SCB) gånger folkmängden`
          : "") +
        ". * Uppskattning: för övriga år fördelas Sveriges personbilar efter varje kommuns folkmängd gånger " +
        "dess bilar per invånare, interpolerat mellan de närmaste åren med uppgifter. "
      : "") +
    (distance
      ? (officialYears.length
          ? `Körsträckan med personbil för ${list(officialYears)} är Trafikanalys siffra per kommun ` +
            "(publicerad via Kolada): bilar registrerade i kommunen, oavsett var de körts, där företagsbilar räknas " +
            "till den kommun där företaget är registrerat. "
          : "") +
        `* Uppskattning: ${officialYears.length ? "för övriga år" : "Trafikanalys redovisar inte körsträcka per kommun, så"} ` +
        "fördelas Sveriges körsträcka med personbil efter kommunens personbilar" +
        (countyYears.length ? `, för ${list(countyYears)} viktade med länets genomsnittliga körsträcka per bil` : "") +
        ". " +
        (scaledYears.length
          ? `Före ${firstKmYear} är Sveriges körsträcka med personbil ${firstKmYear} års siffra skalad med SIKA:s historiska serie. `
          : "")
      : "") +
    "Kolumnerna ”jämfört med riket” jämför kommunen med hela Sverige: bilar per invånare med Sveriges " +
    "personbilar per invånare, och körsträcka per invånare med Sveriges körsträcka med personbil per invånare; " +
    "+12 % betyder 12 % över rikets genomsnitt. Sträckor anges i mil (1 mil = 10 km). " +
    "För år då en kommun ingick i en annan (till exempel Österåker i Vaxholm 1974–1982) delas båda " +
    "kommunernas bilar efter folkmängd, och de åren räknas som uppskattningar. " +
    "Ett streck betyder att uppgift saknas: vissa kommuner bildades efter 1975. " +
    "Personbilar i trafik vid årets slut, folkmängd den 31 december. " +
    (cars ? `Källor: ${cars.source} (hämtad ${cars.retrieved}); ` : "Källor: ") +
    (ownershipYears.length ? `${ownership.source} (hämtad ${ownership.retrieved}); ` : "") +
    (distance ? `${distance.source} (hämtad ${distance.retrieved}); ` : "") +
    (scaledYears.length ? `${historical.source}; ` : "") +
    (officialYears.length ? `${official.source} (hämtad ${official.retrieved}); ` : "") +
    `${population.source} (hämtad ${population.retrieved}).`;

  // All municipalities in Swedish alphabetical order, after "Hela Sverige".
  const byName = (a, b) => a.localeCompare(b, "sv");
  const alphabetical = [...population.data].sort((a, b) => byName(a.name, b.name));
  select.append(...alphabetical.map((m) => new Option(m.name, m.code)));
  const regionOf = (m) => REGIONS[m.code.slice(0, 2)] ?? "";

  // "sweden" shows the national table (filled in by cars.js); a
  // municipality code shows that municipality's table instead.
  function show(code) {
    select.value = code;
    swedenSection.hidden = code !== SWEDEN;
    municipalitySection.hidden = code === SWEDEN;
    if (code === SWEDEN) return;
    const municipality = byCode.get(code);
    const carCounts = carsByCode.get(code) ?? {};
    companyNote.hidden = !COMPANY_CARS[code];
    document.getElementById("company-note-text").textContent =
      COMPANY_CARS[code] ? `${COMPANY_CARS[code]} Källa: RUS tabell 1 (därav företagsbilar).` : "";
    const region = regionOf(municipality);
    // On Gotland the municipality is Region Gotland, so the region isn't repeated.
    const place = region && code !== GOTLAND ? `${municipality.name}, ${region}` : municipality.name;
    // The word joiners (\u2060) keep the year range on one line.
    heading.textContent = `Bilar, befolkning och körsträcka i ${place}, 1975\u2060–\u20602025`;
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
            mark.title = "Uppskattning";
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
  // Sweden can be searched for too, in Swedish or English.
  const sweden = { code: SWEDEN, name: "Hela Sverige" };
  const listed = [sweden, ...alphabetical];
  const byPlainName = [
    ...listed.map((m) => [plain(m.name), m]),
    ...["Sverige", "Riket", "Sweden"].map((name) => [plain(name), sweden]),
  ];
  names.replaceChildren(...listed.map((m) => {
    const option = new Option(m.name);
    option.label = m === sweden ? "" : regionOf(m);
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
