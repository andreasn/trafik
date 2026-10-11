// Shared table helpers for cars.js and municipalities.js.

// Bolds the highest number in each column of a table body, comparing the
// numbers as displayed (thousands separators and the * on estimates are
// ignored), so values that look equal are all bolded. The first column is
// the year and is skipped.
function boldHighest(body) {
  const rows = [...body.rows];
  const columns = rows[0]?.cells.length ?? 0;
  for (let column = 1; column < columns; column++) {
    const cells = rows.map((row) => row.cells[column]);
    const values = cells.map((cell) => Number.parseFloat(cell.textContent.replace(/[,*\s]/g, "")));
    const highest = Math.max(...values.filter(Number.isFinite));
    cells.forEach((cell, i) => cell.classList.toggle("highest", values[i] === highest));
  }
}
