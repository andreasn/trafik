// Fills the population column from data/population.json.
async function loadPopulation() {
  const source = document.getElementById("population-source");

  try {
    const response = await fetch("data/population.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { data, source: name, retrieved } = await response.json();

    for (const { year, population } of data) {
      const cell = document.querySelector(`td[data-year="${year}"]`);
      if (cell) cell.textContent = population.toLocaleString("en");
    }
    source.textContent = `Population on 31 December. Source: ${name}, retrieved ${retrieved}.`;
  } catch (error) {
    source.textContent = `Could not load population data (${error.message}).`;
  }
}

loadPopulation();
