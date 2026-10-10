// Draws the passenger car charts and table from data/cars.json and
// data/population.json (both fetched from SCB by the scripts in scripts/).

const SVG_NS = "http://www.w3.org/2000/svg";
const number = new Intl.NumberFormat("en-GB");

function svg(name, attributes = {}, parent) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (parent) parent.append(element);
  return element;
}

// Round tick step: 1, 2 or 5 times a power of ten.
function niceStep(max, count) {
  const raw = max / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * power).find((step) => step >= raw);
}

// Column with a 4px rounded top and a square base.
function columnPath(x, y, width, height) {
  const r = Math.min(4, width / 2, height);
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}` +
    `H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}

const tooltip = document.getElementById("tooltip");

function showTooltip(target, html) {
  tooltip.innerHTML = html;
  tooltip.hidden = false;
  const box = target.getBoundingClientRect();
  const tip = tooltip.getBoundingClientRect();
  const left = Math.min(Math.max(8, box.left + box.width / 2 - tip.width / 2), innerWidth - tip.width - 8);
  const top = box.top - tip.height - 8 < 8 ? box.bottom + 8 : box.top - tip.height - 8;
  tooltip.style.left = `${left + scrollX}px`;
  tooltip.style.top = `${top + scrollY}px`;
}

function hideTooltip() {
  tooltip.hidden = true;
}

// Column chart of rows [{year, value}]; format() writes axis ticks and labels.
function columnChart(container, rows, { format, tickFormat, tooltipHtml, label }) {
  container.replaceChildren();
  const width = Math.max(container.clientWidth, 280);
  const height = 260;
  const margin = { top: 24, right: 8, bottom: 28, left: 48 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const max = Math.max(...rows.map((row) => row.value));
  const step = niceStep(max, 4);
  const top = Math.ceil(max / step) * step;
  const y = (value) => margin.top + plotHeight - (value / top) * plotHeight;
  const slot = plotWidth / rows.length;
  const barWidth = Math.min(24, slot - 6);

  const chart = svg("svg", { viewBox: `0 0 ${width} ${height}`, width, height, role: "img", "aria-label": label }, container);

  for (let tick = 0; tick <= top; tick += step) {
    svg("line", { class: "grid", x1: margin.left, x2: width - margin.right, y1: y(tick), y2: y(tick) }, chart);
    svg("text", { class: "tick", x: margin.left - 8, y: y(tick), "text-anchor": "end", "dominant-baseline": "middle" }, chart)
      .textContent = tickFormat(tick);
  }

  rows.forEach((row, i) => {
    const center = margin.left + slot * i + slot / 2;
    const barTop = y(row.value);
    const group = svg("g", { class: "column", tabindex: 0, "aria-label": `${row.year}: ${format(row.value)}` }, chart);
    // Invisible hit area covering the whole slot, bigger than the column.
    svg("rect", { class: "hit", x: center - slot / 2, y: margin.top, width: slot, height: plotHeight }, group);
    svg("path", { class: "bar", d: columnPath(center - barWidth / 2, barTop, barWidth, y(0) - barTop) }, group);

    // Label only the first and last column; the tooltip and table carry the rest.
    if (i === 0 || i === rows.length - 1) {
      svg("text", { class: "value", x: center, y: barTop - 6, "text-anchor": "middle" }, group).textContent = format(row.value);
    }
    if (slot >= 34 || i % 2 === 0) {
      svg("text", { class: "tick", x: center, y: height - 8, "text-anchor": "middle" }, chart).textContent = row.year;
    }

    const show = () => { group.classList.add("active"); showTooltip(group.querySelector(".bar"), tooltipHtml(row)); };
    const hide = () => { group.classList.remove("active"); hideTooltip(); };
    group.addEventListener("pointerenter", show);
    group.addEventListener("pointerleave", hide);
    group.addEventListener("focus", show);
    group.addEventListener("blur", hide);
  });

  svg("line", { class: "axis", x1: margin.left, x2: width - margin.right, y1: y(0), y2: y(0) }, chart);
}

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

  const tooltipHtml = (row) =>
    `<strong>${row.year}</strong><br>${number.format(row.cars)} cars` +
    (row.perThousand ? `<br>${Math.round(row.perThousand)} per 1,000 inhabitants` : "");

  const draw = () => {
    columnChart(document.getElementById("cars-chart"), rows.map((row) => ({ ...row, value: row.cars })), {
      label: `Column chart of passenger cars in traffic in Sweden, ${first.year} to ${last.year}`,
      format: (value) => millions(value, 2),
      tickFormat: (value) => (value === 0 ? "0" : millions(value, value % 1e6 ? 1 : 0)),
      tooltipHtml,
    });
    const density = rows.filter((row) => row.perThousand !== null);
    columnChart(document.getElementById("density-chart"), density.map((row) => ({ ...row, value: row.perThousand })), {
      label: `Column chart of passenger cars per 1,000 inhabitants in Sweden, ${first.year} to ${last.year}`,
      format: (value) => String(Math.round(value)),
      tickFormat: (value) => String(value),
      tooltipHtml,
    });
  };
  draw();
  let resizeTimer;
  addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(draw, 100); });

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
