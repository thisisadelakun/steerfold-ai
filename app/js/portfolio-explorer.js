import { APP_CONFIG } from "./app-config.js";
import { calculateProjectDecisionSignals } from "./portfolio-analytics.js";

export const EXPLORER_QUICK_VIEWS = [
  ["all", "All Projects"], ["at-risk", "At Risk"], ["critical", "Critical"],
  ["over-budget", "Over Budget"], ["behind-schedule", "Behind Schedule"],
  ["high-risk", "High Risk"], ["ending-soon", "Ending Soon"],
];

export const EXPLORER_BUDGET_RANGES = [
  { key: "under-150", label: "Under 150,000", min: 0, max: 150000 },
  { key: "150-200", label: "150,000 to under 200,000", min: 150000, max: 200000 },
  { key: "200-250", label: "200,000 to under 250,000", min: 200000, max: 250000 },
  { key: "250-plus", label: "250,000+", min: 250000, max: Infinity },
];

export function getExplorerCategory(project) {
  return String(project.businessUnit || project.category || project.projectType || "").trim();
}

export function getExplorerOptions(projects, field) {
  return [...new Set(projects.map((project) => field === "category"
    ? getExplorerCategory(project) : String(project[field] ?? "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, APP_CONFIG.portfolio.locale, { sensitivity: "base" }));
}

export function getExplorerRiskBand(score) {
  if (!Number.isFinite(score) || score < 0 || score > 25) return null;
  const { lowMax, mediumMax } = APP_CONFIG.portfolio.riskScoreBands;
  return score <= lowMax ? "Low" : score <= mediumMax ? "Medium" : "High";
}

function dateValue(value) {
  const text = String(value ?? "");
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const local = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (!iso && !local) return null;
  const [year, month, day] = iso ? iso.slice(1).map(Number)
    : [Number(local[3]), Number(local[1]), Number(local[2])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.getTime() : null;
}

function matchesQuickView(project, view, referenceDate) {
  if (view === "all") return true;
  if (view === "at-risk") return project.projectStatus === "At Risk";
  if (view === "critical") return project.projectStatus === "Critical";
  if (view === "high-risk") return getExplorerRiskBand(project.riskScore) === "High";
  if (view === "ending-soon") {
    const reference = dateValue(referenceDate);
    const end = dateValue(project.endDate);
    return reference !== null && end !== null && end >= reference && end <= reference + 60 * 86400000;
  }
  const signals = calculateProjectDecisionSignals(project);
  return view === "over-budget" ? signals.forecastOverBudget
    : view === "behind-schedule" ? signals.scheduleInefficient : false;
}

export function filterExplorerProjects(projects, filters, referenceDate) {
  const search = String(filters.search ?? "").trim().toLocaleLowerCase(APP_CONFIG.portfolio.locale);
  const budget = EXPLORER_BUDGET_RANGES.find((range) => range.key === filters.budget);
  return projects.filter((project) => {
    const searchable = [project.projectId, project.projectName, project.projectManager,
      project.projectType, getExplorerCategory(project)];
    return (!search || searchable.some((value) => String(value ?? "").toLocaleLowerCase(APP_CONFIG.portfolio.locale).includes(search)))
      && (!filters.status || project.projectStatus === filters.status)
      && (filters.priority === "all" || project.strategicPriority === filters.priority)
      && (filters.resourceDemand === "all" || project.resourceDemand === filters.resourceDemand)
      && (filters.manager === "all" || String(project.projectManager ?? "").trim() === filters.manager)
      && (filters.category === "all" || getExplorerCategory(project) === filters.category)
      && (filters.risk === "all" || getExplorerRiskBand(project.riskScore) === filters.risk)
      && (!budget || (Number.isFinite(project.budgetBAC) && project.budgetBAC >= budget.min && project.budgetBAC < budget.max))
      && matchesQuickView(project, filters.quickView, referenceDate);
  });
}
