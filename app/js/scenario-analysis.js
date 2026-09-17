import {
  calculateProjectEvm,
  calculateProjectForecast,
} from "./portfolio-analytics.js";
import { formatCurrency } from "./formatters.js";
import { APP_CONFIG } from "./app-config.js";

const FIELDS = [
  { key: "budgetBAC", label: "Approved Budget (BAC)" },
  { key: "earnedValueEV", label: "Earned Value (EV)" },
  { key: "actualCostAC", label: "Actual Cost (AC)" },
];

const METRICS = [
  { key: "cpi", label: "CPI", type: "ratio" },
  { key: "cv", label: "CV", type: "currency" },
  { key: "eac", label: "EAC", type: "currency" },
  { key: "etc", label: "ETC", type: "currency" },
  { key: "vac", label: "VAC", type: "currency" },
  { key: "tcpi", label: "TCPI", type: "ratio" },
];

export function validateScenarioValues(values) {
  const errors = {};
  const bac = values.budgetBAC;
  const ev = values.earnedValueEV;
  const ac = values.actualCostAC;

  if (!Number.isFinite(bac) || bac <= 0) {
    errors.budgetBAC = "Scenario Approved Budget must be greater than 0.";
  }

  if (!Number.isFinite(ev) || ev < 0) {
    errors.earnedValueEV = "Scenario Earned Value must be 0 or greater.";
  } else if (!errors.budgetBAC && ev > bac) {
    errors.earnedValueEV =
      "Earned Value cannot exceed the Scenario Approved Budget.";
  }

  if (!Number.isFinite(ac) || ac < 0) {
    errors.actualCostAC = "Scenario Actual Cost must be 0 or greater.";
  }

  return errors;
}

function formatMetric(value, type) {
  if (!Number.isFinite(value)) {
    return "\u2014";
  }

  return type === "ratio" ? value.toFixed(2) : formatCurrency(value);
}

function getMetrics(project) {
  const hasBudget = Number.isFinite(project.budgetBAC);
  const hasEarned = Number.isFinite(project.earnedValueEV);
  const hasActual = Number.isFinite(project.actualCostAC);
  const evm = calculateProjectEvm(project);
  const forecast = calculateProjectForecast(project);
  const hasAll = hasBudget && hasEarned && hasActual;

  return {
    bac: hasBudget ? evm.bac : null,
    cpi: hasEarned && hasActual && Number.isFinite(evm.cpi)
      ? evm.cpi : null,
    cv: hasEarned && hasActual && Number.isFinite(evm.cv)
      ? evm.cv : null,
    eac: hasAll && Number.isFinite(forecast.eac)
      ? forecast.eac : null,
    etc: hasAll && Number.isFinite(forecast.etc)
      ? forecast.etc : null,
    vac: hasAll && Number.isFinite(forecast.vac)
      ? forecast.vac : null,
    tcpi: hasAll && Number.isFinite(forecast.tcpi)
      ? forecast.tcpi : null,
  };
}

export function getValidatedScenarioMetrics(project, values) {
  const errors = validateScenarioValues(values);

  if (Object.keys(errors).length > 0) {
    return { errors, metrics: {}, unavailableEtc: false, unavailableTcpi: false };
  }

  const metrics = getMetrics({ ...project, ...values });
  const unavailableEtc = Number.isFinite(metrics.etc) && metrics.etc < 0;
  const unavailableTcpi = values.actualCostAC >= values.budgetBAC;

  if (unavailableEtc) {
    metrics.etc = null;
  }
  if (unavailableTcpi) {
    metrics.tcpi = null;
  }

  return { errors, metrics, unavailableEtc, unavailableTcpi };
}

function formatChange(current, scenario, type) {
  if (!Number.isFinite(current) || !Number.isFinite(scenario)) {
    return "\u2014";
  }

  const difference = scenario - current;

  if (!Number.isFinite(difference)) {
    return "\u2014";
  }

  if (Math.abs(difference) < (type === "ratio" ? 0.005 : 0.5)) {
    return "No change";
  }

  const amount = formatMetric(Math.abs(difference), type);
  return difference > 0 ? `Increase +${amount}` : `Decrease -${amount}`;
}

function getImpact(current, scenario) {
  if (!Number.isFinite(current.eac) || !Number.isFinite(scenario.eac)) {
    return "Forecast comparison is unavailable for these assumptions.";
  }

  const difference = scenario.eac - current.eac;

  if (Math.abs(difference) < 0.5) {
    return "Scenario produces no material change to forecast cost.";
  }

  if (difference < 0) {
    if (current.vac < 0 && scenario.vac >= 0) {
      return "Scenario brings forecast cost within the scenario budget assumption.";
    }

    return `Scenario forecast improves by ${formatCurrency(Math.abs(difference))}${scenario.vac < 0 ? " but remains above the scenario budget assumption" : " and remains within the scenario budget assumption"}.`;
  }

  return `Scenario increases forecast cost by ${formatCurrency(difference)}${current.vac >= 0 && scenario.vac < 0 ? " and moves above the scenario budget assumption" : ""}.`;
}

function getPerformanceSignals(current, scenario) {
  const signals = [];
  const { targetIndex, highCompletionPressureTcpi } =
    APP_CONFIG.portfolio.performanceThresholds;

  if (Number.isFinite(current.cpi) && Number.isFinite(scenario.cpi) &&
      Math.abs(scenario.cpi - current.cpi) >= 0.005) {
    const direction = scenario.cpi > current.cpi ? "improves" : "worsens";
    const target = scenario.cpi >= targetIndex
      ? "meets the cost-efficiency target"
      : "remains below the cost-efficiency target";
    signals.push(`Cost efficiency ${direction}; scenario CPI ${formatMetric(scenario.cpi, "ratio")} ${target}.`);
  }

  if (Number.isFinite(current.vac) && Number.isFinite(scenario.vac)) {
    if (current.vac >= 0 && scenario.vac < 0) {
      signals.push("Forecast moves outside the scenario budget assumption.");
    } else if (current.vac < 0 && scenario.vac >= 0) {
      signals.push("Forecast moves within the scenario budget assumption.");
    }
  }

  if (Number.isFinite(current.tcpi) && Number.isFinite(scenario.tcpi) &&
      Math.abs(scenario.tcpi - current.tcpi) >= 0.005) {
    const direction = scenario.tcpi > current.tcpi ? "increases" : "decreases";
    const pressure = scenario.tcpi > highCompletionPressureTcpi
      ? "above the existing high-pressure threshold"
      : "at or below the existing high-pressure threshold";
    signals.push(`Required remaining cost efficiency ${direction} to TCPI ${formatMetric(scenario.tcpi, "ratio")}, ${pressure}.`);
  }

  return signals;
}

function createChart(project, current, scenario) {
  const figure = document.createElement("figure");
  const heading = document.createElement("figcaption");
  const columns = document.createElement("div");
  const values = [
    { label: "Approved BAC", value: current.bac, className: "budget" },
    { label: "Current EAC", value: current.eac, className: "current" },
    { label: "Scenario EAC", value: scenario.eac, className: "scenario" },
  ];
  const maximum = Math.max(
    1,
    ...values.filter((item) => Number.isFinite(item.value) && item.value >= 0)
      .map((item) => item.value),
  );

  figure.className = "sf-scenario-chart";
  figure.setAttribute("role", "img");
  figure.setAttribute(
    "aria-label",
    `Forecast cost comparison for ${project.projectName || project.projectId}: approved budget ${formatMetric(current.bac, "currency")}, current EAC ${formatMetric(current.eac, "currency")}, scenario EAC ${formatMetric(scenario.eac, "currency")}. All columns use one scale.`,
  );
  heading.textContent = "Forecast Cost Comparison";
  columns.className = "sf-scenario-chart-columns";

  values.forEach((item) => {
    const column = document.createElement("div");
    const amount = document.createElement("strong");
    const track = document.createElement("div");
    const bar = document.createElement("span");
    const label = document.createElement("span");

    column.className = "sf-scenario-chart-column";
    amount.textContent = formatMetric(item.value, "currency");
    track.className = "sf-scenario-chart-track";
    bar.className = `sf-scenario-chart-bar sf-scenario-chart-bar--${item.className}`;
    bar.style.height = Number.isFinite(item.value) && item.value >= 0
      ? `${item.value / maximum * (100 / 1.12)}%`
      : "0%";
    label.textContent = item.label;
    track.append(bar);
    column.append(amount, track, label);
    columns.append(column);
  });

  figure.append(heading, columns);
  return figure;
}

function createComparison(current, scenario) {
  const comparison = document.createElement("div");
  const heading = document.createElement("h3");
  const table = document.createElement("table");
  const caption = document.createElement("caption");
  const head = document.createElement("thead");
  const body = document.createElement("tbody");
  const headerRow = document.createElement("tr");

  comparison.className = "sf-scenario-comparison";
  heading.textContent = "Current vs Scenario";
  table.className = "sf-scenario-table";
  caption.className = "sf-visually-hidden";
  caption.textContent = "Current project metrics compared with temporary scenario metrics";

  ["Metric", "Current", "Scenario", "Change"].forEach((label) => {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = label;
    headerRow.append(cell);
  });
  head.append(headerRow);

  METRICS.forEach((metric) => {
    const row = document.createElement("tr");
    const label = document.createElement("th");
    label.scope = "row";
    label.textContent = metric.label;
    row.append(label);

    [
      formatMetric(current[metric.key], metric.type),
      formatMetric(scenario[metric.key], metric.type),
      formatChange(current[metric.key], scenario[metric.key], metric.type),
    ].forEach((text) => {
      const cell = document.createElement("td");
      cell.textContent = text;
      row.append(cell);
    });
    body.append(row);
  });

  table.append(caption, head, body);
  comparison.append(heading, table);
  return comparison;
}

export function renderScenarioAnalysis(container, projects) {
  if (!container) {
    return;
  }

  if (!Array.isArray(projects) || projects.length === 0) {
    const empty = document.createElement("p");
    empty.className = "sf-scenario-empty";
    empty.textContent = "No project data is currently available for scenario analysis.";
    container.replaceChildren(empty);
    return;
  }

  const workspace = document.createElement("div");
  const controls = document.createElement("div");
  const projectField = document.createElement("div");
  const projectLabel = document.createElement("label");
  const selector = document.createElement("select");
  const reset = document.createElement("button");
  const note = document.createElement("p");
  const inputs = document.createElement("div");
  const inputHeading = document.createElement("div");
  const results = document.createElement("div");
  const impact = document.createElement("div");
  const inputElements = new Map();
  let selectedProject = projects[0];
  let scenarioValues = {};

  workspace.className = "sf-scenario-workspace";
  controls.className = "sf-scenario-controls";
  projectField.className = "sf-scenario-project-field";
  projectLabel.htmlFor = "sf-scenario-project";
  projectLabel.textContent = "Project";
  selector.id = "sf-scenario-project";
  selector.className = "sf-scenario-select";
  projects.forEach((project) => {
    const option = document.createElement("option");
    option.value = project.projectId;
    option.textContent = project.projectName || project.projectId;
    selector.append(option);
  });
  reset.type = "button";
  reset.className = "sf-scenario-reset";
  reset.textContent = "Reset Scenario";
  note.className = "sf-scenario-note";
  note.textContent = "Scenario values are temporary and do not modify project records.";
  inputs.className = "sf-scenario-inputs";
  inputHeading.className = "sf-scenario-input-heading";
  ["Financial assumption", "Current value", "Scenario value"].forEach((text) => {
    const heading = document.createElement("span");
    heading.textContent = text;
    inputHeading.append(heading);
  });
  inputs.append(inputHeading);

  FIELDS.forEach((field) => {
    const row = document.createElement("div");
    const label = document.createElement("label");
    const current = document.createElement("output");
    const input = document.createElement("input");
    const error = document.createElement("p");

    row.className = "sf-scenario-input-row";
    label.htmlFor = `sf-scenario-${field.key}`;
    label.textContent = `Scenario ${field.label}`;
    current.className = "sf-scenario-current-value";
    input.id = `sf-scenario-${field.key}`;
    input.type = "number";
    input.min = "0";
    input.step = "1";
    input.inputMode = "decimal";
    input.className = "sf-scenario-input";
    error.id = `sf-scenario-${field.key}-error`;
    error.className = "sf-scenario-field-error";
    error.hidden = true;
    error.setAttribute("aria-live", "polite");
    input.setAttribute("aria-describedby", error.id);
    input.setAttribute("aria-invalid", "false");
    input.addEventListener("input", () => {
      const value = input.value === "" || input.validity.badInput
        ? null : Number(input.value);
      scenarioValues[field.key] = value;
      renderResults();
    });
    inputElements.set(field.key, { input, current, error });
    row.append(label, current, input, error);
    inputs.append(row);
  });

  results.className = "sf-scenario-results";
  impact.className = "sf-scenario-impact";
  impact.setAttribute("aria-live", "polite");

  function renderResults() {
    const current = getMetrics(selectedProject);
    const {
      errors,
      metrics: scenario,
      unavailableEtc,
      unavailableTcpi,
    } = getValidatedScenarioMetrics(selectedProject, scenarioValues);
    const isValid = Object.keys(errors).length === 0;

    FIELDS.forEach((field) => {
      const { input, error } = inputElements.get(field.key);
      const message = errors[field.key] || "";
      input.setAttribute("aria-invalid", String(Boolean(message)));
      error.textContent = message;
      error.hidden = !message;
    });

    const comparison = createComparison(current, scenario);
    const chart = createChart(selectedProject, current, scenario);
    const heading = document.createElement("h3");
    const summary = document.createElement("p");
    const signals = isValid ? getPerformanceSignals(current, scenario) : [];

    if (unavailableTcpi) {
      signals.push("Approved budget has already been reached or exceeded; scenario TCPI is unavailable.");
    }
    if (unavailableEtc) {
      signals.push("Remaining forecast (ETC) is unavailable for these assumptions.");
    }

    heading.textContent = "Scenario Impact";
    summary.textContent = isValid
      ? getImpact(current, scenario)
      : "Correct the scenario assumptions to view the forecast impact.";
    impact.replaceChildren(heading, summary);
    if (signals.length > 0) {
      const list = document.createElement("ul");
      signals.forEach((signal) => {
        const item = document.createElement("li");
        item.textContent = signal;
        list.append(item);
      });
      impact.append(list);
    }
    results.replaceChildren(comparison, chart);
  }

  function loadSelectedProject() {
    scenarioValues = {};
    FIELDS.forEach((field) => {
      const value = Number.isFinite(selectedProject[field.key])
        ? selectedProject[field.key] : null;
      const { input, current } = inputElements.get(field.key);
      scenarioValues[field.key] = value;
      input.value = value === null ? "" : String(value);
      current.textContent = formatMetric(value, "currency");
    });
    renderResults();
  }

  selector.addEventListener("change", () => {
    selectedProject = projects.find((project) => project.projectId === selector.value)
      || projects[0];
    loadSelectedProject();
  });
  reset.addEventListener("click", loadSelectedProject);
  projectField.append(projectLabel, selector);
  controls.append(projectField, reset);
  workspace.append(controls, note, inputs, results, impact);
  container.replaceChildren(workspace);
  loadSelectedProject();
}
