import {
  getPortfolioStatusSummary,
  getPortfolioFinancialSummary,
  calculatePortfolioEvmSummary,
  calculatePortfolioForecast,
  calculateProjectEvm,
  calculateProjectForecast,
  calculateProjectDecisionSignals,
  getPriorityRecommendations,
} from "./portfolio-analytics.js";

import {
  formatCurrency,
  formatDate,
  formatPercent,
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

let selectedAudienceKey = "executive";
let currentProjects = [];
let selectedStakeholderProjectId = null;

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

function formatMaybeCurrency(value) {
  return Number.isFinite(value) ? formatCurrency(value) : "—";
}

function formatMaybeIndex(value) {
  return Number.isFinite(value) ? value.toFixed(2) : "—";
}

function formatMaybePercent(value) {
  return Number.isFinite(value) ? formatPercent(value) : "—";
}

function formatMaybeRiskScore(value) {
  return Number.isFinite(value) ? `${value}/25` : "—";
}

function formatProjectDate(value) {
  const stringValue = String(value ?? "");
  const isoMatch = stringValue.match(
    /^(\d{4})-(\d{2})-(\d{2})$/,
  );

  if (isoMatch) {
    const [, year, month, day] = isoMatch;

    return new Intl.DateTimeFormat(
      APP_CONFIG.portfolio.locale,
      {
        month: "short",
        day: "numeric",
        year: "numeric",
      },
    ).format(
      new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
      ),
    );
  }

  return formatDate(value);
}

function getProjectName(project) {
  return project?.projectName || project?.projectId || "Unnamed project";
}

function getStatusModifier(status) {
  const modifier = String(status ?? "")
    .toLowerCase()
    .replace(/\s+/g, "-");

  return modifier || "unknown";
}

function getSponsorDefaultProject(projects) {
  const recommendations = getPriorityRecommendations(projects);

  if (recommendations.length > 0) {
    return projects.find((project) => {
      return project.projectId === recommendations[0].projectId;
    });
  }

  return projects[0] ?? null;
}

function getSelectedStakeholderProject(projects) {
  const rememberedProject = projects.find((project) => {
    return project.projectId === selectedStakeholderProjectId;
  });

  if (rememberedProject) {
    return rememberedProject;
  }

  const defaultProject = getSponsorDefaultProject(projects);
  selectedStakeholderProjectId = defaultProject?.projectId ?? null;

  return defaultProject;
}

function createStakeholderProjectSelector(projects) {
  const control = document.createElement("div");
  const label = document.createElement("label");
  const select = document.createElement("select");
  const selectedProject = getSelectedStakeholderProject(projects);
  const selectId = "stakeholder-project";

  control.className = "sf-stakeholder-project-control";
  label.setAttribute("for", selectId);
  label.textContent = "Project";
  select.id = selectId;
  select.className = "sf-stakeholder-project-select";

  projects.forEach((project) => {
    const option = document.createElement("option");

    option.value = project.projectId;
    option.textContent = getProjectName(project);
    select.append(option);
  });

  if (selectedProject) {
    select.value = selectedProject.projectId;
  }

  select.addEventListener("change", () => {
    selectedStakeholderProjectId = select.value;
    const view = select.closest(".sf-stakeholder-view");

    if (view) {
      updateStakeholderView(view);
      view.querySelector(".sf-stakeholder-project-select")?.focus();
    }
  });

  control.append(
    label,
    select,
  );

  return control;
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

function parseProjectDateValue(value) {
  const stringValue = String(value ?? "").trim();
  const isoMatch = stringValue.match(
    /^(\d{4})-(\d{2})-(\d{2})$/,
  );
  const slashMatch = stringValue.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
  );
  let year;
  let month;
  let day;

  if (isoMatch) {
    [, year, month, day] = isoMatch.map(Number);
  } else if (slashMatch) {
    [, month, day, year] = slashMatch.map(Number);
  } else {
    return null;
  }

  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return {
    date,
    time: Date.UTC(year, month - 1, day),
  };
}

function getTimelineProjects(projects) {
  return projects.map((project) => {
    const start = parseProjectDateValue(project.startDate);
    const end = parseProjectDateValue(project.endDate);
    const hasUsableSchedule =
      start !== null &&
      end !== null &&
      end.time >= start.time;

    return {
      project,
      start,
      end,
      hasUsableSchedule,
    };
  });
}

function getTimelineRange(timelineProjects) {
  const scheduledProjects = timelineProjects.filter((item) => {
    return item.hasUsableSchedule;
  });

  if (scheduledProjects.length === 0) {
    return null;
  }

  return scheduledProjects.reduce(
    (range, item) => {
      return {
        start:
          item.start.time < range.start.time
            ? item.start
            : range.start,
        end:
          item.end.time > range.end.time
            ? item.end
            : range.end,
      };
    },
    {
      start: scheduledProjects[0].start,
      end: scheduledProjects[0].end,
    },
  );
}

function getTimelineMonths(range) {
  const months = [];
  const cursor = new Date(
    range.start.date.getFullYear(),
    range.start.date.getMonth(),
    1,
  );
  const endMonth = new Date(
    range.end.date.getFullYear(),
    range.end.date.getMonth(),
    1,
  );

  while (cursor <= endMonth) {
    months.push({
      label: new Intl.DateTimeFormat(
        APP_CONFIG.portfolio.locale,
        {
          month: "short",
        },
      ).format(cursor),
      time: Date.UTC(
        cursor.getFullYear(),
        cursor.getMonth(),
        1,
      ),
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return months;
}

function getTimelinePosition(time, range) {
  const total = Math.max(
    range.end.time - range.start.time,
    1,
  );

  return clamp(
    ((time - range.start.time) / total) * 100,
    0,
    100,
  );
}

function createTimelineMonths(range) {
  const axis = document.createElement("div");
  const year = document.createElement("span");
  const monthGrid = document.createElement("div");

  axis.className = "sf-exec-timeline-axis";
  year.className = "sf-exec-timeline-year";
  year.textContent =
    range.start.date.getFullYear() === range.end.date.getFullYear()
      ? String(range.start.date.getFullYear())
      : `${range.start.date.getFullYear()}–${range.end.date.getFullYear()}`;
  monthGrid.className = "sf-exec-timeline-months";

  getTimelineMonths(range).forEach((month) => {
    const marker = document.createElement("span");
    const position = getTimelinePosition(month.time, range);

    marker.className = "sf-exec-timeline-month";
    marker.style.left = `${position}%`;
    marker.textContent = month.label;
    monthGrid.append(marker);
  });

  axis.append(
    year,
    monthGrid,
  );

  return axis;
}

function createTimelineRow(item, range) {
  const project = item.project;
  const row = document.createElement("article");
  const projectInfo = document.createElement("div");
  const name = document.createElement("strong");
  const priority = document.createElement("span");
  const track = document.createElement("div");
  const bar = document.createElement("span");
  const status = document.createElement("span");
  const complete = document.createElement("span");
  const percent = formatMaybePercent(project.percentComplete);
  const startDate = formatProjectDate(project.startDate);
  const endDate = formatProjectDate(project.endDate);
  const statusText = project.projectStatus ?? "—";
  const priorityText = project.strategicPriority ?? "—";

  row.className = "sf-exec-timeline-row";
  projectInfo.className = "sf-exec-timeline-project";
  name.textContent = getProjectName(project);
  priority.className = "sf-exec-timeline-priority";
  priority.textContent = priorityText;
  track.className = "sf-exec-timeline-track";
  complete.className = "sf-exec-timeline-complete";
  complete.textContent = percent;
  status.className =
    `sf-exec-timeline-status sf-exec-timeline-status--${getStatusModifier(project.projectStatus)}`;
  status.textContent = statusText;

  row.setAttribute(
    "aria-label",
    `${getProjectName(project)}: ${startDate} to ${endDate}, status ${statusText}, ${percent} complete.`,
  );

  if (item.hasUsableSchedule) {
    const left = getTimelinePosition(item.start.time, range);
    const right = getTimelinePosition(item.end.time, range);
    const width = Math.max(right - left, 1.5);

    bar.className =
      `sf-exec-timeline-bar sf-exec-timeline-bar--${getStatusModifier(project.projectStatus)}`;
    bar.style.left = `${left}%`;
    bar.style.width = `${width}%`;
    bar.title =
      `${getProjectName(project)}: ${startDate} to ${endDate}`;
  } else {
    bar.className = "sf-exec-timeline-unavailable";
    bar.textContent = "Schedule unavailable";
  }

  projectInfo.append(
    name,
    priority,
  );
  track.append(bar);
  row.append(
    projectInfo,
    track,
    status,
    complete,
  );

  return row;
}

function renderExecutiveSupportingDetail(container, projects) {
  const timelineProjects = getTimelineProjects(projects);
  const range = getTimelineRange(timelineProjects);
  const header = document.createElement("div");
  const heading = document.createElement("h3");
  const description = document.createElement("p");
  const timeline = document.createElement("div");
  const rows = document.createElement("div");

  container.className =
    "sf-stakeholder-section-content sf-exec-supporting";
  header.className = "sf-exec-timeline-header";
  heading.textContent = "Portfolio Delivery Timeline";
  description.textContent =
    "Planned delivery windows across the current project portfolio.";
  rows.className = "sf-exec-timeline-rows";

  header.append(
    heading,
    description,
  );

  if (!range) {
    const empty = document.createElement("p");

    empty.className = "sf-stakeholder-placeholder";
    empty.textContent =
      "No portfolio schedule data is currently available.";
    container.replaceChildren(
      header,
      empty,
    );
    return;
  }

  timeline.className = "sf-exec-timeline";
  timeline.setAttribute(
    "aria-label",
    `Portfolio Delivery Timeline from ${formatProjectDate(projects.find((project) => parseProjectDateValue(project.startDate)?.time === range.start.time)?.startDate)} to ${formatProjectDate(projects.find((project) => parseProjectDateValue(project.endDate)?.time === range.end.time)?.endDate)}.`,
  );

  timelineProjects.forEach((item) => {
    rows.append(createTimelineRow(item, range));
  });

  timeline.append(
    createTimelineMonths(range),
    rows,
  );

  container.replaceChildren(
    header,
    timeline,
  );
}

function createSponsorEmptyState(container) {
  const empty = document.createElement("p");

  container.className =
    "sf-stakeholder-section-content";
  empty.className = "sf-stakeholder-placeholder";
  empty.textContent =
    "No project data is currently available for Sponsor View.";
  container.replaceChildren(empty);
}

function renderSponsorKeySignals(container, project) {
  const evm = calculateProjectEvm(project);
  const progress = document.createElement("span");

  progress.className = "sf-exec-performance-pair";
  progress.textContent =
    formatMaybePercent(project.percentComplete);

  container.className =
    "sf-stakeholder-section-content sf-sponsor-kpi-grid";
  container.replaceChildren(
    createKpiCard({
      label: "Project Status",
      value: project.projectStatus ?? "—",
      support: `Risk ${formatMaybeRiskScore(project.riskScore)}`,
      className: getNeedsAttentionClass({
        critical: project.projectStatus === "Critical" ? 1 : 0,
        atRisk: project.projectStatus === "At Risk" ? 1 : 0,
      }),
    }),
    createKpiCard({
      label: "Delivery Progress",
      value: progress,
      support:
        `${formatProjectDate(project.startDate)} → ${formatProjectDate(project.endDate)}`,
    }),
    createKpiCard({
      label: "Cost Performance",
      value: formatMaybeIndex(evm.cpi),
      support: `CV ${formatMaybeCurrency(evm.cv)}`,
      className: getPerformanceClass(evm.cpi),
    }),
    createKpiCard({
      label: "Schedule Performance",
      value: formatMaybeIndex(evm.spi),
      support: `SV ${formatMaybeCurrency(evm.sv)}`,
      className: getPerformanceClass(evm.spi),
    }),
  );
}

function getSponsorRadarMetrics(project) {
  const evm = calculateProjectEvm(project);
  const completion = clamp(
    safeNumber(project.percentComplete) * 100,
    0,
    100,
  );
  const riskScore = safeNumber(project.riskScore);
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
      value: Number.isFinite(evm.cpi)
        ? clamp(evm.cpi * 100, 0, 100)
        : 0,
    },
    {
      label: "Schedule Efficiency",
      value: Number.isFinite(evm.spi)
        ? clamp(evm.spi * 100, 0, 100)
        : 0,
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

function createSponsorHealthProfile(project) {
  const wrapper = document.createElement("div");
  const heading = document.createElement("h3");
  const layout = document.createElement("div");
  const svg = createSvgElement("svg");
  const summary = document.createElement("dl");
  const metrics = getSponsorRadarMetrics(project);
  const center = 120;
  const radius = 78;

  wrapper.className = "sf-sponsor-health-profile";
  heading.textContent = "Project Health Profile";
  layout.className = "sf-sponsor-radar-layout";
  svg.classList.add("sf-sponsor-radar-svg");
  svg.setAttribute("viewBox", "0 0 240 240");
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    `Project Health Profile for ${getProjectName(project)}`,
  );
  summary.className = "sf-sponsor-radar-summary";

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
    polygon.classList.add("sf-sponsor-radar-grid");
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
    line.classList.add("sf-sponsor-radar-axis");

    label.setAttribute("x", String(labelPoint.x));
    label.setAttribute("y", String(labelPoint.y));
    label.classList.add("sf-sponsor-radar-label");
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
  polygon.classList.add("sf-sponsor-radar-polygon");
  svg.append(polygon);

  dataPoints.forEach((point) => {
    const dot = createSvgElement("circle");

    dot.setAttribute("cx", String(point.x));
    dot.setAttribute("cy", String(point.y));
    dot.setAttribute("r", "3.5");
    dot.classList.add("sf-sponsor-radar-point");
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
  wrapper.append(
    heading,
    layout,
  );

  return wrapper;
}

function getSponsorForecastLanguage(vac) {
  if (!Number.isFinite(vac)) {
    return "Forecast variance is unavailable.";
  }

  if (vac < 0) {
    return `Forecast is ${formatCurrency(Math.abs(vac))} over approved budget.`;
  }

  if (vac === 0) {
    return "Forecast is aligned with approved budget.";
  }

  return "Forecast remains within approved budget.";
}

function createSponsorFinancialForecast(project) {
  const evm = calculateProjectEvm(project);
  const forecast = calculateProjectForecast(project);
  const rawUtilization = forecast.eac / evm.bac * 100;
  const utilization =
    Number.isFinite(evm.bac) && evm.bac > 0 &&
    Number.isFinite(forecast.eac) && forecast.eac >= 0 &&
    Number.isFinite(rawUtilization)
      ? rawUtilization
      : null;
  const scaleMaximum = utilization === null
    ? 150
    : Math.max(150, Math.ceil(utilization / 25) * 25);
  const state = utilization === null
    ? "unavailable"
    : utilization > 100
      ? "over"
      : utilization >= 98
        ? "near"
        : "under";
  const stateLabel = {
    unavailable: "Forecast unavailable",
    over: "Over approved budget",
    near: "At approved budget",
    under: "Within approved budget",
  }[state];
  const percentText = utilization === null
    ? "\u2014"
    : `${new Intl.NumberFormat(APP_CONFIG.portfolio.locale, {
        maximumFractionDigits: 0,
      }).format(utilization)}%`;
  const wrapper = document.createElement("div");
  const heading = document.createElement("h3");
  const layout = document.createElement("div");
  const gauge = document.createElement("figure");
  const svg = createSvgElement("svg");
  const track = createSvgElement("path");
  const progress = createSvgElement("path");
  const marker = createSvgElement("line");
  const reading = document.createElement("div");
  const percent = document.createElement("strong");
  const metricLabel = document.createElement("span");
  const stateText = document.createElement("span");
  const axis = document.createElement("div");
  const minimum = document.createElement("span");
  const threshold = document.createElement("span");
  const maximum = document.createElement("span");
  const details = document.createElement("dl");
  const outlook = document.createElement("p");
  const markerAngle = Math.PI * (1 - 100 / scaleMaximum);
  const markerX = 140 + 120 * Math.cos(markerAngle);
  const markerY = 140 - 120 * Math.sin(markerAngle);
  const markerInnerX = 140 + 106 * Math.cos(markerAngle);
  const markerInnerY = 140 - 106 * Math.sin(markerAngle);

  wrapper.className = "sf-sponsor-financial-forecast";
  heading.textContent = "Financial Forecast";
  layout.className = "sf-sponsor-forecast-layout";
  gauge.className = `sf-sponsor-gauge sf-sponsor-gauge--${state}`;
  gauge.setAttribute("role", "img");
  gauge.setAttribute(
    "aria-label",
    `Forecast budget utilization for ${getProjectName(project)}: ${utilization === null ? "unavailable" : `${percentText} of approved budget`}. BAC ${formatMaybeCurrency(evm.bac)}. EAC ${formatMaybeCurrency(forecast.eac)}. VAC ${formatMaybeCurrency(forecast.vac)}. ${stateLabel}.`,
  );
  svg.setAttribute("viewBox", "0 0 280 155");
  svg.setAttribute("aria-hidden", "true");
  track.classList.add("sf-sponsor-gauge-track");
  progress.classList.add("sf-sponsor-gauge-progress");
  marker.classList.add("sf-sponsor-gauge-marker");
  [track, progress].forEach((arc) => {
    arc.setAttribute("d", "M 20 140 A 120 120 0 0 1 260 140");
    arc.setAttribute("pathLength", "100");
  });
  progress.setAttribute(
    "stroke-dasharray",
    `${utilization === null ? 0 : utilization / scaleMaximum * 100} 100`,
  );
  marker.setAttribute("x1", String(markerInnerX));
  marker.setAttribute("y1", String(markerInnerY));
  marker.setAttribute("x2", String(markerX));
  marker.setAttribute("y2", String(markerY));
  svg.append(track, progress, marker);
  percent.textContent = percentText;
  metricLabel.textContent = "Forecast Budget Utilization";
  stateText.className = "sf-sponsor-gauge-state";
  stateText.textContent = stateLabel;
  reading.className = "sf-sponsor-gauge-reading";
  reading.append(percent, metricLabel, stateText);
  axis.className = "sf-sponsor-gauge-axis";
  minimum.textContent = "0%";
  threshold.textContent = "100% Approved Budget";
  threshold.className = "sf-sponsor-gauge-threshold";
  maximum.textContent = `${scaleMaximum}%`;
  axis.append(minimum, threshold, maximum);
  gauge.append(svg, reading, axis);
  details.className = "sf-sponsor-forecast-details";
  outlook.className = "sf-exec-outlook-note";
  outlook.textContent = utilization === null
    ? "Forecast budget comparison is unavailable."
    : getSponsorForecastLanguage(forecast.vac);

  [
    ["Approved Budget (BAC)", evm.bac],
    ["Forecast Cost (EAC)", forecast.eac],
    ["Remaining Forecast (ETC)", forecast.etc],
    ["Forecast Variance (VAC)", forecast.vac],
  ].forEach(([label, value]) => {
    const term = document.createElement("dt");
    const description = document.createElement("dd");

    term.textContent = label;
    description.textContent = formatMaybeCurrency(value);
    details.append(term, description);
  });

  layout.append(gauge, details);
  wrapper.append(heading, layout, outlook);

  return wrapper;
}

function renderSponsorPerformance(container, project) {
  container.className =
    "sf-stakeholder-section-content sf-sponsor-performance-grid";
  container.replaceChildren(
    createSponsorHealthProfile(project),
    createSponsorFinancialForecast(project),
  );
}

function getSponsorAttentionSignals(project) {
  const signals = calculateProjectDecisionSignals(project);
  const items = [];

  if (signals.costInefficient) {
    items.push(
      `CPI ${formatMaybeIndex(signals.cpi)} indicates cost performance below target.`,
    );
  }

  if (signals.scheduleInefficient) {
    items.push(
      `SPI ${formatMaybeIndex(signals.spi)} indicates schedule performance below target.`,
    );
  }

  if (signals.highRisk) {
    items.push(`Risk score is ${formatMaybeRiskScore(project.riskScore)}.`);
  }

  if (signals.forecastOverBudget) {
    items.push(
      `Forecast cost exceeds approved budget by ${formatCurrency(Math.abs(signals.vac))}.`,
    );
  }

  if (project.resourceDemand === "High") {
    items.push("Resource demand is High.");
  }

  return items.slice(0, 3);
}

function getSponsorDecision(project) {
  const signals = calculateProjectDecisionSignals(project);

  if (project.projectStatus === "Critical" || signals.criticalRisk) {
    return "Confirm the recovery plan and executive escalation path.";
  }

  if (signals.costInefficient && signals.scheduleInefficient) {
    return "Review recovery actions and validate the latest forecast.";
  }

  if (signals.forecastOverBudget) {
    return "Review remaining cost exposure and funding tolerance.";
  }

  if (signals.highRisk) {
    return "Confirm the response plan for current risk exposure.";
  }

  return "No immediate sponsor intervention is indicated.";
}

function renderSponsorAttention(container, project) {
  const signals = getSponsorAttentionSignals(project);
  const summary = document.createElement("p");
  const signalList = document.createElement("div");
  const decision = document.createElement("article");
  const decisionLabel = document.createElement("span");
  const decisionText = document.createElement("p");

  container.className =
    "sf-stakeholder-section-content sf-sponsor-attention";
  summary.className = "sf-exec-management-summary";
  signalList.className = "sf-sponsor-signal-list";
  decision.className = "sf-sponsor-decision-card";
  decisionLabel.className = "sf-exec-kpi-label";
  decisionLabel.textContent = "Sponsor Focus";
  decisionText.textContent = getSponsorDecision(project);

  summary.textContent =
    signals.length > 0
      ? `${getProjectName(project)} has ${signals.length} current sponsor attention ${signals.length === 1 ? "signal" : "signals"}.`
      : `${getProjectName(project)} is not currently showing sponsor-level pressure signals.`;

  if (signals.length === 0) {
    const empty = document.createElement("p");

    empty.className = "sf-stakeholder-placeholder";
    empty.textContent =
      "No sponsor attention signals are currently flagged.";
    signalList.append(empty);
  } else {
    signals.forEach((signal) => {
      const item = document.createElement("article");

      item.className = "sf-sponsor-signal";
      item.textContent = signal;
      signalList.append(item);
    });
  }

  decision.append(
    decisionLabel,
    decisionText,
  );

  container.replaceChildren(
    summary,
    signalList,
    decision,
  );
}

function createSponsorContextItem(labelText, valueText) {
  const item = document.createElement("div");
  const label = document.createElement("dt");
  const value = document.createElement("dd");

  item.className = "sf-sponsor-context-item";
  label.textContent = labelText;
  value.textContent = valueText;
  item.append(
    label,
    value,
  );

  return item;
}

function renderSponsorSupportingDetail(container, project) {
  const context = document.createElement("dl");

  container.className =
    "sf-stakeholder-section-content sf-sponsor-context";
  context.className = "sf-sponsor-context-grid";
  context.append(
    createSponsorContextItem(
      "Project Manager",
      project.projectManager ?? "—",
    ),
    createSponsorContextItem(
      "Project Type",
      project.projectType ?? "—",
    ),
    createSponsorContextItem(
      "Strategic Priority",
      project.strategicPriority ?? "—",
    ),
    createSponsorContextItem(
      "Resource Demand",
      project.resourceDemand ?? "—",
    ),
    createSponsorContextItem(
      "Start Date",
      formatProjectDate(project.startDate),
    ),
    createSponsorContextItem(
      "End Date",
      formatProjectDate(project.endDate),
    ),
    createSponsorContextItem(
      "BAC",
      formatMaybeCurrency(project.budgetBAC),
    ),
    createSponsorContextItem(
      "Percent Complete",
      formatMaybePercent(project.percentComplete),
    ),
  );

  container.replaceChildren(context);
}

function renderSponsorDashboard(container, projects) {
  const sections = container.querySelectorAll(
    ".sf-stakeholder-card",
  );
  const project = getSelectedStakeholderProject(projects);
  const renderers = [
    renderSponsorKeySignals,
    renderSponsorPerformance,
    renderSponsorAttention,
    renderSponsorSupportingDetail,
  ];

  sections.forEach((section, index) => {
    const content = section.querySelector(
      ".sf-stakeholder-section-content",
    );
    const heading = section.querySelector("h2");

    section.classList.remove("sf-stakeholder-card--executive");
    section.classList.add("sf-stakeholder-card--sponsor");
    section.classList.remove("sf-stakeholder-card--team");

    if (heading) {
      heading.textContent = DASHBOARD_SECTIONS[index];
    }

    if (!project) {
      createSponsorEmptyState(content);
      return;
    }

    renderers[index]?.(content, project);
  });
}

function createTeamEmptyState(container) {
  const empty = document.createElement("p");

  container.className =
    "sf-stakeholder-section-content";
  empty.className = "sf-stakeholder-placeholder";
  empty.textContent =
    "No project data is currently available for Team View.";
  container.replaceChildren(empty);
}

function renderTeamKeySignals(container, project) {
  const evm = calculateProjectEvm(project);
  const progress = document.createElement("span");

  progress.className = "sf-exec-performance-pair";
  progress.textContent =
    formatMaybePercent(project.percentComplete);

  container.className =
    "sf-stakeholder-section-content sf-team-kpi-grid";
  container.replaceChildren(
    createKpiCard({
      label: "Delivery Progress",
      value: progress,
      support:
        `EV ${formatMaybeCurrency(evm.ev)} / BAC ${formatMaybeCurrency(evm.bac)}`,
    }),
    createKpiCard({
      label: "Cost Efficiency",
      value: formatMaybeIndex(evm.cpi),
      support: `CV ${formatMaybeCurrency(evm.cv)}`,
      className: getPerformanceClass(evm.cpi),
    }),
    createKpiCard({
      label: "Schedule Efficiency",
      value: formatMaybeIndex(evm.spi),
      support: `SV ${formatMaybeCurrency(evm.sv)}`,
      className: getPerformanceClass(evm.spi),
    }),
    createKpiCard({
      label: "Delivery Pressure",
      value: project.projectStatus ?? "—",
      support:
        `Risk ${formatMaybeRiskScore(project.riskScore)} · ${project.resourceDemand ?? "—"} resource demand`,
      className: getNeedsAttentionClass({
        critical: project.projectStatus === "Critical" ? 1 : 0,
        atRisk: project.projectStatus === "At Risk" ? 1 : 0,
      }),
    }),
  );
}

function getTeamEarnedValueLanguage(evm) {
  if (
    Number.isFinite(evm.ev) &&
    Number.isFinite(evm.pv) &&
    evm.ev < evm.pv
  ) {
    return `Earned value is trailing planned value by ${formatCurrency(evm.pv - evm.ev)}.`;
  }

  if (
    Number.isFinite(evm.ev) &&
    Number.isFinite(evm.pv) &&
    evm.ev > evm.pv
  ) {
    return `Earned value is ahead of planned value by ${formatCurrency(evm.ev - evm.pv)}.`;
  }

  if (
    !Number.isFinite(evm.ev) ||
    !Number.isFinite(evm.pv) ||
    !Number.isFinite(evm.ac)
  ) {
    return "Earned value comparison is unavailable.";
  }

  if (
    Number.isFinite(evm.ac) &&
    Number.isFinite(evm.ev) &&
    evm.ac > evm.ev
  ) {
    return `Actual cost exceeds earned value by ${formatCurrency(evm.ac - evm.ev)}.`;
  }

  return "Earned value, planned value and actual cost are currently aligned.";
}

function createTeamEarnedValueSnapshot(project) {
  const evm = calculateProjectEvm(project);
  const rows = [
    {
      label: "Planned Value (PV)",
      shortLabel: "PV",
      value: evm.pv,
      className: "sf-team-evm-column--planned",
    },
    {
      label: "Earned Value (EV)",
      shortLabel: "EV",
      value: evm.ev,
      className: "sf-team-evm-column--earned",
    },
    {
      label: "Actual Cost (AC)",
      shortLabel: "AC",
      value: evm.ac,
      className: "sf-team-evm-column--actual",
    },
  ];
  const validValues = rows
    .map((row) => row.value)
    .filter(Number.isFinite);
  const maxValue = Math.max(
    ...validValues.map((value) => Math.abs(value) * 1.12),
    1,
  );
  const wrapper = document.createElement("div");
  const heading = document.createElement("h3");
  const figure = document.createElement("figure");
  const chart = document.createElement("div");
  const note = document.createElement("p");

  wrapper.className = "sf-team-earned-value";
  heading.textContent = "Earned Value Snapshot";
  figure.className = "sf-team-evm-figure";
  figure.setAttribute("role", "img");
  figure.setAttribute(
    "aria-label",
    `Earned value comparison for ${getProjectName(project)}: Planned Value ${formatMaybeCurrency(evm.pv)}, Earned Value ${formatMaybeCurrency(evm.ev)}, Actual Cost ${formatMaybeCurrency(evm.ac)}.`,
  );
  chart.className = "sf-team-evm-columns";
  note.className = "sf-exec-outlook-note";
  note.textContent = getTeamEarnedValueLanguage(evm);

  rows.forEach((row) => {
    const item = document.createElement("div");
    const value = document.createElement("strong");
    const barWrap = document.createElement("div");
    const bar = document.createElement("span");
    const label = document.createElement("span");
    const numericValue =
      Number.isFinite(row.value) ? row.value : null;
    const height =
      numericValue === null
        ? 0
        : Math.max(5, Math.abs(numericValue) / maxValue * 100);

    item.className = "sf-team-evm-column";
    value.textContent = formatMaybeCurrency(numericValue);
    barWrap.className = "sf-team-evm-column-track";
    bar.className = `sf-team-evm-column-bar ${row.className}`;
    bar.style.height = `${height}%`;
    bar.setAttribute(
      "aria-label",
      `${row.label}: ${formatMaybeCurrency(numericValue)}`,
    );
    label.className = "sf-team-evm-column-label";
    label.textContent = row.shortLabel;
    label.title = row.label;

    barWrap.append(bar);
    item.append(
      value,
      barWrap,
      label,
    );
    chart.append(item);
  });

  figure.append(chart);

  wrapper.append(
    heading,
    figure,
    note,
  );

  return wrapper;
}

function getTeamHealthLanguage(project) {
  const signals = calculateProjectDecisionSignals(project);

  if (signals.costInefficient && signals.scheduleInefficient) {
    return "Cost and schedule performance both require attention.";
  }

  if (signals.scheduleInefficient) {
    return "Schedule performance requires attention.";
  }

  if (signals.costInefficient) {
    return "Cost performance requires attention.";
  }

  if (signals.highRisk) {
    return "Risk exposure requires attention.";
  }

  if (project.resourceDemand === "High") {
    return "Resource demand requires active monitoring.";
  }

  return "Delivery performance is currently stable.";
}

function createTeamHealthMetric(labelText, valueText) {
  const item = document.createElement("div");
  const label = document.createElement("dt");
  const value = document.createElement("dd");

  item.className = "sf-team-health-metric";
  label.textContent = labelText;
  value.textContent = valueText;
  item.append(
    label,
    value,
  );

  return item;
}

function createTeamDeliveryHealth(project) {
  const evm = calculateProjectEvm(project);
  const wrapper = document.createElement("div");
  const heading = document.createElement("h3");
  const metrics = document.createElement("dl");
  const note = document.createElement("p");

  wrapper.className = "sf-team-delivery-health";
  heading.textContent = "Delivery Health";
  metrics.className = "sf-team-health-list";
  note.className = "sf-exec-outlook-note";
  note.textContent = getTeamHealthLanguage(project);

  metrics.append(
    createTeamHealthMetric(
      "Cost performance",
      `CPI ${formatMaybeIndex(evm.cpi)}`,
    ),
    createTeamHealthMetric(
      "Schedule performance",
      `SPI ${formatMaybeIndex(evm.spi)}`,
    ),
    createTeamHealthMetric(
      "Risk exposure",
      formatMaybeRiskScore(project.riskScore),
    ),
    createTeamHealthMetric(
      "Resource demand",
      project.resourceDemand ?? "—",
    ),
    createTeamHealthMetric(
      "Status",
      project.projectStatus ?? "—",
    ),
  );

  wrapper.append(
    heading,
    metrics,
    note,
  );

  return wrapper;
}

function renderTeamPerformance(container, project) {
  container.className =
    "sf-stakeholder-section-content sf-team-performance-grid";
  container.replaceChildren(
    createTeamEarnedValueSnapshot(project),
    createTeamDeliveryHealth(project),
  );
}

function getTeamAttentionSignals(project) {
  const signals = calculateProjectDecisionSignals(project);
  const evm = calculateProjectEvm(project);
  const forecast = calculateProjectForecast(project);
  const items = [];
  let hasCostSignal = false;

  if (Number.isFinite(evm.cv) && evm.cv < 0) {
    items.push(`Cost variance is ${formatCurrency(evm.cv)}.`);
    hasCostSignal = true;
  } else if (signals.costInefficient) {
    items.push(
      `CPI ${formatMaybeIndex(signals.cpi)} indicates cost efficiency below target.`,
    );
    hasCostSignal = true;
  }

  if (Number.isFinite(evm.sv) && evm.sv < 0) {
    items.push(`Schedule variance is ${formatCurrency(evm.sv)}.`);
  } else if (signals.scheduleInefficient) {
    items.push(
      `SPI ${formatMaybeIndex(signals.spi)} indicates schedule efficiency below target.`,
    );
  }

  if (signals.highRisk) {
    items.push(`Risk exposure is ${formatMaybeRiskScore(project.riskScore)}.`);
  }

  if (project.resourceDemand === "High") {
    items.push("Resource demand is High.");
  }

  if (
    items.length < 4 &&
    (project.projectStatus === "Critical" ||
      project.projectStatus === "At Risk")
  ) {
    items.push(`Project status is ${project.projectStatus}.`);
  }

  if (
    items.length < 4 &&
    !hasCostSignal &&
    Number.isFinite(forecast.vac) &&
    forecast.vac < 0
  ) {
    items.push(
      `Forecast pressure is ${formatCurrency(Math.abs(forecast.vac))} over approved budget.`,
    );
  }

  return items.slice(0, 4);
}

function getNextTeamFocus(project) {
  const signals = calculateProjectDecisionSignals(project);

  if (project.projectStatus === "Critical") {
    return "Prioritize recovery actions and escalate unresolved delivery pressure.";
  }

  if (signals.costInefficient && signals.scheduleInefficient) {
    return "Focus on restoring cost and schedule performance against the approved plan.";
  }

  if (signals.scheduleInefficient) {
    return "Review near-term delivery priorities and actions affecting schedule performance.";
  }

  if (signals.costInefficient) {
    return "Review current spending against earned progress and remaining budget.";
  }

  if (signals.highRisk) {
    return "Review active risk responses and confirm near-term mitigation priorities.";
  }

  if (project.resourceDemand === "High") {
    return "Review workload priorities against current resource demand.";
  }

  return "Maintain current delivery pace and continue monitoring performance.";
}

function renderTeamAttention(container, project) {
  const signals = getTeamAttentionSignals(project);
  const summary = document.createElement("p");
  const signalList = document.createElement("div");
  const focus = document.createElement("article");
  const focusLabel = document.createElement("span");
  const focusText = document.createElement("p");

  container.className =
    "sf-stakeholder-section-content sf-team-attention";
  summary.className = "sf-exec-management-summary";
  signalList.className = "sf-team-signal-list";
  focus.className = "sf-team-focus-card";
  focusLabel.className = "sf-exec-kpi-label";
  focusLabel.textContent = "Next Team Focus";
  focusText.textContent = getNextTeamFocus(project);

  summary.textContent =
    signals.length > 0
      ? `${getProjectName(project)} has ${signals.length} current delivery ${signals.length === 1 ? "signal" : "signals"} for team attention.`
      : `${getProjectName(project)} is not currently showing delivery pressure signals.`;

  if (signals.length === 0) {
    const empty = document.createElement("p");

    empty.className = "sf-stakeholder-placeholder";
    empty.textContent =
      "No team attention signals are currently flagged.";
    signalList.append(empty);
  } else {
    signals.forEach((signal) => {
      const item = document.createElement("article");

      item.className = "sf-team-signal";
      item.textContent = signal;
      signalList.append(item);
    });
  }

  focus.append(
    focusLabel,
    focusText,
  );

  container.replaceChildren(
    summary,
    signalList,
    focus,
  );
}

function createTeamContextItem(labelText, valueText) {
  const item = document.createElement("div");
  const label = document.createElement("dt");
  const value = document.createElement("dd");

  item.className = "sf-team-context-item";
  label.textContent = labelText;
  value.textContent = valueText;
  item.append(
    label,
    value,
  );

  return item;
}

function renderTeamSupportingDetail(container, project) {
  const context = document.createElement("dl");

  container.className =
    "sf-stakeholder-section-content sf-team-context";
  context.className = "sf-team-context-grid";
  context.append(
    createTeamContextItem(
      "Project Manager",
      project.projectManager ?? "—",
    ),
    createTeamContextItem(
      "Project Type",
      project.projectType ?? "—",
    ),
    createTeamContextItem(
      "Strategic Priority",
      project.strategicPriority ?? "—",
    ),
    createTeamContextItem(
      "Status",
      project.projectStatus ?? "—",
    ),
    createTeamContextItem(
      "Resource Demand",
      project.resourceDemand ?? "—",
    ),
    createTeamContextItem(
      "Start Date",
      formatProjectDate(project.startDate),
    ),
    createTeamContextItem(
      "End Date",
      formatProjectDate(project.endDate),
    ),
    createTeamContextItem(
      "BAC",
      formatMaybeCurrency(project.budgetBAC),
    ),
  );

  container.replaceChildren(context);
}

function renderTeamDashboard(container, projects) {
  const sections = container.querySelectorAll(
    ".sf-stakeholder-card",
  );
  const project = getSelectedStakeholderProject(projects);
  const renderers = [
    renderTeamKeySignals,
    renderTeamPerformance,
    renderTeamAttention,
    renderTeamSupportingDetail,
  ];

  sections.forEach((section, index) => {
    const content = section.querySelector(
      ".sf-stakeholder-section-content",
    );
    const heading = section.querySelector("h2");

    section.classList.remove("sf-stakeholder-card--executive");
    section.classList.remove("sf-stakeholder-card--sponsor");
    section.classList.add("sf-stakeholder-card--team");

    if (heading) {
      heading.textContent =
        index === 3 ? "Delivery Context" : DASHBOARD_SECTIONS[index];
    }

    if (!project) {
      createTeamEmptyState(content);
      return;
    }

    renderers[index]?.(content, project);
  });
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
    const heading = section.querySelector("h2");

    section.classList.add("sf-stakeholder-card--executive");
    section.classList.remove("sf-stakeholder-card--sponsor");
    section.classList.remove("sf-stakeholder-card--team");

    if (heading) {
      heading.textContent = DASHBOARD_SECTIONS[index];
    }

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
    const heading = section.querySelector("h2");
    const placeholder = document.createElement("p");

    section.classList.remove("sf-stakeholder-card--executive");
    section.classList.remove("sf-stakeholder-card--sponsor");
    section.classList.remove("sf-stakeholder-card--team");

    if (heading) {
      heading.textContent = DASHBOARD_SECTIONS[index];
    }

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
  const existingSponsorControl = container.querySelector(
    ".sf-stakeholder-project-control",
  );

  existingSponsorControl?.remove();

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
    label.hidden =
      !["executive", "sponsor", "team"].includes(selectedAudience.key);

    if (selectedAudience.key === "sponsor") {
      label.textContent = "SPONSOR PROJECT BRIEF";
    } else if (selectedAudience.key === "team") {
      label.textContent = "DELIVERY TEAM BRIEF";
    } else {
      label.textContent = "Executive Portfolio Brief";
    }
  }

  if (descriptor) {
    descriptor.textContent = selectedAudience.description;
  }

  if (selectedAudience.key === "executive") {
    renderExecutiveDashboard(container, currentProjects);
  } else if (
    selectedAudience.key === "sponsor" ||
    selectedAudience.key === "team"
  ) {
    const descriptorWrapper = descriptor?.parentElement;

    if (descriptorWrapper && currentProjects.length > 0) {
      descriptorWrapper.after(
        createStakeholderProjectSelector(currentProjects),
      );
    }

    if (selectedAudience.key === "sponsor") {
      renderSponsorDashboard(container, currentProjects);
    } else {
      renderTeamDashboard(container, currentProjects);
    }
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
