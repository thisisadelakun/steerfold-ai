import { createUtilityDialog } from "./utility-dialog.js";
import { openPageTour } from "./onboarding-tour.js";

const HELP = {
  portfolio: {
    title: "Portfolio",
    purpose: "Review portfolio health and compare project performance at a glance.",
    steps: [
      ["Read the summary", "Check project counts and status indicators for an overall health snapshot.", "[data-portfolio-kpis]"],
      ["Explore portfolio health", "Choose an analysis to compare budget, risk, completion or project health.", "[data-portfolio-analysis-select]"],
      ["Go deeper", "Open Projects, Budget or Forecasting from navigation for detailed analysis.", ".sf-nav"],
    ],
  },
  projects: {
    title: "Projects",
    purpose: "Search, filter and review projects across the portfolio.",
    steps: [
      ["Start with Quick Views", "Surface common project conditions with a Quick View.", ".sf-explorer-quick-views"],
      ["Search the portfolio", "Search by project name, ID, manager or category.", "[data-project-search]"],
      ["Combine filters", "Narrow the portfolio with the available filters; clear them to start again.", ".sf-explorer-filter-panel"],
      ["Compare and open projects", "Sort a column, browse pages and open a project name for its detail view.", ".sf-project-table"],
      ["Add portfolio data", "When signed in, use New Project or Import Projects. Imports require validation, server conflict review and explicit final confirmation before new projects are created.", ".sf-project-create-button, .sf-project-import-button"],
    ],
  },
  budget: {
    title: "Budget & EVM",
    purpose: "Compare approved budgets, earned value and actual spending using portfolio EVM measures.",
    steps: [
      ["Review the totals", "Compare BAC, PV, EV and AC across the portfolio.", "[data-budget-kpis]"],
      ["Read performance indicators", "Use cost and schedule efficiency alongside project variance to understand pressure.", "[data-variance-analysis]"],
      ["Check a calculation", "Use the temporary calculator for arithmetic or EVM; inputs never change project records.", ".sf-calculator-button"],
    ],
  },
  forecasting: {
    title: "Forecasting",
    purpose: "Explore projected final cost and the effect of temporary assumptions.",
    steps: [
      ["Review EAC, ETC, VAC and TCPI against the approved baseline."],
      ["Compare project forecasts to locate budget exposure."],
      ["Use What-If and Sensitivity Analysis to explore assumptions without saving changes."],
      ["Open Calculator for a separate organization-currency scratchpad."],
    ],
  },
  "decision-support": {
    title: "Decision Support",
    purpose: "Review data-grounded priorities and the factors behind management attention signals.",
    steps: [
      ["Check the attention and forecast-exposure summary."],
      ["Read priority recommendations alongside their supporting factors."],
      ["Open a project to inspect its source performance measures."],
      ["Use Calculator for temporary checks; recommendations and project values remain unchanged."],
    ],
  },
  governance: {
    title: "Governance",
    purpose: "Assess proposed changes and review the persistent change-control workflow.",
    steps: [
      ["Choose a project and enter change details and affected areas."],
      ["Compare the proposed baseline and forecast impact; the assessment is a simulation."],
      ["When authorized, Save as Draft creates a persistent change request."],
      ["Use the register to inspect requests, history and permitted workflow actions; role and separation-of-duties rules apply."],
    ],
  },
  "stakeholder-view": {
    title: "Stakeholder View",
    purpose: "Read the portfolio through Executive, Sponsor or Team perspectives.",
    steps: [
      ["Choose an audience", "Switch between Executive, Sponsor and Team perspectives.", ".sf-stakeholder-selector"],
      ["Read Key Signals", "Review the headline indicators; choose a project when the selected audience requires one.", ".sf-stakeholder-section-content"],
      ["Explore performance", "Read the performance, attention and context sections together before drawing conclusions.", ".sf-stakeholder-dashboard > section:nth-child(2)"],
    ],
  },
  settings: {
    title: "Settings",
    purpose: "Personalize appearance and how portfolio financial values are displayed.",
    steps: [
      ["Choose Dark, Light or System under Appearance."],
      ["Choose a display currency and check the rate source and timestamp."],
      ["Preferences stay in this browser. Stored project and governance values remain in organization currency."],
    ],
  },
  project: {
    title: "Project Detail",
    purpose: "Inspect the selected project's delivery, financial and forecast performance.",
    steps: [
      ["Review project context and performance measures together."],
      ["Use Calculator and Use current project values for a temporary EVM check."],
      ["Use Back to Projects to return to the portfolio list. Editing requires authentication."],
    ],
  },
};

const TOUR_VIEWS = new Set(["portfolio", "projects", "budget", "stakeholder-view"]);

export function openPageHelp(view, launchedBy) {
  const content = HELP[view];
  if (!content) return;
  const modal = createUtilityDialog(`How to use ${content.title}`, "sf-page-help");
  if (!modal) return;
  const purpose = document.createElement("p");
  purpose.className = "sf-utility-intro";
  purpose.textContent = content.purpose;
  const list = document.createElement("ol");
  list.className = "sf-help-steps";
  content.steps.forEach(([title, copy]) => {
    const item = document.createElement("li");
    item.textContent = copy ? `${title}. ${copy}` : title;
    list.append(item);
  });
  modal.dialog.append(purpose, list);
  if (TOUR_VIEWS.has(view)) {
    const tour = document.createElement("button");
    tour.type = "button";
    tour.className = "sf-utility-primary";
    tour.textContent = "Take page tour";
    tour.addEventListener("click", () => {
      modal.dialog.close();
      // Wait for native modal cleanup before applying the tour's inert snapshot.
      requestAnimationFrame(() => openPageTour(content.steps.map(([title, copy, selector]) => ({ title, copy, selector })), launchedBy));
    });
    modal.dialog.append(tour);
  }
  modal.open();
}
