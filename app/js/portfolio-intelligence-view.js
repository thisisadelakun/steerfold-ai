import { APP_CONFIG } from "./app-config.js";
import { formatDisplayCurrency } from "./formatters.js";
import { createStatusDistributionChart } from "./charts.js";
import { createStatusBadge } from "./ui-components.js";
import {
  INTELLIGENCE_FILTERS, getPortfolioIntelligence, filterIntelligenceAttention,
  describeAttention, buildExecutiveNarrative,
} from "./portfolio-intelligence.js";

function element(tag, text = "", className = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}

function projectLink(record, onOpenProject) {
  const link = element("a", record.projectName);
  link.href = `?project=${encodeURIComponent(record.projectId)}`;
  link.addEventListener("click", (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !onOpenProject) return;
    event.preventDefault();
    onOpenProject(record.projectId);
  });
  return link;
}

export function renderPortfolioIntelligence(container, projects, { onOpenProject } = {}) {
  if (!container) return;
  const model = getPortfolioIntelligence(projects);
  const money = formatDisplayCurrency;
  const narrative = element("p", buildExecutiveNarrative(model, money), "sf-intelligence-narrative");
  const metrics = element("dl", "", "sf-intelligence-metrics");
  [["Over Budget", model.counts.overBudget, "Forecast EAC exceeds approved BAC"],
    ["Behind Schedule", model.counts.behindSchedule, "Earned-value SPI below target"],
    ["High Risk", model.counts.highRisk, `Risk score at least ${APP_CONFIG.portfolio.decisionThresholds.highRiskScore}/25`],
    ["Forecast Concern", model.counts.forecastConcern, "Forecast overrun or high completion pressure"]]
    .forEach(([label, count, description]) => {
      const metric = element("div");
      const value = element("dd");
      value.append(element("strong", String(count)), element("small", description));
      metric.append(element("dt", label), value);
      metrics.append(metric);
    });

  const overview = element("div", "", "sf-intelligence-overview");
  const health = element("section", "", "sf-intelligence-health");
  const healthTitle = element("h3", "Portfolio Health Breakdown");
  healthTitle.id = "sf-intelligence-health-title";
  health.setAttribute("aria-labelledby", healthTitle.id);
  health.append(healthTitle, createStatusDistributionChart(Array.isArray(projects) ? projects : []));
  if (model.unclassified) health.append(element("p", `${model.unclassified} projects have no recognized status and are excluded from the distribution.`));
  const signals = element("ul", "", "sf-intelligence-signals");
  signals.setAttribute("aria-label", "Portfolio intelligence signals");
  const costLeader = model.cost[0];
  const scheduleLeader = model.schedule[0];
  const riskLeader = model.risk[0];
  const cards = [
    ["Cost pressure", costLeader, costLeader ? `Largest cost variance: ${money(costLeader.evm.cv)}. ${model.cost.length} ${model.cost.length === 1 ? "project is" : "projects are"} below the CPI target.` : "No cost efficiency shortfalls detected."],
    ["Schedule pressure", scheduleLeader, scheduleLeader ? `Largest earned-value schedule variance: ${money(scheduleLeader.evm.sv)}.` : "No schedule efficiency shortfalls detected."],
    ["High-risk delivery", riskLeader, riskLeader ? `Risk exposure: ${riskLeader.riskScore}/25. Confirm mitigation ownership.` : "No projects reach the configured high-risk threshold."],
    ["Forecast overrun risk", null, model.overBudget.length ? `${money(model.forecastExposure)} total forecast exposure across ${model.overBudget.length} projects, assuming current cost efficiency continues.` : "No available EAC forecast exceeds approved budget."],
    ["Strong-performing projects", model.strong[0], model.strong.length ? `${model.strong.length} meet the available status, risk, efficiency and forecast checks. Continue monitoring; no immediate corrective action required.` : "No projects currently meet every strong-performance check."],
    ["Strategic intervention", model.strategic[0], model.strategic.length ? `${model.strategic.length} high-strategic-priority projects require attention.` : "No high-strategic-priority projects currently require intervention."],
  ];
  cards.forEach(([title, record, detail]) => {
    const item = element("li");
    item.append(element("h4", title));
    if (record) item.append(projectLink(record, onOpenProject));
    item.append(element("p", model.counts.totalProjects ? detail : "No project data available."));
    signals.append(item);
  });
  overview.append(health, signals);

  const attention = element("section", "", "sf-intelligence-attention");
  const title = element("h3", "Projects Needing Attention");
  title.id = "sf-intelligence-attention-title";
  attention.setAttribute("aria-labelledby", title.id);
  const filters = element("fieldset", "", "sf-intelligence-filters");
  filters.append(element("legend", "Attention focus"));
  let filter = INTELLIGENCE_FILTERS.some(([key]) => key === container.dataset.intelligenceFilter)
    ? container.dataset.intelligenceFilter : "all";
  const count = element("p", "", "sf-intelligence-result-count");
  count.setAttribute("role", "status");
  const list = element("ol", "", "sf-intelligence-attention-list");
  list.id = "sf-intelligence-attention-list";
  const empty = element("p", "", "sf-intelligence-empty");
  const expand = element("button", "", "sf-intelligence-expand");
  expand.type = "button";
  expand.setAttribute("aria-controls", list.id);
  let expanded = container.dataset.intelligenceExpanded === "true";
  expand.addEventListener("click", () => {
    expanded = !expanded;
    container.dataset.intelligenceExpanded = String(expanded);
    renderAttention();
  });
  function renderAttention() {
    const matching = filterIntelligenceAttention(model, filter);
    const visible = expanded ? matching : matching.slice(0, 5);
    count.textContent = `Showing ${visible.length} of ${matching.length} matching attention ${matching.length === 1 ? "item" : "items"}.`;
    list.replaceChildren();
    visible.forEach((record) => {
      const rank = model.attention.indexOf(record) + 1;
      const item = element("li");
      item.value = rank;
      const number = element("span", String(rank), "sf-intelligence-rank");
      number.setAttribute("aria-label", `Portfolio attention rank ${rank}`);
      const project = element("div", "", "sf-intelligence-project");
      project.append(projectLink(record, onOpenProject), element("small", `${record.projectId} | Manager: ${record.projectManager}`), createStatusBadge(record.projectStatus));
      const reason = element("div", "", "sf-intelligence-reason");
      const urgency = element("span", `${record.urgency} priority`, "sf-intelligence-urgency");
      urgency.dataset.urgency = record.urgency;
      reason.append(urgency, element("p", describeAttention(record, money)));
      const action = element("div", "", "sf-intelligence-action");
      action.append(element("small", "Next action"), element("p", record.action));
      item.append(number, project, reason, action);
      list.append(item);
    });
    empty.hidden = matching.length > 0;
    empty.textContent = !model.counts.totalProjects ? "No projects are available to assess."
      : model.attention.length ? "No projects match this attention category."
        : "No projects currently require corrective action based on the available signals.";
    expand.hidden = matching.length <= 5;
    expand.textContent = expanded ? "Show top 5" : `Show all ${matching.length} attention items`;
    expand.setAttribute("aria-expanded", String(expanded));
  }
  INTELLIGENCE_FILTERS.forEach(([key, label]) => {
    const field = element("label");
    const input = element("input");
    input.type = "radio"; input.name = "sf-intelligence-focus"; input.value = key; input.checked = filter === key;
    input.addEventListener("change", () => {
      if (!input.checked) return;
      filter = key;
      expanded = false;
      container.dataset.intelligenceExpanded = "false";
      container.dataset.intelligenceFilter = key;
      renderAttention();
    });
    field.append(input, element("span", label)); filters.append(field);
  });
  const rules = element("details", "", "sf-intelligence-rules");
  rules.append(element("summary", "Signal definitions and ranking rules"),
    element("p", `Decision Support thresholds: high risk at ${APP_CONFIG.portfolio.decisionThresholds.highRiskScore}/25; critical risk at ${APP_CONFIG.portfolio.decisionThresholds.criticalRiskScore}/25; cost/schedule index below ${APP_CONFIG.portfolio.decisionThresholds.inefficientIndex}; high completion pressure when TCPI exceeds ${APP_CONFIG.portfolio.decisionThresholds.highCompletionPressureTcpi}. Over Budget means forecast EAC exceeds BAC, not actual spending to date. Forecast Concern includes this or high TCPI. These counts overlap.`),
    element("p", "Attention uses existing Decision Support priority tiers: Critical for critical status, critical risk or high completion pressure; High for at-risk status, high risk or forecast overrun; Moderate for remaining efficiency shortfalls. Ties use risk score, distinct affected dimensions, strategic priority, then project name and ID. Cost efficiency, forecast overrun and completion pressure count as one financial dimension. The Critical filter uses recorded Critical status."));
  attention.append(title, filters, count, list, empty, expand, rules);
  container.replaceChildren(narrative, metrics, overview, attention);
  renderAttention();
}
