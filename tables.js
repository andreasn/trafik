// Shared table helpers for cars.js and municipalities.js, and the checkboxes
// that show or hide the optional columns.

// Bolds the highest number in each column of a table body, comparing the
// numbers as displayed (thousands separators, % signs and the * on
// estimates are ignored), so values that look equal are all bolded. The first column is
// the year and is skipped.
function boldHighest(body) {
  const rows = [...body.rows];
  const columns = rows[0]?.cells.length ?? 0;
  for (let column = 1; column < columns; column++) {
    const cells = rows.map((row) => row.cells[column]);
    const values = cells.map((cell) => Number.parseFloat(cell.textContent.replace(/[,*%\s]/g, "").replace("−", "-")));
    const highest = Math.max(...values.filter(Number.isFinite));
    cells.forEach((cell, i) => cell.classList.toggle("highest", values[i] === highest));
  }
}

// Fills each "Show columns" fieldset with a checkbox per heading marked
// data-toggle in its table, labelled with the heading. Headings with the same
// data-toggle text share one checkbox labelled with that text. The columns
// start hidden; a checkbox toggles a hide-N class on the table (N is the
// column's position), which style.css uses to hide that column's cells.
function columnToggles() {
  for (const fieldset of document.querySelectorAll("fieldset.column-toggles")) {
    const table = document.getElementById(fieldset.dataset.table);
    const headings = [...table.tHead.rows[0].cells];
    const groups = new Map();
    for (const heading of headings.filter((cell) => cell.hasAttribute("data-toggle"))) {
      const name = heading.dataset.toggle || heading.textContent;
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(`hide-${headings.indexOf(heading) + 1}`);
    }
    // Single columns first, then the shared checkboxes.
    const ordered = [...groups].sort(([, a], [, b]) => (a.length > 1) - (b.length > 1));
    for (const [name, classes] of ordered) {
      const label = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.addEventListener("change", () => classes.forEach((hide) => table.classList.toggle(hide, !box.checked)));
      table.classList.add(...classes);
      label.append(box, ` ${name}`);
      fieldset.append(label);
    }
  }
}

columnToggles();
