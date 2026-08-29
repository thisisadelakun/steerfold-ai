import { formatCurrency } from "./formatters.js";

import { APP_CONFIG } from "./app-config.js";

/*
 * ---------------------------------------------------------
 * PORTFOLIO FINANCIAL PERFORMANCE
 * ---------------------------------------------------------
 * Creates the horizontal comparison of:
 * - Planned Value (PV)
 * - Earned Value (EV)
 * - Actual Cost (AC)
 * ---------------------------------------------------------
 */
export function createFinancialPerformanceChart(summary) {
  const figure = document.createElement("figure");
  const chart = document.createElement("div");
  const caption = document.createElement("figcaption");

  figure.classList.add(
    "sf-chart",
    "sf-financial-chart",
  );

  chart.classList.add(
    "sf-financial-chart-bars",
  );

  caption.classList.add(
    "sf-chart-caption",
  );

  caption.textContent =
    "Portfolio performance to date comparing Planned Value, Earned Value and Actual Cost.";

  const metrics = [
    {
      label: "Planned Value",
      shortLabel: "PV",
      value: summary.totalPV,
      className: "sf-chart-bar--planned",
    },
    {
      label: "Earned Value",
      shortLabel: "EV",
      value: summary.totalEV,
      className: "sf-chart-bar--earned",
    },
    {
      label: "Actual Cost",
      shortLabel: "AC",
      value: summary.totalAC,
      className: "sf-chart-bar--actual",
    },
  ];

  const maximumValue = Math.max(
    ...metrics.map((metric) => metric.value),
    1,
  );

  metrics.forEach((metric) => {
    const row = document.createElement("div");
    const heading = document.createElement("div");
    const label = document.createElement("span");
    const value = document.createElement("strong");
    const track = document.createElement("div");
    const bar = document.createElement("div");

    row.classList.add(
      "sf-chart-row",
    );

    heading.classList.add(
      "sf-chart-row-heading",
    );

    label.classList.add(
      "sf-chart-label",
    );

    value.classList.add(
      "sf-chart-value",
    );

    track.classList.add(
      "sf-chart-track",
    );

    bar.classList.add(
      "sf-chart-bar",
      metric.className,
    );

    label.textContent =
      `${metric.label} (${metric.shortLabel})`;

    value.textContent =
      formatCurrency(metric.value);

    const percentage =
      (metric.value / maximumValue) * 100;

    bar.style.width =
      `${Math.max(percentage, 0)}%`;

    bar.setAttribute(
      "aria-label",
      `${metric.label}: ${formatCurrency(metric.value)}`,
    );

    heading.append(
      label,
      value,
    );

    track.append(bar);

    row.append(
      heading,
      track,
    );

    chart.append(row);
  });

  figure.append(
    chart,
    caption,
  );

  return figure;
}

/*
 * ---------------------------------------------------------
 * RISK VS PROJECT COMPLETION
 * ---------------------------------------------------------
 * Creates the portfolio scatter-style visualization.
 *
 * X-axis = Project completion
 * Y-axis = Risk score
 *
 * Point colour represents project status:
 * - Green = On Track
 * - Amber = At Risk
 * - Red = Critical
 * ---------------------------------------------------------
 */
export function createRiskCompletionChart(projects) {
  const figure = document.createElement("figure");
  const chart = document.createElement("div");
  const caption = document.createElement("figcaption");
  const legend = document.createElement("div");

  figure.classList.add(
    "sf-chart",
    "sf-risk-completion-chart",
  );

  chart.classList.add(
    "sf-risk-completion-plot",
  );

  caption.classList.add(
    "sf-chart-caption",
  );

  caption.textContent =
    "Projects with higher risk and lower completion require closer management attention.";


  /*
   * -------------------------------------------------------
   * CHART LEGEND
   * -------------------------------------------------------
   */

  legend.classList.add(
    "sf-chart-legend",
  );

  const legendItems = [
    {
      label: "On Track",
      className: "sf-risk-point--on-track",
    },
    {
      label: "At Risk",
      className: "sf-risk-point--at-risk",
    },
    {
      label: "Critical",
      className: "sf-risk-point--critical",
    },
  ];

  legendItems.forEach((item) => {
    const legendItem =
      document.createElement("span");

    const marker =
      document.createElement("span");

    legendItem.classList.add(
      "sf-chart-legend-item",
    );

    marker.classList.add(
      "sf-chart-legend-marker",
      item.className,
    );

    legendItem.append(
      marker,
      document.createTextNode(item.label),
    );

    legend.append(legendItem);
  });


  /*
   * -------------------------------------------------------
   * X AND Y AXES
   * -------------------------------------------------------
   */

  const xAxis =
    document.createElement("div");

  const yAxis =
    document.createElement("div");

  xAxis.classList.add(
    "sf-risk-x-axis",
  );

  yAxis.classList.add(
    "sf-risk-y-axis",
  );

  const xAxisLabels = [
    "0%",
    "25%",
    "50%",
    "75%",
    "100%",
  ];

  xAxisLabels.forEach((label) => {
    const tick =
      document.createElement("span");

    tick.textContent = label;

    xAxis.append(tick);
  });

  const yAxisLabels = [
    "25",
    "20",
    "15",
    "10",
    "5",
    "0",
  ];

  yAxisLabels.forEach((label) => {
    const tick =
      document.createElement("span");

    tick.textContent = label;

    yAxis.append(tick);
  });


  /*
   * -------------------------------------------------------
   * PROJECT DATA POINTS
   * -------------------------------------------------------
   */

  projects.forEach((project) => {
    const point =
      document.createElement("div");

    point.classList.add(
      "sf-risk-point",
    );

    /*
     * Assign a visual status class.
     */

    if (
      project.projectStatus === "Critical"
    ) {
      point.classList.add(
        "sf-risk-point--critical",
      );
    } else if (
      project.projectStatus === "At Risk"
    ) {
      point.classList.add(
        "sf-risk-point--at-risk",
      );
    } else {
      point.classList.add(
        "sf-risk-point--on-track",
      );
    }


    /*
     * X position:
     * percentComplete is stored as a decimal,
     * for example 0.50 = 50%.
     */

    const x =
      Math.min(
        Math.max(
          project.percentComplete * 100,
          0,
        ),
        100,
      );


    /*
     * Y position:
     * Risk scores use a 1–25 scale.
     * Convert the score into a percentage
     * of the plot height.
     */

    const y =
      Math.min(
        Math.max(
          project.riskScore / 25,
          0,
        ),
        1,
      ) * 100;


    /*
     * Position the project point.
     */

    point.style.left =
      `${x}%`;

    point.style.bottom =
      `${y}%`;


    /*
     * Native hover tooltip.
     */

    point.title =
      `${project.projectName} | ` +
      `${Math.round(
        project.percentComplete * 100,
      )}% complete | ` +
      `Risk ${project.riskScore}/25`;


    /*
     * Accessibility description.
     */

    point.setAttribute(
      "aria-label",
      point.title,
    );

    chart.append(point);
  });


  /*
   * -------------------------------------------------------
   * ADD AXES TO THE PLOT
   * -------------------------------------------------------
   */

  chart.append(
    xAxis,
    yAxis,
  );


  /*
   * -------------------------------------------------------
   * BUILD FINAL FIGURE
   * -------------------------------------------------------
   */

  figure.append(
    legend,
    chart,
    caption,
  );

  return figure;
}

export function createResourceDemandChart(data) {
  const figure = document.createElement("figure");
  const chart = document.createElement("div");
  const caption = document.createElement("figcaption");
  const legend = document.createElement("div");

  figure.classList.add(
    "sf-chart",
    "sf-resource-demand-chart",
  );

  chart.classList.add(
    "sf-resource-chart-bars",
  );

  caption.classList.add(
    "sf-chart-caption",
  );

  caption.textContent =
    "Resource demand distribution across portfolio health categories.";

  /* Legend */
  legend.classList.add(
    "sf-chart-legend",
  );

  const legendItems = [
    { label: "High", className: "sf-resource-segment--high" },
    { label: "Medium", className: "sf-resource-segment--medium" },
    { label: "Low", className: "sf-resource-segment--low" },
  ];

  legendItems.forEach((item) => {
    const legendItem = document.createElement("span");
    const marker = document.createElement("span");

    legendItem.classList.add("sf-chart-legend-item");

    marker.classList.add(
      "sf-chart-legend-marker",
      item.className,
      "sf-resource-legend-marker",
    );

    legendItem.append(marker, document.createTextNode(item.label));

    legend.append(legendItem);
  });

  /* Ensure canonical ordering of statuses */
  const statuses = ["On Track", "At Risk", "Critical"];

  /* Compute maximum total across all statuses to use as common scale */
  const totals = statuses.map((status) => {
    const rowData = data.find((d) => d.status === status) || {
      status,
      high: 0,
      medium: 0,
      low: 0,
    };

    const high = Number(rowData.high) || 0;
    const medium = Number(rowData.medium) || 0;
    const low = Number(rowData.low) || 0;

    return high + medium + low;
  });

  const maximumStatusTotal = Math.max(...totals, 0);

  statuses.forEach((status) => {
    const rowData = data.find((d) => d.status === status) || {
      status,
      high: 0,
      medium: 0,
      low: 0,
    };

    const high = Number(rowData.high) || 0;
    const medium = Number(rowData.medium) || 0;
    const low = Number(rowData.low) || 0;

    const row = document.createElement("div");
    const heading = document.createElement("div");
    const label = document.createElement("span");
    const track = document.createElement("div");
    const counts = document.createElement("div");

    row.classList.add("sf-chart-row", "sf-resource-row");

    heading.classList.add("sf-chart-row-heading");

    label.classList.add("sf-chart-label", "sf-resource-label");

    track.classList.add("sf-resource-track");

    counts.classList.add("sf-resource-counts");

    label.textContent = status;

    /* Create segments */
    const segHigh = document.createElement("div");
    const segMedium = document.createElement("div");
    const segLow = document.createElement("div");

    segHigh.classList.add(
      "sf-resource-segment",
      "sf-resource-segment--high",
    );
    segMedium.classList.add(
      "sf-resource-segment",
      "sf-resource-segment--medium",
    );
    segLow.classList.add(
      "sf-resource-segment",
      "sf-resource-segment--low",
    );

    /* Scale segments against the common maximumStatusTotal */
    const denom = maximumStatusTotal || 1;

    const highPct = (high / denom) * 100;
    const mediumPct = (medium / denom) * 100;
    const lowPct = (low / denom) * 100;

    segHigh.style.width = `${Math.max(highPct, 0)}%`;
    segMedium.style.width = `${Math.max(mediumPct, 0)}%`;
    segLow.style.width = `${Math.max(lowPct, 0)}%`;

    segHigh.setAttribute("aria-label", `High: ${high}`);
    segMedium.setAttribute("aria-label", `Medium: ${medium}`);
    segLow.setAttribute("aria-label", `Low: ${low}`);

    segHigh.title = `High: ${high}`;
    segMedium.title = `Medium: ${medium}`;
    segLow.title = `Low: ${low}`;

    track.append(segHigh, segMedium, segLow);

    /* Numeric counts visible with labels */
    const countHigh = document.createElement("span");
    const countMedium = document.createElement("span");
    const countLow = document.createElement("span");

    countHigh.classList.add(
      "sf-resource-count",
      "sf-resource-count--high",
    );
    countMedium.classList.add(
      "sf-resource-count",
      "sf-resource-count--medium",
    );
    countLow.classList.add(
      "sf-resource-count",
      "sf-resource-count--low",
    );

    countHigh.textContent = `High ${high}`;
    countMedium.textContent = `Medium ${medium}`;
    countLow.textContent = `Low ${low}`;

    counts.append(countHigh, countMedium, countLow);

    /* Accessibility summary for the row */
    row.setAttribute(
      "aria-label",
      `${status}: High ${high}, Medium ${medium}, Low ${low}`,
    );

    heading.append(label);

    row.append(heading, track, counts);

    chart.append(row);
  });

  figure.append(legend, chart, caption);

  return figure;
}

function clamp(value, min, max) {
  return Math.min(
    Math.max(value, min),
    max,
  );
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
}

function createChartEmptyMessage(message) {
  const element = document.createElement("p");

  element.className = "sf-chart-empty";
  element.textContent = message;

  return element;
}

function createAnalysisFigure(className) {
  const figure = document.createElement("figure");

  figure.classList.add(
    "sf-chart",
    className,
  );

  return figure;
}

function getProjectName(project) {
  return project.projectName || project.projectId || "Unnamed project";
}

function getStatusClass(status) {
  if (status === "Critical") {
    return "sf-status-badge--critical";
  }

  if (status === "At Risk") {
    return "sf-status-badge--at-risk";
  }

  return "sf-status-badge--on-track";
}

function getPriorityClass(priority) {
  if (priority === "High") {
    return "sf-health-cell--warning";
  }

  if (priority === "Low") {
    return "sf-health-cell--success";
  }

  return "sf-health-cell--neutral";
}

function getRiskClass(riskScore) {
  const { lowMax, mediumMax } =
    APP_CONFIG.portfolio.riskScoreBands;

  if (riskScore <= lowMax) {
    return "sf-health-cell--success";
  }

  if (riskScore <= mediumMax) {
    return "sf-health-cell--warning";
  }

  return "sf-health-cell--danger";
}

function getPerformanceClass(value) {
  const { warningIndex, targetIndex } =
    APP_CONFIG.portfolio.performanceThresholds;

  if (!Number.isFinite(value)) {
    return "sf-health-cell--neutral";
  }

  if (value < warningIndex) {
    return "sf-health-cell--danger";
  }

  if (value < targetIndex) {
    return "sf-health-cell--warning";
  }

  return "sf-health-cell--success";
}

function calculateProjectCpi(project) {
  const earnedValue = safeNumber(project.earnedValueEV);
  const actualCost = safeNumber(project.actualCostAC);

  if (actualCost <= 0) {
    return null;
  }

  return earnedValue / actualCost;
}

function calculateProjectSpi(project) {
  const earnedValue = safeNumber(project.earnedValueEV);
  const plannedValue = safeNumber(project.plannedValuePV);

  if (plannedValue <= 0) {
    return null;
  }

  return earnedValue / plannedValue;
}

function formatIndex(value) {
  return Number.isFinite(value) ? value.toFixed(2) : "—";
}

export function createBudgetActualChart(projects) {
  const figure = createAnalysisFigure("sf-budget-actual-chart");

  if (!projects.length) {
    figure.append(
      createChartEmptyMessage(
        "No project data is available for this analysis.",
      ),
    );
    return figure;
  }

  const legend = document.createElement("div");
  const chart = document.createElement("div");
  const caption = document.createElement("figcaption");
  const maximumValue = Math.max(
    ...projects.flatMap((project) => [
      safeNumber(project.budgetBAC),
      safeNumber(project.actualCostAC),
    ]),
    1,
  );

  legend.className = "sf-chart-legend";
  chart.className = "sf-budget-actual-rows";
  caption.className = "sf-chart-caption";
  caption.textContent =
    "Each row compares approved budget against actual cost incurred to date.";

  [
    ["Budget at Completion (BAC)", "sf-budget-bar--bac"],
    ["Actual Cost (AC)", "sf-budget-bar--actual"],
  ].forEach(([label, className]) => {
    const item = document.createElement("span");
    const marker = document.createElement("span");

    item.className = "sf-chart-legend-item";
    marker.classList.add(
      "sf-chart-legend-marker",
      className,
    );

    item.append(
      marker,
      document.createTextNode(label),
    );
    legend.append(item);
  });

  projects.forEach((project) => {
    const budget = safeNumber(project.budgetBAC);
    const actual = safeNumber(project.actualCostAC);
    const row = document.createElement("div");
    const name = document.createElement("div");
    const bars = document.createElement("div");
    const budgetTrack = document.createElement("div");
    const actualTrack = document.createElement("div");
    const budgetBar = document.createElement("div");
    const actualBar = document.createElement("div");
    const values = document.createElement("div");

    row.className = "sf-budget-actual-row";
    name.className = "sf-budget-actual-name";
    bars.className = "sf-budget-actual-bars";
    budgetTrack.className = "sf-budget-actual-track";
    actualTrack.className = "sf-budget-actual-track";
    budgetBar.className = "sf-budget-actual-bar sf-budget-bar--bac";
    actualBar.className = "sf-budget-actual-bar sf-budget-bar--actual";
    values.className = "sf-budget-actual-values";

    name.textContent = getProjectName(project);
    budgetBar.style.width =
      `${clamp((budget / maximumValue) * 100, 0, 100)}%`;
    actualBar.style.width =
      `${clamp((actual / maximumValue) * 100, 0, 100)}%`;
    values.textContent =
      `BAC ${formatCurrency(budget)} | AC ${formatCurrency(actual)}`;

    row.setAttribute(
      "aria-label",
      `${name.textContent}: Budget at Completion ${formatCurrency(budget)}, Actual Cost ${formatCurrency(actual)}`,
    );

    budgetTrack.append(budgetBar);
    actualTrack.append(actualBar);
    bars.append(
      budgetTrack,
      actualTrack,
    );
    row.append(
      name,
      bars,
      values,
    );
    chart.append(row);
  });

  figure.append(
    legend,
    chart,
    caption,
  );

  return figure;
}

export function createProjectCompletionChart(projects) {
  const figure = createAnalysisFigure("sf-completion-chart");

  if (!projects.length) {
    figure.append(
      createChartEmptyMessage(
        "No project data is available for this analysis.",
      ),
    );
    return figure;
  }

  const wrap = document.createElement("div");
  const chart = document.createElement("div");
  const caption = document.createElement("figcaption");

  wrap.className = "sf-completion-chart-wrap";
  chart.className = "sf-completion-columns";
  caption.className = "sf-chart-caption";
  caption.textContent =
    "Percent complete is shown on a fixed 0-100% scale.";

  projects.forEach((project) => {
    const completion = clamp(
      safeNumber(project.percentComplete) * 100,
      0,
      100,
    );
    const item = document.createElement("div");
    const value = document.createElement("strong");
    const barWrap = document.createElement("div");
    const bar = document.createElement("div");
    const label = document.createElement("span");

    item.className = "sf-completion-column";
    value.className = "sf-completion-value";
    barWrap.className = "sf-completion-bar-wrap";
    bar.className = "sf-completion-bar";
    label.className = "sf-completion-label";

    value.textContent = `${Math.round(completion)}%`;
    bar.style.height = `${completion}%`;
    label.textContent = getProjectName(project);
    item.setAttribute(
      "aria-label",
      `${label.textContent}: ${Math.round(completion)}% complete`,
    );

    barWrap.append(bar);
    item.append(
      value,
      barWrap,
      label,
    );
    chart.append(item);
  });

  wrap.append(chart);
  figure.append(
    wrap,
    caption,
  );

  return figure;
}

export function createProjectRiskChart(projects) {
  const figure = createAnalysisFigure("sf-project-risk-chart");

  if (!projects.length) {
    figure.append(
      createChartEmptyMessage(
        "No project data is available for this analysis.",
      ),
    );
    return figure;
  }

  const chart = document.createElement("div");
  const caption = document.createElement("figcaption");
  const sortedProjects = [...projects].sort((a, b) => {
    return safeNumber(b.riskScore) - safeNumber(a.riskScore);
  });
  const maximumRisk = Math.max(
    ...sortedProjects.map((project) => safeNumber(project.riskScore)),
    25,
  );

  chart.className = "sf-project-risk-rows";
  caption.className = "sf-chart-caption";
  caption.textContent =
    "Risk scores use the configured portfolio risk bands.";

  sortedProjects.forEach((project) => {
    const riskScore = safeNumber(project.riskScore);
    const row = document.createElement("div");
    const name = document.createElement("div");
    const track = document.createElement("div");
    const bar = document.createElement("div");
    const value = document.createElement("strong");

    row.className = "sf-project-risk-row";
    name.className = "sf-project-risk-name";
    track.className = "sf-project-risk-track";
    bar.classList.add(
      "sf-project-risk-bar",
      getRiskClass(riskScore),
    );
    value.className = "sf-project-risk-value";

    name.textContent = getProjectName(project);
    bar.style.width =
      `${clamp((riskScore / maximumRisk) * 100, 0, 100)}%`;
    value.textContent = `${riskScore}/25`;

    row.setAttribute(
      "aria-label",
      `${name.textContent}: Risk Score ${riskScore} out of 25`,
    );

    track.append(bar);
    row.append(
      name,
      track,
      value,
    );
    chart.append(row);
  });

  figure.append(
    chart,
    caption,
  );

  return figure;
}

function createDonutChart({
  className,
  title,
  items,
}) {
  const figure = createAnalysisFigure(className);
  const wrap = document.createElement("div");
  const svg = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  const total = items.reduce((sum, item) => {
    return sum + item.value;
  }, 0);
  const legend = document.createElement("div");
  const caption = document.createElement("figcaption");
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  if (total === 0) {
    figure.append(
      createChartEmptyMessage(
        "No project data is available for this analysis.",
      ),
    );
    return figure;
  }

  wrap.className = "sf-donut-layout";
  legend.className = "sf-donut-legend";
  caption.className = "sf-chart-caption";
  caption.textContent =
    `${title} is calculated directly from current project records.`;

  svg.setAttribute("viewBox", "0 0 120 120");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${title}: ${total} total projects`);
  svg.classList.add("sf-donut-svg");

  const background = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "circle",
  );

  background.setAttribute("cx", "60");
  background.setAttribute("cy", "60");
  background.setAttribute("r", String(radius));
  background.classList.add("sf-donut-ring-background");
  svg.append(background);

  items.forEach((item) => {
    const slice = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "circle",
    );
    const dash = (item.value / total) * circumference;

    slice.setAttribute("cx", "60");
    slice.setAttribute("cy", "60");
    slice.setAttribute("r", String(radius));
    slice.setAttribute(
      "stroke-dasharray",
      `${dash} ${circumference - dash}`,
    );
    slice.setAttribute("stroke-dashoffset", String(-offset));
    slice.classList.add(
      "sf-donut-slice",
      item.className,
    );
    svg.append(slice);

    offset += dash;
  });

  const centerTotal = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "text",
  );
  const centerLabel = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "text",
  );

  centerTotal.setAttribute("x", "60");
  centerTotal.setAttribute("y", "57");
  centerTotal.classList.add("sf-donut-total");
  centerTotal.textContent = String(total);

  centerLabel.setAttribute("x", "60");
  centerLabel.setAttribute("y", "72");
  centerLabel.classList.add("sf-donut-label");
  centerLabel.textContent = total === 1 ? "project" : "projects";

  svg.append(
    centerTotal,
    centerLabel,
  );

  items.forEach((item) => {
    const legendItem = document.createElement("span");
    const marker = document.createElement("span");
    const value = document.createElement("strong");

    legendItem.className = "sf-donut-legend-item";
    marker.classList.add(
      "sf-donut-legend-marker",
      item.className,
    );
    value.textContent = `${item.label} ${item.value}`;

    legendItem.append(
      marker,
      value,
    );
    legend.append(legendItem);
  });

  wrap.append(
    svg,
    legend,
  );
  figure.append(
    wrap,
    caption,
  );

  return figure;
}

export function createStatusDistributionChart(projects) {
  const counts = {
    "On Track": 0,
    "At Risk": 0,
    Critical: 0,
  };

  projects.forEach((project) => {
    if (Object.hasOwn(counts, project.projectStatus)) {
      counts[project.projectStatus] += 1;
    }
  });

  return createDonutChart({
    className: "sf-status-distribution-chart",
    title: "Portfolio Status Distribution",
    items: [
      {
        label: "On Track",
        value: counts["On Track"],
        className: "sf-donut-slice--success",
      },
      {
        label: "At Risk",
        value: counts["At Risk"],
        className: "sf-donut-slice--warning",
      },
      {
        label: "Critical",
        value: counts.Critical,
        className: "sf-donut-slice--danger",
      },
    ],
  });
}

export function createPriorityDistributionChart(projects) {
  const counts = {
    High: 0,
    Medium: 0,
    Low: 0,
  };

  projects.forEach((project) => {
    if (Object.hasOwn(counts, project.strategicPriority)) {
      counts[project.strategicPriority] += 1;
    }
  });

  return createDonutChart({
    className: "sf-priority-distribution-chart",
    title: "Strategic Priority Distribution",
    items: [
      {
        label: "High",
        value: counts.High,
        className: "sf-donut-slice--warning",
      },
      {
        label: "Medium",
        value: counts.Medium,
        className: "sf-donut-slice--accent",
      },
      {
        label: "Low",
        value: counts.Low,
        className: "sf-donut-slice--success",
      },
    ],
  });
}

function createHealthCell(text, className = "sf-health-cell--neutral") {
  const cell = document.createElement("td");
  const value = document.createElement("span");

  value.classList.add(
    "sf-health-cell",
    className,
  );
  value.textContent = text;
  cell.append(value);

  return cell;
}

export function createProjectHealthHeatmap(projects) {
  const figure = createAnalysisFigure("sf-health-heatmap-chart");

  if (!projects.length) {
    figure.append(
      createChartEmptyMessage(
        "No project data is available for this analysis.",
      ),
    );
    return figure;
  }

  const wrap = document.createElement("div");
  const table = document.createElement("table");
  const caption = document.createElement("figcaption");
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");
  const headerRow = document.createElement("tr");

  wrap.className = "sf-health-heatmap-wrap";
  table.className = "sf-health-heatmap-table";
  caption.className = "sf-chart-caption";
  caption.textContent =
    "Heatmap colors supplement the readable values in each cell.";

  [
    "Project",
    "CPI",
    "SPI",
    "Risk",
    "Complete",
    "Resources",
    "Status",
  ].forEach((headerText) => {
    const header = document.createElement("th");

    header.scope = "col";
    header.textContent = headerText;
    headerRow.append(header);
  });

  thead.append(headerRow);

  projects.forEach((project) => {
    const row = document.createElement("tr");
    const projectCell = document.createElement("th");
    const cpi = calculateProjectCpi(project);
    const spi = calculateProjectSpi(project);
    const riskScore = safeNumber(project.riskScore);
    const completion = clamp(
      safeNumber(project.percentComplete) * 100,
      0,
      100,
    );

    projectCell.scope = "row";
    projectCell.textContent = getProjectName(project);

    row.append(
      projectCell,
      createHealthCell(
        formatIndex(cpi),
        getPerformanceClass(cpi),
      ),
      createHealthCell(
        formatIndex(spi),
        getPerformanceClass(spi),
      ),
      createHealthCell(
        String(riskScore),
        getRiskClass(riskScore),
      ),
      createHealthCell(
        `${Math.round(completion)}%`,
        "sf-health-cell--completion",
      ),
      createHealthCell(
        project.resourceDemand ?? "—",
        getPriorityClass(project.resourceDemand),
      ),
      createHealthCell(
        project.projectStatus ?? "—",
        getStatusClass(project.projectStatus),
      ),
    );

    tbody.append(row);
  });

  table.append(
    thead,
    tbody,
  );
  wrap.append(table);
  figure.append(
    wrap,
    caption,
  );

  return figure;
}

function getRadarMetrics(project) {
  const completion = clamp(
    safeNumber(project.percentComplete) * 100,
    0,
    100,
  );
  const cpi = calculateProjectCpi(project);
  const spi = calculateProjectSpi(project);
  const riskScore = safeNumber(project.riskScore);

  // Visualization-only resource mapping. This is not a stored KPI
  // and not a project-management formula.
  const resourceCapacityByDemand = {
    Low: 100,
    Medium: 60,
    High: 30,
  };

  return [
    {
      label: "Completion",
      value: completion,
    },
    {
      label: "Cost Efficiency",
      value: Number.isFinite(cpi) ? clamp(cpi * 100, 0, 100) : 0,
    },
    {
      label: "Schedule Efficiency",
      value: Number.isFinite(spi) ? clamp(spi * 100, 0, 100) : 0,
    },
    {
      label: "Risk Health",
      value: 100 - clamp((riskScore / 25) * 100, 0, 100),
    },
    {
      label: "Resource Capacity",
      value: resourceCapacityByDemand[project.resourceDemand] ?? 0,
    },
  ].map((metric) => {
    return {
      ...metric,
      value: Math.round(clamp(metric.value, 0, 100)),
    };
  });
}

function getRadarPoint(index, value, radius, center) {
  const angle =
    -Math.PI / 2 + (index * 2 * Math.PI) / 5;
  const scaledRadius = radius * (value / 100);

  return {
    x: center + Math.cos(angle) * scaledRadius,
    y: center + Math.sin(angle) * scaledRadius,
  };
}

function createSvgElement(name) {
  return document.createElementNS(
    "http://www.w3.org/2000/svg",
    name,
  );
}

export function createProjectHealthRadar(project) {
  const figure = createAnalysisFigure("sf-health-radar-chart");

  if (!project) {
    figure.append(
      createChartEmptyMessage(
        "No project is available for the radar analysis.",
      ),
    );
    return figure;
  }

  const metrics = getRadarMetrics(project);
  const layout = document.createElement("div");
  const svg = createSvgElement("svg");
  const summary = document.createElement("dl");
  const center = 120;
  const radius = 78;

  layout.className = "sf-radar-layout";
  svg.classList.add("sf-radar-svg");
  svg.setAttribute("viewBox", "0 0 240 240");
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    `Project Health Radar for ${getProjectName(project)}`,
  );
  summary.className = "sf-radar-summary";

  [20, 40, 60, 80, 100].forEach((ringValue) => {
    const points = metrics.map((_, index) => {
      const point = getRadarPoint(
        index,
        ringValue,
        radius,
        center,
      );

      return `${point.x},${point.y}`;
    });
    const polygon = createSvgElement("polygon");

    polygon.setAttribute("points", points.join(" "));
    polygon.classList.add("sf-radar-grid");
    svg.append(polygon);
  });

  metrics.forEach((metric, index) => {
    const axisEnd = getRadarPoint(index, 100, radius, center);
    const labelPoint = getRadarPoint(index, 118, radius, center);
    const line = createSvgElement("line");
    const label = createSvgElement("text");

    line.setAttribute("x1", String(center));
    line.setAttribute("y1", String(center));
    line.setAttribute("x2", String(axisEnd.x));
    line.setAttribute("y2", String(axisEnd.y));
    line.classList.add("sf-radar-axis");

    label.setAttribute("x", String(labelPoint.x));
    label.setAttribute("y", String(labelPoint.y));
    label.classList.add("sf-radar-label");
    label.textContent = metric.label;

    svg.append(
      line,
      label,
    );
  });

  const dataPoints = metrics.map((metric, index) => {
    return getRadarPoint(
      index,
      metric.value,
      radius,
      center,
    );
  });
  const polygon = createSvgElement("polygon");

  polygon.setAttribute(
    "points",
    dataPoints.map((point) => `${point.x},${point.y}`).join(" "),
  );
  polygon.classList.add("sf-radar-polygon");
  svg.append(polygon);

  dataPoints.forEach((point) => {
    const dot = createSvgElement("circle");

    dot.setAttribute("cx", String(point.x));
    dot.setAttribute("cy", String(point.y));
    dot.setAttribute("r", "3.5");
    dot.classList.add("sf-radar-point");
    svg.append(dot);
  });

  metrics.forEach((metric) => {
    const term = document.createElement("dt");
    const description = document.createElement("dd");

    term.textContent = metric.label;
    description.textContent = String(metric.value);

    summary.append(
      term,
      description,
    );
  });

  layout.append(
    svg,
    summary,
  );
  figure.append(layout);

  return figure;
}

/*
 * ---------------------------------------------------------
 * PORTFOLIO FORECAST
 * ---------------------------------------------------------
 * Compares the approved portfolio budget (BAC) against the
 * projected final cost (EAC) using a common scale.
 * ---------------------------------------------------------
 */
export function createPortfolioForecastChart(forecast) {
  const figure = document.createElement("figure");
  const chart = document.createElement("div");
  const caption = document.createElement("figcaption");

  figure.classList.add(
    "sf-chart",
    "sf-portfolio-forecast-chart",
  );

  chart.classList.add(
    "sf-forecast-bars",
  );

  caption.classList.add(
    "sf-chart-caption",
  );

  caption.textContent =
    "Projected final cost assumes current portfolio cost efficiency continues.";

  const bac = forecast.bac;
  const eac = forecast.eac;

  const hasBac = Number.isFinite(bac);
  const hasEac = Number.isFinite(eac);

  const validValues = [];
  if (hasBac) {
    validValues.push(bac);
  }
  if (hasEac) {
    validValues.push(eac);
  }

  const maximumValue =
    validValues.length > 0
      ? Math.max(...validValues, 1)
      : 1;

  const rows = [
    {
      label: "Approved Budget (BAC)",
      value: bac,
      hasValue: hasBac,
      fillClass: "sf-forecast-fill--bac",
    },
    {
      label: "Projected Final Cost (EAC)",
      value: eac,
      hasValue: hasEac,
      fillClass:
        hasBac && hasEac && eac > bac
          ? "sf-forecast-fill--unfavorable"
          : "sf-forecast-fill--favorable",
    },
  ];

  rows.forEach((row) => {
    const rowEl = document.createElement("div");
    const heading = document.createElement("div");
    const label = document.createElement("span");
    const value = document.createElement("strong");
    const track = document.createElement("div");
    const fill = document.createElement("div");

    rowEl.classList.add(
      "sf-forecast-row",
    );

    heading.classList.add(
      "sf-forecast-heading",
    );

    label.classList.add(
      "sf-forecast-label",
    );

    value.classList.add(
      "sf-forecast-value",
    );

    track.classList.add(
      "sf-forecast-track",
    );

    fill.classList.add(
      "sf-forecast-fill",
      row.fillClass,
    );

    label.textContent = row.label;

    if (row.hasValue) {
      value.textContent = formatCurrency(row.value);
      const percentage =
        (row.value / maximumValue) * 100;
      fill.style.width =
        `${Math.max(percentage, 0)}%`;
      fill.setAttribute(
        "aria-label",
        `${row.label}: ${formatCurrency(row.value)}`,
      );
    } else {
      value.textContent = "—";
      fill.style.width = "0%";
      fill.setAttribute("aria-hidden", "true");
    }

    heading.append(
      label,
      value,
    );

    track.append(fill);

    rowEl.append(
      heading,
      track,
    );

    chart.append(rowEl);
  });

  figure.append(
    chart,
    caption,
  );

  return figure;
}

export function createPortfolioEvmPerformanceChart(summary) {
  const figure = document.createElement("figure");
  const chart = document.createElement("div");
  const caption = document.createElement("figcaption");

  figure.classList.add("sf-chart", "sf-evm-performance-chart");
  chart.classList.add("sf-evm-chart");
  caption.classList.add("sf-chart-caption");

  const {
    warningIndex,
    targetIndex,
  } = APP_CONFIG.portfolio.performanceThresholds;

  caption.textContent =
    `A performance index of ${targetIndex.toFixed(2)} represents the portfolio efficiency baseline.`;

  // Common visual scale limits
  const SCALE_MAX = 1.2;
  const TARGET = targetIndex;
  const TARGET_PCT = (TARGET / SCALE_MAX) * 100; // ~83.3333

  function renderRow(labelText, value) {
    const row = document.createElement("div");
    const heading = document.createElement("div");
    const label = document.createElement("span");
    const valEl = document.createElement("strong");
    const track = document.createElement("div");
    const fill = document.createElement("div");
    const target = document.createElement("div");

    row.classList.add("sf-evm-row");
    heading.classList.add("sf-evm-heading");
    label.classList.add("sf-evm-label");
    valEl.classList.add("sf-evm-value");
    track.classList.add("sf-evm-track");
    fill.classList.add("sf-evm-fill");
    target.classList.add("sf-evm-target");

    // Label and value
    label.textContent = labelText;

    const hasNumber = typeof value === "number" && !Number.isNaN(value);

    if (!hasNumber) {
      valEl.textContent = "—";
    } else {
      valEl.textContent = value.toFixed(2);
    }

    // Performance fill: clamp for visual only
    if (hasNumber) {
      const clamped = Math.min(Math.max(value, 0), SCALE_MAX);
      const pct = (clamped / SCALE_MAX) * 100;

      fill.style.width = `${pct}%`;

      // Semantics classes
      if (value < warningIndex) {
        fill.classList.add("sf-evm-fill--danger");
      } else if (value < targetIndex) {
        fill.classList.add("sf-evm-fill--warning");
      } else {
        fill.classList.add("sf-evm-fill--success");
      }

      fill.setAttribute(
        "aria-label",
        `${labelText}: ${value.toFixed(2)} (performance)`,
      );
    } else {
      // no fill when value is null
      fill.style.width = "0%";
      fill.setAttribute("aria-hidden", "true");
    }

    // Target marker position (visual only)
    target.style.left = `${TARGET_PCT}%`;
    target.setAttribute("role", "img");
    target.setAttribute(
      "aria-label",
      `Target ${TARGET.toFixed(2)}`,
    );

    // Compose
    heading.append(label, valEl);
    track.append(fill, target);
    row.append(heading, track);

    // Accessibility: describe the metric
    const desc = hasNumber
      ? `${labelText}: ${value.toFixed(2)}. Target ${targetIndex.toFixed(2)}.`
      : `${labelText}: no data available.`;

    row.setAttribute("aria-label", desc);

    return row;
  }

  // CPI row
  const cpiRow = renderRow("Cost Performance Index (CPI)", summary.cpi);

  // SPI row
  const spiRow = renderRow("Schedule Performance Index (SPI)", summary.spi);

  chart.append(cpiRow, spiRow);

  figure.append(chart, caption);

  return figure;
}

export function createProjectVarianceChart(data) {
  const figure = document.createElement("figure");
  const chart = document.createElement("div");
  const caption = document.createElement("figcaption");
  const legend = document.createElement("div");

  figure.classList.add("sf-chart", "sf-variance-chart");
  chart.classList.add("sf-variance-bars");
  caption.classList.add("sf-chart-caption");
  legend.classList.add("sf-variance-legend");

  caption.textContent =
    "Negative variance indicates unfavorable performance; positive variance indicates favorable performance.";

  // Legend
  const legendItems = [
    { label: "Cost Variance (CV)", className: "sf-variance-bar--cv" },
    { label: "Schedule Variance (SV)", className: "sf-variance-bar--sv" },
  ];

  legendItems.forEach((item) => {
    const el = document.createElement("span");
    el.classList.add("sf-chart-legend-item");
    const marker = document.createElement("span");
    marker.classList.add("sf-chart-legend-marker", item.className);
    el.append(marker, document.createTextNode(item.label));
    legend.append(el);
  });

  // Compute common absolute scale
  const maxAbs = Math.max(
    ...data.flatMap((item) => [Math.abs(item.cv || 0), Math.abs(item.sv || 0)]),
    1,
  );

  data.forEach((item) => {
    const row = document.createElement("div");
    const project = document.createElement("div");
    const trackWrap = document.createElement("div");
    const track = document.createElement("div");
    const zero = document.createElement("div");
    const cvBar = document.createElement("div");
    const svBar = document.createElement("div");
    const values = document.createElement("div");
    const cvVal = document.createElement("span");
    const svVal = document.createElement("span");

    row.classList.add("sf-variance-row");
    project.classList.add("sf-variance-project");
    trackWrap.classList.add("sf-variance-track");
    track.classList.add("sf-variance-track-inner");
    zero.classList.add("sf-variance-zero");
    cvBar.classList.add("sf-variance-bar", "sf-variance-bar--cv");
    svBar.classList.add("sf-variance-bar", "sf-variance-bar--sv");
    values.classList.add("sf-variance-value");

    // Project name
    project.textContent = item.projectName || item.projectId || "Unnamed";

    // Values text using formatCurrency
    const hasCv = typeof item.cv === "number" && !Number.isNaN(item.cv);
    const hasSv = typeof item.sv === "number" && !Number.isNaN(item.sv);

    cvVal.textContent = hasCv ? formatCurrency(item.cv) : "—";
    svVal.textContent = hasSv ? formatCurrency(item.sv) : "—";

    // Position bars relative to zero at 50%
    // Calculate visual width as proportion of maxAbs, mapped to 50% each side
    function barGeometry(value) {
      const abs = Math.min(Math.abs(value || 0), maxAbs);
      const widthPct = (abs / maxAbs) * 50; // max 50% to either side
      if (value >= 0) {
        return { left: 50, width: widthPct };
      }
      return { left: 50 - widthPct, width: widthPct };
    }

    if (hasCv) {
      const geo = barGeometry(item.cv);
      cvBar.style.left = `${geo.left}%`;
      cvBar.style.width = `${geo.width}%`;
      cvBar.setAttribute("aria-label", `CV: ${formatCurrency(item.cv)}`);
    } else {
      cvBar.setAttribute("aria-hidden", "true");
    }

    if (hasSv) {
      const geo = barGeometry(item.sv);
      svBar.style.left = `${geo.left}%`;
      svBar.style.width = `${geo.width}%`;
      svBar.setAttribute("aria-label", `SV: ${formatCurrency(item.sv)}`);
    } else {
      svBar.setAttribute("aria-hidden", "true");
    }

    // Accessibility label for the row
    const rowDesc = `${project.textContent}: CV ${hasCv ? formatCurrency(item.cv) : "—"}, SV ${hasSv ? formatCurrency(item.sv) : "—"}`;
    row.setAttribute("aria-label", rowDesc);

    // Assemble elements
    track.append(zero, cvBar, svBar);
    trackWrap.append(track);
    values.append(cvVal, document.createTextNode(" "), svVal);

    row.append(project, trackWrap, values);

    chart.append(row);
  });

  figure.append(legend, chart, caption);

  return figure;
}

/*
 * ---------------------------------------------------------
 * PROJECT FORECAST ANALYSIS
 * ---------------------------------------------------------
 * Compares each project's approved budget (BAC) against its
 * projected final cost (EAC) using a common scale.
 * ---------------------------------------------------------
 */
export function createProjectForecastAnalysisChart(data) {
  const projects = Array.isArray(data) ? data : [];

  const figure = document.createElement("figure");
  const legend = document.createElement("div");
  const chart = document.createElement("div");
  const caption = document.createElement("figcaption");

  figure.classList.add(
    "sf-chart",
    "sf-project-forecast-chart",
  );

  legend.classList.add(
    "sf-project-forecast-legend",
  );

  chart.classList.add(
    "sf-project-forecast-rows",
  );

  caption.classList.add(
    "sf-chart-caption",
  );

  caption.textContent =
    "Projected final cost above approved budget indicates forecast budget exposure.";

  /* Legend */
  const legendItems = [
    {
      label: "Approved Budget (BAC)",
      className: "sf-project-forecast-marker--bac",
    },
    {
      label: "Projected Final Cost (EAC)",
      className: "sf-project-forecast-marker--eac",
    },
  ];

  legendItems.forEach((item) => {
    const legendItem = document.createElement("span");
    const marker = document.createElement("span");

    legendItem.classList.add(
      "sf-chart-legend-item",
    );

    marker.classList.add(
      "sf-chart-legend-marker",
      item.className,
    );

    legendItem.append(
      marker,
      document.createTextNode(item.label),
    );

    legend.append(legendItem);
  });

  /* Common scale across all projects using all valid BAC and EAC values */
  const validValues = projects.flatMap((item) => {
    const values = [];

    if (Number.isFinite(item.bac)) {
      values.push(item.bac);
    }

    if (Number.isFinite(item.eac)) {
      values.push(item.eac);
    }

    return values;
  });

  const maximumValue =
    validValues.length > 0
      ? Math.max(...validValues, 1)
      : 1;

  projects.forEach((item) => {
    const row = document.createElement("div");
    const name = document.createElement("div");
    const trackWrap = document.createElement("div");
    const track = document.createElement("div");
    const bacBar = document.createElement("div");
    const eacBar = document.createElement("div");
    const values = document.createElement("div");
    const bacVal = document.createElement("span");
    const eacVal = document.createElement("span");

    row.classList.add(
      "sf-project-forecast-row",
    );

    name.classList.add(
      "sf-project-forecast-name",
    );

    trackWrap.classList.add(
      "sf-project-forecast-track",
    );

    track.classList.add(
      "sf-project-forecast-track-inner",
    );

    bacBar.classList.add(
      "sf-project-forecast-bar",
      "sf-project-forecast-bar--bac",
    );

    eacBar.classList.add(
      "sf-project-forecast-bar",
      "sf-project-forecast-bar--eac",
    );

    values.classList.add(
      "sf-project-forecast-values",
    );

    name.textContent =
      item.projectName || item.projectId || "Unnamed";

    const hasBac = Number.isFinite(item.bac);
    const hasEac = Number.isFinite(item.eac);

    /* BAC value and bar */
    if (hasBac) {
      bacVal.textContent =
        formatCurrency(item.bac);

      bacBar.style.width =
        `${Math.max((item.bac / maximumValue) * 100, 0)}%`;

      bacBar.setAttribute(
        "aria-label",
        `Approved Budget (BAC): ${formatCurrency(item.bac)}`,
      );
    } else {
      bacVal.textContent = "—";
      bacBar.style.width = "0%";
      bacBar.setAttribute("aria-hidden", "true");
    }

    /* EAC value and bar */
    if (hasEac) {
      eacVal.textContent =
        formatCurrency(item.eac);

      eacBar.style.width =
        `${Math.max((item.eac / maximumValue) * 100, 0)}%`;

      eacBar.setAttribute(
        "aria-label",
        `Projected Final Cost (EAC): ${formatCurrency(item.eac)}`,
      );

      /* Semantic class based on budget position */
      if (hasBac) {
        if (item.eac > item.bac) {
          eacBar.classList.add(
            "sf-project-forecast-bar--unfavorable",
          );
        } else {
          eacBar.classList.add(
            "sf-project-forecast-bar--favorable",
          );
        }
      }
    } else {
      eacVal.textContent = "—";
      eacBar.style.width = "0%";
      eacBar.setAttribute("aria-hidden", "true");
    }

    /* Accessibility label for the row */
    const rowDesc =
      `${name.textContent}: ` +
      `BAC ${hasBac ? formatCurrency(item.bac) : "—"}, ` +
      `EAC ${hasEac ? formatCurrency(item.eac) : "—"}`;

    row.setAttribute(
      "aria-label",
      rowDesc,
    );

    values.append(
      bacVal,
      document.createTextNode(" "),
      eacVal,
    );

    track.append(
      bacBar,
      eacBar,
    );

    trackWrap.append(track);

    row.append(
      name,
      trackWrap,
      values,
    );

    chart.append(row);
  });

  figure.append(
    legend,
    chart,
    caption,
  );

  return figure;
}
