import { calculateProjectForecast } from "./portfolio-analytics.js";
import { formatCurrency } from "./formatters.js";
import { validateScenarioValues } from "./scenario-analysis.js";

const ASSUMPTIONS = [
  { key: "budgetBAC", name: "Approved Budget", label: "Approved Budget (BAC)", abbreviation: "BAC" },
  { key: "earnedValueEV", name: "Earned Value", label: "Earned Value (EV)", abbreviation: "EV" },
  { key: "actualCostAC", name: "Actual Cost", label: "Actual Cost (AC)", abbreviation: "AC" },
];

const VARIATIONS = [0.05, 0.1, 0.15, 0.2];

function formatAmount(value) {
  return Number.isFinite(value) ? formatCurrency(value) : "\u2014";
}

function getForecastEac(project, values) {
  if (Object.keys(validateScenarioValues(values)).length > 0) {
    return null;
  }

  const forecast = calculateProjectForecast({ ...project, ...values });

  return Number.isFinite(forecast.eac) && forecast.eac >= 0 &&
    Number.isFinite(forecast.etc) && forecast.etc >= 0
    ? forecast.eac
    : null;
}

export function calculateSensitivity(project, variation) {
  if (!project || !VARIATIONS.includes(variation)) {
    return { baseEac: null, rows: [], rankedRows: [] };
  }

  const baseValues = {
    budgetBAC: project.budgetBAC,
    earnedValueEV: project.earnedValueEV,
    actualCostAC: project.actualCostAC,
  };
  const baseEac = getForecastEac(project, baseValues);

  if (baseEac === null) {
    return { baseEac: null, rows: [], rankedRows: [] };
  }

  const rows = ASSUMPTIONS.map((assumption, index) => {
    const baseInput = baseValues[assumption.key];
    const lowInput = baseInput * (1 - variation);
    const highInput = baseInput * (1 + variation);
    const lowEac = getForecastEac(project, {
      ...baseValues,
      [assumption.key]: lowInput,
    });
    const highEac = getForecastEac(project, {
      ...baseValues,
      [assumption.key]: highInput,
    });
    const spread = lowEac !== null && highEac !== null
      ? Math.abs(highEac - lowEac)
      : null;

    return {
      ...assumption,
      index,
      baseInput,
      lowInput,
      highInput,
      lowEac,
      highEac,
      spread: Number.isFinite(spread) ? spread : null,
    };
  });
  const rankedRows = [...rows].sort((a, b) => {
    if (a.spread === null) return b.spread === null ? a.index - b.index : 1;
    if (b.spread === null) return -1;
    return b.spread - a.spread || a.index - b.index;
  });

  return { baseEac, rows, rankedRows };
}

function getScale(analysis) {
  const values = [analysis.baseEac];

  analysis.rows.forEach((row) => {
    if (Number.isFinite(row.lowEac)) values.push(row.lowEac);
    if (Number.isFinite(row.highEac)) values.push(row.highEac);
  });

  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const difference = maximum - minimum;
  const padding = difference > 0
    ? difference * 0.08
    : Math.max(maximum * 0.1, 1);
  const low = Math.max(0, minimum - padding);
  const high = Number.isFinite(maximum + padding)
    ? maximum + padding
    : maximum;
  const range = high - low;

  return (value) => {
    if (!Number.isFinite(value)) return null;
    if (range === 0) return 50;
    return 2 + Math.min(1, Math.max(0, (value - low) / range)) * 96;
  };
}

function createTornadoChart(project, analysis) {
  const figure = document.createElement("figure");
  const caption = document.createElement("figcaption");
  const baseline = document.createElement("div");
  const rows = document.createElement("div");
  const position = getScale(analysis);
  const basePosition = position(analysis.baseEac);

  figure.className = "sf-sensitivity-chart";
  figure.setAttribute(
    "aria-label",
    `Forecast sensitivity for ${project.projectName || project.projectId}. Base EAC ${formatAmount(analysis.baseEac)}. Rows are ranked by forecast EAC spread.`,
  );
  figure.style.setProperty("--sf-sensitivity-base", `${basePosition}%`);
  caption.textContent = "Forecast EAC Range by Assumption";
  baseline.className = "sf-sensitivity-baseline-label";
  baseline.textContent = `Base EAC ${formatAmount(analysis.baseEac)}`;
  rows.className = "sf-sensitivity-chart-rows";

  analysis.rankedRows.forEach((row, index) => {
    const item = document.createElement("div");
    const title = document.createElement("strong");
    const content = document.createElement("div");
    const plot = document.createElement("div");
    const labels = document.createElement("div");
    const lowPosition = position(row.lowEac);
    const highPosition = position(row.highEac);
    const outcomes = [
      { direction: "Low", eac: row.lowEac },
      { direction: "High", eac: row.highEac },
    ].sort((a, b) => {
      if (!Number.isFinite(a.eac)) return Number.isFinite(b.eac) ? 1 : 0;
      if (!Number.isFinite(b.eac)) return -1;
      return a.eac - b.eac;
    });

    item.className = "sf-sensitivity-chart-row";
    item.setAttribute("role", "group");
    item.setAttribute(
      "aria-label",
      `${row.label}: low input ${formatAmount(row.lowInput)} produces forecast EAC ${formatAmount(row.lowEac)}; base input ${formatAmount(row.baseInput)} produces base EAC ${formatAmount(analysis.baseEac)}; high input ${formatAmount(row.highInput)} produces forecast EAC ${formatAmount(row.highEac)}.`,
    );
    title.textContent = `${index + 1}. ${row.label}`;
    content.className = "sf-sensitivity-chart-content";
    plot.className = "sf-sensitivity-plot";
    labels.className = "sf-sensitivity-case-labels";
    outcomes.forEach((outcome) => {
      const label = document.createElement("span");
      label.textContent = `${outcome.direction} ${row.abbreviation} \u00b7 EAC ${formatAmount(outcome.eac)}`;
      labels.append(label);
    });

    if (lowPosition !== null && highPosition !== null) {
      const range = document.createElement("span");
      range.className = "sf-sensitivity-range";
      range.style.left = `${Math.min(lowPosition, highPosition)}%`;
      range.style.width = `${Math.abs(highPosition - lowPosition)}%`;
      plot.append(range);
    }

    [
      [lowPosition, "low"],
      [highPosition, "high"],
    ].forEach(([outcomePosition, kind]) => {
      if (outcomePosition === null) return;
      const marker = document.createElement("span");
      marker.className = `sf-sensitivity-endpoint sf-sensitivity-endpoint--${kind}`;
      marker.style.left = `${outcomePosition}%`;
      plot.append(marker);
    });

    content.append(plot, labels);
    item.append(title, content);
    rows.append(item);
  });

  figure.append(caption, baseline, rows);
  return figure;
}

function createDetailCard(row, baseEac) {
  const card = document.createElement("article");
  const heading = document.createElement("h4");
  const cases = document.createElement("div");
  const spread = document.createElement("p");

  card.className = "sf-sensitivity-detail-card";
  heading.textContent = row.label;
  cases.className = "sf-sensitivity-detail-cases";

  [
    ["Low input", row.lowInput, row.lowEac],
    ["Base input", row.baseInput, baseEac],
    ["High input", row.highInput, row.highEac],
  ].forEach(([label, input, eac]) => {
    const group = document.createElement("div");
    const title = document.createElement("strong");
    const values = document.createElement("dl");
    const inputTerm = document.createElement("dt");
    const inputValue = document.createElement("dd");
    const eacTerm = document.createElement("dt");
    const eacValue = document.createElement("dd");

    group.className = "sf-sensitivity-detail-case";
    title.textContent = label;
    inputTerm.textContent = "Input";
    inputValue.textContent = formatAmount(input);
    eacTerm.textContent = "Forecast EAC";
    eacValue.textContent = formatAmount(eac);
    values.append(inputTerm, inputValue, eacTerm, eacValue);
    group.append(title, values);
    cases.append(group);
  });

  spread.className = "sf-sensitivity-spread";
  spread.textContent = `EAC Spread: ${formatAmount(row.spread)}`;
  card.append(heading, cases, spread);
  return card;
}

export function renderSensitivityAnalysis(container, project) {
  if (!container) return;

  if (!project) {
    const empty = document.createElement("p");
    empty.className = "sf-sensitivity-empty";
    empty.textContent = "Sensitivity analysis is unavailable for the selected project.";
    container.replaceChildren(empty);
    return;
  }

  const priorVariation = Number(
    container.querySelector(".sf-sensitivity-variation")?.value,
  );
  const initialVariation = VARIATIONS.includes(priorVariation)
    ? priorVariation : 0.1;
  const workspace = document.createElement("div");
  const controls = document.createElement("div");
  const projectName = document.createElement("p");
  const field = document.createElement("div");
  const label = document.createElement("label");
  const select = document.createElement("select");
  const note = document.createElement("p");
  const output = document.createElement("div");

  workspace.className = "sf-sensitivity-workspace";
  controls.className = "sf-sensitivity-controls";
  projectName.className = "sf-sensitivity-project-name";
  projectName.textContent = project.projectName || project.projectId;
  field.className = "sf-sensitivity-variation-field";
  label.htmlFor = "sf-sensitivity-variation";
  label.textContent = "Variation";
  select.id = "sf-sensitivity-variation";
  select.className = "sf-sensitivity-variation";
  VARIATIONS.forEach((variation) => {
    const option = document.createElement("option");
    option.value = String(variation);
    option.textContent = `\u00b1${Math.round(variation * 100)}%`;
    select.append(option);
  });
  select.value = String(initialVariation);
  note.className = "sf-sensitivity-note";
  note.textContent =
    "Sensitivity values are analytical simulations and do not modify project records.";
  output.className = "sf-sensitivity-output";

  function update() {
    const variation = Number(select.value);
    const analysis = calculateSensitivity(project, variation);

    if (analysis.baseEac === null) {
      const empty = document.createElement("p");
      empty.className = "sf-sensitivity-empty";
      empty.textContent =
        "Sensitivity analysis is unavailable for the selected project.";
      output.replaceChildren(empty);
      return;
    }

    const baseline = document.createElement("div");
    const baselineLabel = document.createElement("span");
    const baselineValue = document.createElement("strong");
    const chart = createTornadoChart(project, analysis);
    const details = document.createElement("section");
    const detailsHeading = document.createElement("h3");
    const cards = document.createElement("div");
    const summary = document.createElement("div");
    const summaryHeading = document.createElement("h3");
    const summaryText = document.createElement("p");
    const driver = analysis.rankedRows.find((row) => row.spread !== null);

    baseline.className = "sf-sensitivity-baseline";
    baselineLabel.textContent = "Base Forecast EAC";
    baselineValue.textContent = formatAmount(analysis.baseEac);
    baseline.append(baselineLabel, baselineValue);
    details.className = "sf-sensitivity-details";
    detailsHeading.textContent = "Assumption Detail";
    cards.className = "sf-sensitivity-detail-grid";
    analysis.rows.forEach((row) => {
      cards.append(createDetailCard(row, analysis.baseEac));
    });
    details.append(detailsHeading, cards);
    summary.className = "sf-sensitivity-summary";
    summaryHeading.textContent = "Most Sensitive Driver";
    summaryText.textContent = driver
      ? `${driver.name} has the greatest influence on forecast EAC at the selected \u00b1${Math.round(variation * 100)}% range. Its forecast EAC spread is ${formatAmount(driver.spread)}.`
      : "No complete low-to-high forecast range is available for this project.";
    summary.append(summaryHeading, summaryText);
    output.replaceChildren(baseline, chart, details, summary);
  }

  select.addEventListener("change", update);
  field.append(label, select);
  controls.append(projectName, field);
  workspace.append(controls, note, output);
  container.replaceChildren(workspace);
  update();
}
