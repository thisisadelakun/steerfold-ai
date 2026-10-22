import { APP_CONFIG } from "./app-config.js";
import {
  getPortfolioStatusSummary, calculateProjectEvm, calculateProjectForecast,
  calculateProjectDecisionSignals, getPriorityRecommendations,
} from "./portfolio-analytics.js";

const PRIORITY = { Critical: 3, High: 2, Moderate: 1 };
const STRATEGIC = { High: 3, Medium: 2, Low: 1 };
export const INTELLIGENCE_FILTERS = [
  ["all", "All Attention Items"], ["critical", "Critical"], ["cost", "Cost"],
  ["schedule", "Schedule"], ["risk", "Risk"],
];

function primarySignal(project, signals) {
  if (project.projectStatus === "Critical") return ["critical", "Schedule sponsor review and agree corrective actions."];
  if (signals.criticalRisk) return ["risk", "Escalate top risks and confirm mitigation owners."];
  if (signals.highCompletionPressure) return ["completion", "Review remaining cost assumptions and validate ETC."];
  if (signals.forecastOverBudget) return ["forecast", "Validate EAC and remaining cost assumptions with the sponsor."];
  if (signals.costInefficient) return ["cost", "Review remaining cost assumptions and validate ETC."];
  if (signals.scheduleInefficient) return ["schedule", "Review critical-path activities and recovery options."];
  if (signals.highRisk) return ["risk", "Escalate top risks and confirm mitigation owners."];
  if (signals.statusNeedsAttention) return ["status", "Confirm the delivery recovery plan with the project manager."];
  return [null, "Continue monitoring; no immediate corrective action required."];
}

function compareNames(a, b) {
  return a.projectName.localeCompare(b.projectName, APP_CONFIG.portfolio.locale, { sensitivity: "base" })
    || a.projectId.localeCompare(b.projectId, APP_CONFIG.portfolio.locale);
}

export function getPortfolioIntelligence(projects) {
  const list = Array.isArray(projects) ? projects : [];
  const recommendations = new Map(getPriorityRecommendations(list).map((item) => [item.projectId, item]));
  const records = list.map((project) => {
    const signals = calculateProjectDecisionSignals(project);
    const evm = calculateProjectEvm(project);
    const forecast = calculateProjectForecast(project);
    const [primary, action] = primarySignal(project, signals);
    const dimensions = [signals.statusNeedsAttention, signals.highRisk,
      signals.costInefficient || signals.forecastOverBudget || signals.highCompletionPressure, signals.scheduleInefficient]
      .filter(Boolean).length;
    const comparable = Number.isFinite(evm.cpi) && Number.isFinite(evm.spi) && Number.isFinite(forecast.eac);
    return {
      projectId: String(project.projectId ?? ""), projectName: String(project.projectName || "Unnamed project"),
      projectManager: String(project.projectManager || "Not recorded"), projectStatus: project.projectStatus || "Not recorded",
      strategicPriority: project.strategicPriority, riskScore: project.riskScore,
      evm, forecast, signals, primary, action, dimensions,
      urgency: recommendations.get(project.projectId)?.priorityLevel ?? null,
      comparable,
      strong: primary === null && project.projectStatus === "On Track" && comparable
        && Number.isFinite(project.riskScore) && project.riskScore >= 0
        && project.riskScore < APP_CONFIG.portfolio.decisionThresholds.highRiskScore,
    };
  });
  // Lexicographic ordering, not an opaque weighted score. Financial pressures
  // count as one dimension so CPI and its forecast do not double-weight cost.
  const attention = records.filter((record) => record.primary !== null).sort((a, b) =>
    (PRIORITY[b.urgency] || 0) - (PRIORITY[a.urgency] || 0)
    || (Number.isFinite(b.riskScore) ? b.riskScore : -1) - (Number.isFinite(a.riskScore) ? a.riskScore : -1)
    || b.dimensions - a.dimensions
    || (STRATEGIC[b.strategicPriority] || 0) - (STRATEGIC[a.strategicPriority] || 0)
    || compareNames(a, b));
  const cost = records.filter((record) => record.signals.costInefficient)
    .sort((a, b) => a.evm.cv - b.evm.cv || compareNames(a, b));
  const schedule = records.filter((record) => record.signals.scheduleInefficient)
    .sort((a, b) => a.evm.sv - b.evm.sv || compareNames(a, b));
  const risk = records.filter((record) => record.signals.highRisk)
    .sort((a, b) => b.riskScore - a.riskScore || compareNames(a, b));
  const overBudget = records.filter((record) => record.signals.forecastOverBudget);
  const strong = records.filter((record) => record.strong).sort(compareNames);
  const strategic = attention.filter((record) => record.strategicPriority === "High");
  const counts = {
    ...getPortfolioStatusSummary(list),
    overBudget: overBudget.length, behindSchedule: schedule.length, highRisk: risk.length,
    forecastConcern: records.filter((record) => record.signals.forecastOverBudget || record.signals.highCompletionPressure).length,
  };
  return {
    counts, records, attention, cost, schedule, risk, overBudget, strong, strategic,
    forecastExposure: overBudget.reduce((sum, record) => sum + Math.abs(record.forecast.vac), 0),
    comparisonsUnavailable: records.filter((record) => !record.comparable).length,
    unclassified: counts.totalProjects - counts.onTrack - counts.atRisk - counts.critical,
  };
}

export function filterIntelligenceAttention(model, filter) {
  return model.attention.filter((record) => filter === "all"
    || (filter === "critical" && record.projectStatus === "Critical")
    || (filter === "cost" && record.signals.costInefficient)
    || (filter === "schedule" && record.signals.scheduleInefficient)
    || (filter === "risk" && record.signals.highRisk));
}

export function describeAttention(record, money) {
  const { inefficientIndex, highCompletionPressureTcpi } = APP_CONFIG.portfolio.decisionThresholds;
  switch (record.primary) {
    case "critical": return "Critical delivery status requires sponsor attention.";
    case "risk": return `Risk exposure is ${record.riskScore}/25.`;
    case "completion": return `Remaining work requires TCPI ${record.forecast.tcpi.toFixed(2)}, above ${highCompletionPressureTcpi}.`;
    case "forecast": return `Forecast final cost exceeds budget by ${money(Math.abs(record.forecast.vac))}.`;
    case "cost": return `CPI ${record.evm.cpi.toFixed(2)} is below the ${inefficientIndex.toFixed(2)} cost-efficiency target.`;
    case "schedule": return `SPI ${record.evm.spi.toFixed(2)} is below the ${inefficientIndex.toFixed(2)} schedule-efficiency target.`;
    default: return "At Risk delivery status requires management review.";
  }
}

export function buildExecutiveNarrative(model, money) {
  const { counts, cost, schedule, attention } = model;
  if (!counts.totalProjects) return "No projects are available for portfolio intelligence.";
  const sentences = [`The portfolio contains ${counts.totalProjects} ${counts.totalProjects === 1 ? "project" : "projects"}: ${counts.onTrack} on track, ${counts.atRisk} at risk and ${counts.critical} critical${model.unclassified ? `; ${model.unclassified} without a recognized status` : ""}.`];
  const pressures = [];
  if (cost.length) pressures.push(`Cost pressure is greatest in ${cost[0].projectName} (earned-value cost shortfall ${money(Math.abs(cost[0].evm.cv))})`);
  if (schedule.length) pressures.push(`schedule pressure is greatest in ${schedule[0].projectName} (earned-value schedule shortfall ${money(Math.abs(schedule[0].evm.sv))})`);
  sentences.push(pressures.length ? `${pressures.join(", while ").replace(/^schedule/, "Schedule")}.`
    : "No cost or schedule efficiency shortfalls are detected in the available comparisons.");
  sentences.push(attention.length ? `Management attention is recommended first for ${attention.slice(0, 2).map((record) => record.projectName).join(" and ")}.`
    : "No immediate corrective action is indicated by the available status, risk, efficiency and forecast signals.");
  if (model.comparisonsUnavailable) sentences.push(`Efficiency or forecast comparisons are unavailable for ${model.comparisonsUnavailable} ${model.comparisonsUnavailable === 1 ? "project" : "projects"}.`);
  return sentences.join(" ");
}
