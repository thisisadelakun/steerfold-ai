import {
  getPortfolioStatusSummary,
  getPortfolioFinancialSummary,
  calculatePortfolioEvmSummary,
  calculatePortfolioForecast,
  getPriorityRecommendations,
} from "./portfolio-analytics.js";

import {
  formatCurrency,
} from "./formatters.js";

import { APP_CONFIG } from "./app-config.js";

const STAKEHOLDER_AUDIENCES = [
  {
    key: "executive",
    label: "Executive",
    description:
      "Portfolio-level performance, exposure and strategic attention.",
  },
  {
    key: "sponsor",
    label: "Sponsor",
    description:
      "Project health, forecast confidence and decisions requiring sponsorship.",
    placeholders: [
      "Sponsor key signals will appear here.",
      "Audience-specific performance view.",
      "Priority attention and decision signals.",
      "Supporting project detail.",
    ],
  },
  {
    key: "team",
    label: "Team",
    description:
      "Delivery progress, risks, resource pressure and immediate actions.",
    placeholders: [
      "Team key signals will appear here.",
      "Audience-specific performance view.",
      "Priority attention and decision signals.",
      "Supporting delivery detail.",
    ],
  },
];

const DASHBOARD_SECTIONS = [
  "Key Signals",
  "Performance Overview",
  "Attention & Decisions",
  "Supporting Detail",
];

const STATUS_SEGMENTS = [
  {
    key: "onTrack",
    label: "On Track",
    className: "sf-exec-status--success",
  },
  {
    key: "atRisk",
    label: "At Risk",
    className: "sf-exec-status--warning",
  },
  {
    key: "critical",
    label: "Critical",
    className: "sf-exec-status--danger",
  },
];

const PRIORITY_SEGMENTS = [
  {
    key: "High",
    label: "High",
    className: "sf-exec-priority--high",
  },
  {
    key: "Medium",
    label: "Medium",
    className: "sf-exec-priority--medium",
  },
  {
    key: "Low",
    label: "Low",
    className: "sf-exec-priority--low",
  },
];

let selectedAudienceKey = "executive";
let currentProjects = [];

function getSelectedAudience() {
  return (
    STAKEHOLDER_AUDIENCES.find((audience) => {
      return audience.key === selectedAudienceKey;
    }) ?? STAKEHOLDER_AUDIENCES[0]
  );
}

function asProjectList(projects) {
  return Array.isArray(projects) ? projects : [];
}

function formatIndex(value) {
  return Number.isFinite(value) ? value.toFixed(2) : "—";
}

function getPerformanceClass(value) {
  const { warningIndex, targetIndex } =
    APP_CONFIG.portfolio.performanceThresholds;

  if (!Number.isFinite(value)) {
    return "";
  }

  if (value < warningIndex) {
    return "sf-exec-kpi--danger";
  }

  if (value < targetIndex) {
    return "sf-exec-kpi--warning";
  }

  return "sf-exec-kpi--success";
}

function getCombinedPerformanceClass(cpi, spi) {
  const classes = [
    getPerformanceClass(cpi),
    getPerformanceClass(spi),
  ];

  if (classes.includes("sf-exec-kpi--danger")) {
    return "sf-exec-kpi--danger";
  }

  if (classes.includes("sf-exec-kpi--warning")) {
    return "sf-exec-kpi--warning";
  }

  if (classes.includes("sf-exec-kpi--success")) {
    return "sf-exec-kpi--success";
  }

  return "";
}

function getNeedsAttentionClass(statusSummary) {
  if (statusSummary.critical > 0) {
    return "sf-exec-kpi--danger";
  }

  if (statusSummary.atRisk > 0) {
    return "sf-exec-kpi--warning";
  }

  return "sf-exec-kpi--success";
}

function getVacLanguage(vac) {
  if (!Number.isFinite(vac)) {
    return "Forecast variance is unavailable.";
  }

  if (vac > 0) {
    return "Forecast under budget.";
  }

  if (vac < 0) {
    return "Forecast over budget.";
  }

  return "Forecast on budget.";
}

function createAudienceSelector(container) {
  const selector = document.createElement("div");

  selector.className = "sf-stakeholder-selector";
  selector.setAttribute("role", "group");
  selector.setAttribute(
    "aria-label",
    "Stakeholder audience",
  );

  STAKEHOLDER_AUDIENCES.forEach((audience) => {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "sf-stakeholder-tab";
    button.dataset.audience = audience.key;
    button.textContent = audience.label;

    button.addEventListener("click", () => {
      selectedAudienceKey = audience.key;
      updateStakeholderView(container);
    });

    selector.append(button);
  });

  return selector;
}

function createDescriptor() {
  const wrapper = document.createElement("div");
  const label = document.createElement("span");
  const descriptor = document.createElement("p");

  wrapper.className = "sf-stakeholder-audience";

  label.className = "sf-stakeholder-context-label";
  label.textContent = "Executive Portfolio Brief";

  descriptor.className = "sf-stakeholder-audience-copy";
  descriptor.setAttribute("aria-live", "polite");

  wrapper.append(
    label,
    descriptor,
  );

  return wrapper;
}

function createDashboardShell() {
  const dashboard = document.createElement("div");

  dashboard.className = "sf-stakeholder-dashboard";

  DASHBOARD_SECTIONS.forEach((sectionTitle, index) => {
    const section = document.createElement("section");
    const heading = document.createElement("h2");
    const content = document.createElement("div");

    section.className = "sf-stakeholder-card";
    section.setAttribute("aria-labelledby", `stakeholder-section-${index}`);
    section.dataset.stakeholderSection = sectionTitle;

    heading.id = `stakeholder-section-${index}`;
    heading.textContent = sectionTitle;

    content.className = "sf-stakeholder-section-content";

    section.append(
      heading,
      content,
    );
    dashboard.append(section);
  });

  return dashboard;
}

function createKpiCard({
  label,
  value,
  support,
  className = "",
}) {
  const card = document.createElement("article");
  const labelElement = document.createElement("span");
  const valueElement = document.createElement("strong");
  const supportElement = document.createElement("span");

  card.className = "sf-exec-kpi";

  if (className) {
    card.classList.add(className);
  }

  labelElement.className = "sf-exec-kpi-label";
  labelElement.textContent = label;

  valueElement.className = "sf-exec-kpi-value";

  if (value instanceof Node) {
    valueElement.append(value);
  } else {
    valueElement.textContent = value;
  }

  supportElement.className = "sf-exec-kpi-support";
  supportElement.textContent = support;

  card.append(
    labelElement,
    valueElement,
    supportElement,
  );

  return card;
}

function renderExecutiveKeySignals(container, projects) {
  const financialSummary =
    getPortfolioFinancialSummary(projects);
  const evmSummary =
    calculatePortfolioEvmSummary(projects);
  const forecast =
    calculatePortfolioForecast(projects);
  const statusSummary =
    getPortfolioStatusSummary(projects);
  const performanceValue = document.createElement("span");

  performanceValue.className = "sf-exec-performance-pair";
  performanceValue.append(
    document.createTextNode(`CPI ${formatIndex(evmSummary.cpi)}`),
    document.createElement("br"),
    document.createTextNode(`SPI ${formatIndex(evmSummary.spi)}`),
  );

  container.className =
    "sf-stakeholder-section-content sf-exec-kpi-grid";
  container.replaceChildren(
    createKpiCard({
      label: "Portfolio Budget",
      value: formatCurrency(financialSummary.totalBAC),
      support: "Total approved project budget.",
    }),
    createKpiCard({
      label: "Forecast at Completion",
      value: Number.isFinite(forecast.eac)
        ? formatCurrency(forecast.eac)
        : "—",
      support: "Projected final portfolio cost.",
      className:
        Number.isFinite(forecast.vac)
          ? forecast.vac < 0
            ? "sf-exec-kpi--danger"
            : "sf-exec-kpi--success"
          : "",
    }),
    createKpiCard({
      label: "Portfolio Performance",
      value: performanceValue,
      support: "Cost and schedule efficiency.",
      className: getCombinedPerformanceClass(
        evmSummary.cpi,
        evmSummary.spi,
      ),
    }),
    createKpiCard({
      label: "Needs Attention",
      value: String(statusSummary.atRisk + statusSummary.critical),
      support:
        `${statusSummary.atRisk} At Risk · ${statusSummary.critical} Critical`,
      className: getNeedsAttentionClass(statusSummary),
    }),
  );
}

function createRingChart({
  title,
  total,
  segments,
  className,
}) {
  const figure = document.createElement("figure");
  const svg = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  const track = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "circle",
  );
  const valueGroup = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "g",
  );
  const center = document.createElement("div");
  const centerValue = document.createElement("strong");
  const centerLabel = document.createElement("span");
  const legend = document.createElement("ul");
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  figure.className = `sf-exec-ring ${className}`;

  svg.setAttribute("viewBox", "0 0 120 120");
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    `${title}: ${segments.map((segment) => {
      return `${segment.label} ${segment.value}`;
    }).join(", ")}`,
  );

  track.setAttribute("cx", "60");
  track.setAttribute("cy", "60");
  track.setAttribute("r", String(radius));
  track.setAttribute("pathLength", "100");
  track.classList.add("sf-exec-ring-track");

  segments.forEach((segment) => {
    const circle = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "circle",
    );
    const percentage =
      total > 0 ? (segment.value / total) * 100 : 0;

    circle.setAttribute("cx", "60");
    circle.setAttribute("cy", "60");
    circle.setAttribute("r", String(radius));
    circle.setAttribute("pathLength", "100");
    circle.setAttribute(
      "stroke-dasharray",
      `${percentage} ${100 - percentage}`,
    );
    circle.setAttribute(
      "stroke-dashoffset",
      String(-offset),
    );
    circle.classList.add(
      "sf-exec-ring-segment",
      segment.className,
    );

    offset += percentage;
    valueGroup.append(circle);
  });

  center.className = "sf-exec-ring-center";
  centerValue.textContent = String(total);
  centerLabel.textContent = total === 1 ? "project" : "projects";
  center.append(
    centerValue,
    centerLabel,
  );

  legend.className = "sf-exec-ring-legend";

  segments.forEach((segment) => {
    const item = document.createElement("li");
    const marker = document.createElement("span");
    const label = document.createElement("span");

    marker.className = `sf-exec-ring-marker ${segment.className}`;
    marker.setAttribute("aria-hidden", "true");
    label.textContent = `${segment.label}: ${segment.value}`;

    item.append(
      marker,
      label,
    );
    legend.append(item);
  });

  svg.append(
    track,
    valueGroup,
  );
  figure.append(
    svg,
    center,
    legend,
  );

  return figure;
}

function createFinancialOutlook(projects) {
  const financialSummary =
    getPortfolioFinancialSummary(projects);
  const forecast =
    calculatePortfolioForecast(projects);
  const values = [
    financialSummary.totalBAC,
    forecast.eac,
    forecast.vac,
  ].filter(Number.isFinite);
  const maxValue = Math.max(
    ...values.map((value) => Math.abs(value)),
    1,
  );
  const rows = [
    {
      label: "Approved Budget (BAC)",
      value: financialSummary.totalBAC,
      className: "sf-exec-bar--accent",
    },
    {
      label: "Forecast Cost (EAC)",
      value: forecast.eac,
      className:
        Number.isFinite(forecast.vac) && forecast.vac < 0
          ? "sf-exec-bar--danger"
          : "sf-exec-bar--success",
    },
    {
      label: "Forecast Variance (VAC)",
      value: forecast.vac,
      className:
        Number.isFinite(forecast.vac) && forecast.vac < 0
          ? "sf-exec-bar--danger"
          : "sf-exec-bar--success",
    },
  ];
  const wrapper = document.createElement("div");
  const heading = document.createElement("h3");
  const rowList = document.createElement("div");
  const outlook = document.createElement("p");

  wrapper.className = "sf-exec-financial-outlook";
  heading.textContent = "Financial Outlook";
  rowList.className = "sf-exec-financial-bars";
  outlook.className = "sf-exec-outlook-note";
  outlook.textContent = getVacLanguage(forecast.vac);

  rows.forEach((row) => {
    const item = document.createElement("div");
    const label = document.createElement("span");
    const value = document.createElement("strong");
    const track = document.createElement("span");
    const bar = document.createElement("span");
    const numericValue =
      Number.isFinite(row.value) ? row.value : null;
    const width =
      numericValue === null
        ? 0
        : Math.max(4, Math.abs(numericValue) / maxValue * 100);

    item.className = "sf-exec-financial-row";
    label.textContent = row.label;
    value.textContent =
      numericValue === null ? "—" : formatCurrency(numericValue);
    track.className = "sf-exec-bar-track";
    bar.className = `sf-exec-bar ${row.className}`;
    bar.style.width = `${width}%`;

    track.append(bar);
    item.append(
      label,
      value,
      track,
    );
    rowList.append(item);
  });

  wrapper.append(
    heading,
    rowList,
    outlook,
  );

  return wrapper;
}

function renderExecutivePerformance(container, projects) {
  const statusSummary =
    getPortfolioStatusSummary(projects);
  const total = statusSummary.totalProjects;
  const health = document.createElement("div");
  const healthTitle = document.createElement("h3");
  const ring = createRingChart({
    title: "Portfolio Health",
    total,
    segments: STATUS_SEGMENTS.map((segment) => ({
      ...segment,
      value: statusSummary[segment.key],
    })),
    className: "sf-exec-health-ring",
  });

  container.className =
    "sf-stakeholder-section-content sf-exec-performance-grid";
  health.className = "sf-exec-health";
  healthTitle.textContent = "Portfolio Health";
  health.append(
    healthTitle,
    ring,
  );

  container.replaceChildren(
    health,
    createFinancialOutlook(projects),
  );
}

function getAttentionReason(recommendation) {
  const details = [];

  if (recommendation.projectStatus === "Critical") {
    details.push("Critical status");
  } else if (recommendation.projectStatus === "At Risk") {
    details.push("At Risk status");
  } else if (recommendation.priorityLevel === "Critical") {
    details.push("Critical management priority");
  }

  if (Number.isFinite(recommendation.riskScore)) {
    details.push(`risk score ${recommendation.riskScore}/25`);
  }

  if (
    Number.isFinite(recommendation.cpi) ||
    Number.isFinite(recommendation.spi)
  ) {
    details.push(
      `CPI ${formatIndex(recommendation.cpi)} and SPI ${formatIndex(recommendation.spi)}`,
    );
  }

  if (Number.isFinite(recommendation.vac) && recommendation.vac < 0) {
    details.push("forecast cost exceeds approved budget");
  }

  if (details.length === 0) {
    return "Project signals require management review.";
  }

  return `${details.join(" with ")}.`;
}

function getAttentionAction(recommendation) {
  const thresholds =
    APP_CONFIG.portfolio.performanceThresholds;
  const decisionThresholds =
    APP_CONFIG.portfolio.decisionThresholds;
  const hasWeakCostAndSchedule =
    Number.isFinite(recommendation.cpi) &&
    Number.isFinite(recommendation.spi) &&
    recommendation.cpi < thresholds.targetIndex &&
    recommendation.spi < thresholds.targetIndex;

  if (
    recommendation.projectStatus === "Critical" ||
    recommendation.priorityLevel === "Critical"
  ) {
    return "Escalate for executive review and confirm the recovery plan.";
  }

  if (hasWeakCostAndSchedule) {
    return "Review recovery actions and forecast assumptions.";
  }

  if (Number.isFinite(recommendation.vac) && recommendation.vac < 0) {
    return "Reassess remaining cost exposure and recovery options.";
  }

  if (
    Number.isFinite(recommendation.riskScore) &&
    recommendation.riskScore >= decisionThresholds.highRiskScore
  ) {
    return "Confirm mitigation ownership and near-term decision timing.";
  }

  return recommendation.primaryAction;
}

function createAttentionItem(recommendation) {
  const item = document.createElement("article");
  const header = document.createElement("div");
  const title = document.createElement("h3");
  const status = document.createElement("span");
  const reason = document.createElement("p");
  const action = document.createElement("p");

  item.className = "sf-exec-attention-item";
  header.className = "sf-exec-attention-header";
  title.textContent = recommendation.projectName;
  status.className =
    `sf-exec-status-chip sf-exec-status-chip--${String(recommendation.projectStatus).toLowerCase().replace(/\s+/g, "-")}`;
  status.textContent =
    recommendation.projectStatus ?? recommendation.priorityLevel;
  reason.className = "sf-exec-attention-reason";
  reason.textContent = getAttentionReason(recommendation);
  action.className = "sf-exec-attention-action";
  action.textContent = getAttentionAction(recommendation);

  header.append(
    title,
    status,
  );
  item.append(
    header,
    reason,
    action,
  );

  return item;
}

function renderExecutiveAttention(container, projects) {
  const statusSummary =
    getPortfolioStatusSummary(projects);
  const recommendations =
    getPriorityRecommendations(projects)
      .slice(0, 3)
      .map((recommendation) => {
        const project = projects.find((candidate) => {
          return candidate.projectId === recommendation.projectId;
        });

        return {
          ...recommendation,
          projectStatus: project?.projectStatus,
        };
      });
  const attentionCount =
    statusSummary.atRisk + statusSummary.critical;
  const summary = document.createElement("p");
  const list = document.createElement("div");

  container.className =
    "sf-stakeholder-section-content sf-exec-attention";
  summary.className = "sf-exec-management-summary";
  list.className = "sf-exec-attention-list";

  summary.textContent =
    attentionCount > 0
      ? `${attentionCount} of ${statusSummary.totalProjects} projects require management attention, including ${statusSummary.critical} Critical ${statusSummary.critical === 1 ? "project" : "projects"}.`
      : "Portfolio status is currently within management tolerance.";

  if (recommendations.length === 0) {
    const empty = document.createElement("p");

    empty.className = "sf-stakeholder-placeholder";
    empty.textContent =
      "No executive attention items are currently flagged.";
    list.append(empty);
  } else {
    recommendations.forEach((recommendation) => {
      list.append(createAttentionItem(recommendation));
    });
  }

  container.replaceChildren(
    summary,
    list,
  );
}

function getPrioritySummary(projects) {
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

  return counts;
}

function renderExecutiveSupportingDetail(container, projects) {
  const counts = getPrioritySummary(projects);
  const total = projects.length;
  const highCount = counts.High;
  const mix = createRingChart({
    title: "Strategic Portfolio Mix",
    total,
    segments: PRIORITY_SEGMENTS.map((segment) => ({
      ...segment,
      value: counts[segment.key],
    })),
    className: "sf-exec-priority-ring",
  });
  const details = document.createElement("div");
  const heading = document.createElement("h3");
  const summary = document.createElement("p");
  const legend = mix.querySelector(".sf-exec-ring-legend");

  container.className =
    "sf-stakeholder-section-content sf-exec-supporting";
  details.className = "sf-exec-supporting-detail";
  heading.textContent = "Strategic Priority Mix";
  summary.className = "sf-exec-mix-summary";
  summary.textContent =
    `${highCount} of ${total} projects are currently classified as High priority.`;

  details.append(heading);

  if (legend) {
    details.append(legend);
  }

  details.append(summary);

  container.replaceChildren(
    mix,
    details,
  );
}

function renderExecutiveDashboard(container, projects) {
  const sections = container.querySelectorAll(
    ".sf-stakeholder-card",
  );
  const renderers = [
    renderExecutiveKeySignals,
    renderExecutivePerformance,
    renderExecutiveAttention,
    renderExecutiveSupportingDetail,
  ];

  sections.forEach((section, index) => {
    const content = section.querySelector(
      ".sf-stakeholder-section-content",
    );

    section.classList.add("sf-stakeholder-card--executive");
    renderers[index]?.(content, projects);
  });
}

function renderPlaceholderDashboard(container, selectedAudience) {
  const sections = container.querySelectorAll(
    ".sf-stakeholder-card",
  );

  sections.forEach((section, index) => {
    const content = section.querySelector(
      ".sf-stakeholder-section-content",
    );
    const placeholder = document.createElement("p");

    section.classList.remove("sf-stakeholder-card--executive");
    content.className = "sf-stakeholder-section-content";
    placeholder.className = "sf-stakeholder-placeholder";
    placeholder.textContent =
      selectedAudience.placeholders[index] ??
      "Audience-specific portfolio detail.";
    content.replaceChildren(placeholder);
  });
}

function updateStakeholderView(container) {
  const selectedAudience = getSelectedAudience();
  const buttons = container.querySelectorAll(
    ".sf-stakeholder-tab",
  );
  const label = container.querySelector(
    ".sf-stakeholder-context-label",
  );
  const descriptor = container.querySelector(
    ".sf-stakeholder-audience-copy",
  );

  buttons.forEach((button) => {
    const isSelected =
      button.dataset.audience === selectedAudience.key;

    button.classList.toggle(
      "sf-stakeholder-tab--active",
      isSelected,
    );
    button.setAttribute("aria-pressed", String(isSelected));
  });

  if (label) {
    label.hidden = selectedAudience.key !== "executive";
  }

  if (descriptor) {
    descriptor.textContent = selectedAudience.description;
  }

  if (selectedAudience.key === "executive") {
    renderExecutiveDashboard(container, currentProjects);
  } else {
    renderPlaceholderDashboard(container, selectedAudience);
  }
}

export function renderStakeholderView(
  container,
  projects = [],
) {
  if (!(container instanceof HTMLElement)) {
    return;
  }

  currentProjects = asProjectList(projects);

  if (!container.dataset.stakeholderViewInitialized) {
    const selector = createAudienceSelector(container);
    const descriptor = createDescriptor();
    const dashboard = createDashboardShell();

    container.replaceChildren(
      selector,
      descriptor,
      dashboard,
    );

    container.dataset.stakeholderViewInitialized = "true";
  }

  updateStakeholderView(container);
}
