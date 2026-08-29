import { formatCurrency } from "./formatters.js";

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

  caption.textContent =
    "A performance index of 1.00 represents the portfolio efficiency baseline.";

  // Common visual scale limits
  const SCALE_MAX = 1.2;
  const TARGET = 1.0;
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
      if (value < 0.9) {
        fill.classList.add("sf-evm-fill--danger");
      } else if (value < 1.0) {
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
      ? `${labelText}: ${value.toFixed(2)}. Target 1.00.`
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
