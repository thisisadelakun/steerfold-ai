import {
  renderProjectPerformance,
  renderProjectNotFound,
} from "./project-view.js";

import {
  formatDisplayCurrency,
  formatPercent,
} from "./formatters.js";

import {
  loadPortfolioData,
  getLastPortfolioDataSource,
  createProject,
  updateProject,
  deleteProject,
} from "./data-service.js";

import {
  getPortfolioStatusSummary,
  getPortfolioFinancialSummary,
  getResourceDemandByStatus,
  calculatePortfolioEvmSummary,
  calculatePortfolioForecast,
  getProjectVarianceData,
  getProjectForecastData,
  calculateDecisionSupportSummary,
  getPriorityRecommendations,
} from "./portfolio-analytics.js";

import {
  createFinancialPerformanceChart,
  createRiskCompletionChart,
  createResourceDemandChart,
  createBudgetActualChart,
  createProjectCompletionChart,
  createProjectRiskChart,
  createStatusDistributionChart,
  createPriorityDistributionChart,
  createProjectHealthHeatmap,
  createProjectHealthRadar,
  createPortfolioEvmPerformanceChart,
  createPortfolioForecastChart,
  createProjectVarianceChart,
  createProjectForecastAnalysisChart,
} from "./charts.js";

import {
  getCurrentRoute,
  pushProjectRoute,
  pushPortfolioRoute,
  pushProjectsRoute,
  pushBudgetRoute,
  pushForecastingRoute,
  pushDecisionSupportRoute,
  pushGovernanceRoute,
  pushSettingsRoute,
  pushStakeholderViewRoute,
  listenForRouteChanges,
} from "./router.js";

import {
  createStatusBadge,
  createPriorityRecommendationsList,
  createDecisionFactorsList,
} from "./ui-components.js";

import { initAuthUI } from "./auth-ui.js";

import { initOnboardingTour } from "./onboarding-tour.js";
import { openPageHelp } from "./page-help.js";
import { openCalculator } from "./calculator.js";
import { initVisualizationMotion } from "./visualization-motion.js";

import { renderStakeholderView } from "./stakeholder-view.js";
import { renderPortfolioIntelligence } from "./portfolio-intelligence-view.js";

import { renderScenarioAnalysis } from "./scenario-analysis.js";

import { renderSensitivityAnalysis } from "./sensitivity-analysis.js";
import { renderGovernanceView } from "./governance-view.js";
import { initGovernanceWorkflow } from "./governance-workflow.js";

import { openProjectForm } from "./project-form.js";
import { openProjectImport } from "./project-import.js";

import { openConfirmDialog } from "./confirm-dialog.js";

import { printCurrentView } from "./export-service.js";

import { isAuthenticated } from "./auth-service.js";

import { APP_CONFIG } from "./app-config.js";
import { getCurrencyState, setDisplayCurrency, subscribeCurrencyChanges, refreshCurrencyRate } from "./currency-preferences.js";
import { registerCurrencyRenderer } from "./currency-presentation.js";
import {
  EXPLORER_QUICK_VIEWS, EXPLORER_BUDGET_RANGES,
  getExplorerOptions, filterExplorerProjects,
} from "./portfolio-explorer.js";

function isPlainLeftClick(event) {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

const PROJECT_SORT_COLUMNS = [
  {
    key: "projectName",
    label: "Project",
    initialDirection: "asc",
    type: "string",
  },
  {
    key: "projectManager",
    label: "Manager",
    initialDirection: "asc",
    type: "string",
  },
  {
    key: "strategicPriority",
    label: "Priority",
    initialDirection: "desc",
    type: "rank",
    ranks: {
      High: 3,
      Medium: 2,
      Low: 1,
    },
  },
  {
    key: "percentComplete",
    label: "Complete",
    initialDirection: "desc",
    type: "number",
  },
  {
    key: "budgetBAC",
    label: "Budget",
    initialDirection: "desc",
    type: "number",
  },
  {
    key: "riskScore",
    label: "Risk",
    initialDirection: "desc",
    type: "number",
  },
  {
    key: "resourceDemand",
    label: "Resource Demand",
    initialDirection: "desc",
    type: "rank",
    ranks: {
      High: 3,
      Medium: 2,
      Low: 1,
    },
  },
  {
    key: "projectStatus",
    label: "Status",
    initialDirection: "desc",
    type: "rank",
    ranks: {
      Critical: 3,
      "At Risk": 2,
      "On Track": 1,
    },
  },
];

const PROJECT_PAGE_SIZES = [
  10,
  25,
  50,
  100,
];

const PORTFOLIO_ANALYSES = {
  "risk-completion": {
    title: "Risk vs Project Completion",
    description:
      "Identify projects that combine elevated risk with lower completion.",
  },
  "resource-demand": {
    title: "Resource Demand by Project Status",
    description:
      "Compare resource pressure across On Track, At Risk and Critical projects.",
  },
  "budget-actual": {
    title: "Budget vs Actual Cost",
    description:
      "Compare approved project budgets with actual cost incurred to date.",
  },
  "project-completion": {
    title: "Project Completion",
    description:
      "Compare delivery progress across projects.",
  },
  "project-risk": {
    title: "Project Risk",
    description:
      "Compare current risk exposure across projects.",
  },
  "status-distribution": {
    title: "Portfolio Status Distribution",
    description:
      "See the proportion of projects across current portfolio health statuses.",
  },
  "priority-distribution": {
    title: "Strategic Priority Distribution",
    description:
      "Review how the portfolio is distributed across strategic priority levels.",
  },
  "health-heatmap": {
    title: "Project Health Heatmap",
    description:
      "Scan project performance and delivery signals across the portfolio.",
  },
  "health-radar": {
    title: "Project Health Radar",
    description:
      "Review a normalized performance profile for an individual project.",
  },
};

const SteerfoldApp = {
  state: {
    projects: [],
    filteredProjects: [],
    currentProjectId: null,
  },

  projectSort: {
    key: "projectName",
    direction: "asc",
  },

  projectPagination: {
    currentPage: 1,
    pageSize: 25,
  },

  projectFilters: {
    priority: "all",
    resourceDemand: "all",
    manager: "all",
    category: "all",
    risk: "all",
    budget: "all",
    quickView: "all",
  },

  portfolioChartSelection: "risk-completion",

  portfolioRadarProjectId: null,

  governanceWorkflowRestore: null,

    init() {
    document.documentElement.dataset.sfReady = "true";

    this.cacheElements();
    this.applyAppConfig();
    this.setupCurrencyPreferences();
    this.setupSidebar();
    this.setupFilters();
    this.setupProjectFilters();
    this.setupProjectSorting();
    this.setupProjectResultCount();
    this.setupProjectPagination();
    this.setupPortfolioAnalysis();
    this.setupExportControls();
    this.setupRouting();
    this.setupAuthChanges();
    initAuthUI();
    initOnboardingTour({ onHelp: () => openPageHelp(this.activeHeaderView, this.helpButton) });
    this.helpButton = this.accountArea?.querySelector(".sf-tour-button");
    this.setupCalculatorControl();
    this.updateHeaderActionsForView(getCurrentRoute().view);
    initVisualizationMotion(document.querySelector(".sf-main-content"));
    this.loadDashboard();
  },

  cacheElements() {
    this.wordmarkLink = document.querySelector(".sf-wordmark");
    this.wordmarkText = document.querySelector(".sf-wordmark-text");
    this.pageHeading = document.querySelector(".sf-page-heading");
    this.pageTitle = document.querySelector("[data-page-title]");
    this.pageSubtitle = document.querySelector(
      "[data-page-subtitle]",
    );
    this.pageEyebrow = document.querySelector(".sf-eyebrow");
    this.pageSupportingLine = document.querySelector(
      "[data-page-supporting-line]",
    );
    this.governanceBadge = document.querySelector("[data-governance-badge]");
    this.currencyIndicator = document.querySelector(
      "[data-currency-indicator]",
    );
    this.displayCurrencySelect = document.querySelector("[data-display-currency]");
    this.currencyStatus = document.querySelector("[data-currency-status]");
    this.currencyPreview = document.querySelector("[data-currency-preview]");
    this.printCurrencyContext = document.querySelector("[data-print-currency-context]");
    this.organizationCurrencyValue = document.querySelector("[data-organization-currency]");
    this.accountArea = document.querySelector(
      ".sf-page-header .sf-account-area",
    );
    this.mainArea = document.querySelector(".sf-main-area");
    this.settingsView = document.querySelector("[data-settings-view]");

    this.portfolioOverviewViews = document.querySelectorAll(
      "[data-portfolio-overview]",
    );

    this.budgetView = document.querySelector(
      "[data-budget-view]",
    );

    this.forecastingView = document.querySelector(
      "[data-forecasting-view]",
    );

    this.forecastingKpiContainer = document.querySelector(
      "[data-forecasting-kpis]",
    );

    this.forecastingKpiCards = this.forecastingKpiContainer?.querySelectorAll(
      ".sf-kpi-card",
    );

    this.portfolioForecast = document.querySelector(
      "[data-portfolio-forecast]",
    );

    this.projectForecastAnalysis = document.querySelector(
      "[data-project-forecast-analysis]",
    );

    this.scenarioAnalysis = document.querySelector(
      "[data-scenario-analysis]",
    );

    this.sensitivityAnalysis = document.querySelector(
      "[data-sensitivity-analysis]",
    );

    this.decisionSupportView = document.querySelector(
      "[data-decision-support-view]",
    );

    this.stakeholderView = document.querySelector(
      "[data-stakeholder-view]",
    );
    this.governanceView = document.querySelector("[data-governance-view]");

    this.decisionSupportKpiContainer = document.querySelector(
      "[data-decision-support-kpis]",
    );

    this.decisionSupportKpiCards =
      this.decisionSupportKpiContainer?.querySelectorAll(".sf-kpi-card");

    this.priorityRecommendations = document.querySelector(
      "[data-priority-recommendations]",
    );

    this.decisionFactors = document.querySelector(
      "[data-decision-factors]",
    );

    this.financialChart = document.querySelector(
      "[data-financial-chart]",
    );

    this.portfolioAnalysisTitle = document.querySelector(
      "[data-portfolio-analysis-title]",
    );

    this.portfolioAnalysisDescription = document.querySelector(
      "[data-portfolio-analysis-description]",
    );

    this.portfolioAnalysisSelect = document.querySelector(
      "[data-portfolio-analysis-select]",
    );

    this.portfolioAnalysisChart = document.querySelector(
      "[data-portfolio-analysis-chart]",
    );

    this.radarProjectControl = document.querySelector(
      "[data-radar-project-control]",
    );

    this.radarProjectSelect = document.querySelector(
      "[data-radar-project-select]",
    );

    this.evmPerformance = document.querySelector(
      "[data-evm-performance]",
    );

    this.varianceAnalysis = document.querySelector(
      "[data-variance-analysis]",
    );

    this.budgetKpiContainer = document.querySelector(
      "[data-budget-kpis]",
    );

    this.budgetKpiCards = this.budgetKpiContainer?.querySelectorAll(
      ".sf-kpi-card",
    );

    this.portfolioIntelligenceContent = document.querySelector(
    "[data-portfolio-intelligence-content]",
  );

    this.projectsViews = document.querySelectorAll(
      "[data-projects-view]",
    );

    this.projectsSection = document.querySelector("#projects");

    this.projectDetail = document.querySelector(
      "[data-project-detail]",
    );

    this.tableBody = document.querySelector(
      "[data-project-table-body]",
    );

    this.searchInput = document.querySelector(
      "[data-project-search]",
    );

    this.statusFilter = document.querySelector(
      "[data-status-filter]",
    );

    this.filterForm = document.querySelector(
      ".sf-table-controls",
    );

    this.projectTable = document.querySelector(
      ".sf-project-table",
    );

    this.projectTableWrap = document.querySelector(
      ".sf-table-wrap",
    );

    this.kpiElements = {
      totalProjects: document.querySelector(
        "[data-kpi='totalProjects']",
      ),
      onTrack: document.querySelector(
        "[data-kpi='onTrack']",
      ),
      atRisk: document.querySelector(
        "[data-kpi='atRisk']",
      ),
      critical: document.querySelector(
        "[data-kpi='critical']",
      ),
    };
  },

  applyAppConfig() {
    document.title =
      `${APP_CONFIG.product.name} | Portfolio Overview`;

    if (this.wordmarkText) {
      this.wordmarkText.textContent =
        APP_CONFIG.product.name;
    }

    if (this.wordmarkLink) {
      this.wordmarkLink.setAttribute(
        "aria-label",
        `${APP_CONFIG.product.name} home`,
      );
    }

    this.renderCurrencyIndicator();
    this.setupPortfolioContext();
  },

  renderCurrencyIndicator() {
    if (!this.currencyIndicator) {
      return;
    }

    const { displayCurrency, organizationCurrency, conversionRequired, fxStatus } = getCurrencyState();
    const conversionReady = conversionRequired && fxStatus === "ready";
    const label =
      document.createElement("span");

    label.className = "sf-currency-label";
    label.textContent =
      `Currency ${String.fromCharCode(183)}`;

    this.currencyIndicator.setAttribute(
      "aria-label",
      conversionRequired
        ? conversionReady
          ? `Display currency: ${displayCurrency}. Converted from ${organizationCurrency}.`
          : `Display preference: ${displayCurrency}. Conversion unavailable; values remain in ${organizationCurrency}.`
        : `Display currency: ${displayCurrency}`,
    );

    this.currencyIndicator.replaceChildren(
      label,
      document.createTextNode(` ${displayCurrency}`),
    );
    this.currencyIndicator.dataset.fxDetail = String(conversionRequired);
    if (conversionRequired) {
      const status = document.createElement("span");
      status.className = "sf-currency-fallback";
      status.textContent = conversionReady ? `Converted from ${organizationCurrency}` : `Values in ${organizationCurrency}`;
      this.currencyIndicator.append(status);
    }
  },

  setupCurrencyPreferences() {
    const update = () => {
      const state = getCurrencyState();
      if (this.displayCurrencySelect) this.displayCurrencySelect.value = state.displayCurrency;
      if (this.organizationCurrencyValue) {
        const option = [...(this.displayCurrencySelect?.options ?? [])]
          .find((item) => item.value === state.organizationCurrency);
        this.organizationCurrencyValue.textContent = option?.textContent ?? state.organizationCurrency;
      }
      if (this.currencyStatus) {
        this.currencyStatus.replaceChildren();
        const addStatusRow = (text, className = "sf-fx-note") => {
          const row = document.createElement("p");
          row.className = className;
          row.textContent = text;
          this.currencyStatus.append(row);
        };
        if (!state.conversionRequired) {
          addStatusRow(`Values are displayed in ${state.baseCurrency}.`);
          addStatusRow("No exchange rate is required.");
        } else if (state.fxStatus === "loading") {
          addStatusRow("Loading exchange rate\u2026", "sf-fx-reference");
          addStatusRow(`Values remain in ${state.baseCurrency}.`, "sf-fx-caution");
        } else if (state.fxStatus === "ready") {
          const rate = new Intl.NumberFormat(APP_CONFIG.portfolio.locale, { maximumSignificantDigits: 7 }).format(state.rate);
          const date = new Intl.DateTimeFormat(APP_CONFIG.portfolio.locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${state.rateDate}T00:00:00Z`));
          const fetchedAt = new Date(state.fetchedAt);
          const fetchedDate = new Intl.DateTimeFormat(APP_CONFIG.portfolio.locale, { dateStyle: "medium" }).format(fetchedAt);
          const fetchedTime = new Intl.DateTimeFormat(APP_CONFIG.portfolio.locale, { timeStyle: "short" }).format(fetchedAt);
          addStatusRow(`1 ${state.baseCurrency} = ${rate} ${state.displayCurrency}`, "sf-fx-rate");
          addStatusRow(`Reference rate: ${state.provider} \u00b7 ${date}`, "sf-fx-reference");
          addStatusRow(`Retrieved: ${fetchedDate} \u00b7 ${fetchedTime}`);
          addStatusRow("Reference rate for display purposes.");
          addStatusRow(`Stored portfolio and governance values remain in ${state.baseCurrency}.`, "sf-fx-caution");
        } else {
          addStatusRow(`Selected display currency: ${state.displayCurrency}`, "sf-fx-reference");
          addStatusRow("Conversion is unavailable.");
          addStatusRow(state.fxError || "A valid reference rate could not be loaded.");
          addStatusRow(`Values remain in ${state.baseCurrency}.`, "sf-fx-caution");
        }
        if (!state.persistenceAvailable) addStatusRow("This browser could not save your preference.", "sf-fx-caution");
      }
      if (this.currencyPreview) {
        const sourceAmount = new Intl.NumberFormat(APP_CONFIG.portfolio.locale, { maximumFractionDigits: 0 }).format(100);
        const label = document.createElement("p");
        label.className = "sf-currency-preview-label";
        label.textContent = "Display example";
        const values = document.createElement("div");
        values.className = "sf-currency-preview-values";
        const source = document.createElement("span");
        source.textContent = `${state.organizationCurrency} ${sourceAmount}`;
        const arrow = document.createElement("span");
        arrow.textContent = "\u2192";
        const converted = document.createElement("strong");
        converted.textContent = formatDisplayCurrency(100);
        values.append(source, arrow, converted);
        this.currencyPreview.replaceChildren(label, values);
      }
      this.renderCurrencyIndicator();
    };
    this.displayCurrencySelect?.addEventListener("change", () => setDisplayCurrency(this.displayCurrencySelect.value));
    subscribeCurrencyChanges(update);
    registerCurrencyRenderer(this.mainArea, () => {
      this.refreshMonetaryPresentation();
      this.updatePrintCurrencyContext();
    });
    update();
    this.updatePrintCurrencyContext();
    refreshCurrencyRate();
  },

  updatePrintCurrencyContext() {
    if (!this.printCurrencyContext) return;
    const state = getCurrencyState();
    this.printCurrencyContext.textContent = state.conversionRequired && state.fxStatus === "ready"
      ? `Display currency: ${state.activeCurrency}. Converted from ${state.organizationCurrency} using ${state.provider} reference rates dated ${state.rateDate}. Stored values remain in ${state.organizationCurrency}.`
      : `Display currency: ${state.organizationCurrency} (organization currency).${state.conversionRequired ? ` ${state.displayCurrency} conversion unavailable.` : ""}`;
  },

  refreshMonetaryPresentation() {
    const projects = this.state.projects;
    if (!projects.length) return;
    this.renderFinancialPerformance(projects);
    if (this.portfolioAnalysisChart) this.portfolioAnalysisChart.replaceChildren(this.createSelectedPortfolioAnalysisChart(projects));
    this.renderPortfolioIntelligence(projects);
    this.renderBudgetKpis(projects);
    this.renderProjectVariance(projects);
    this.renderForecastingKpis(projects);
    this.renderPortfolioForecast(projects);
    this.renderProjectForecastAnalysis(projects);
    this.renderDecisionSupportKpis(projects);
    this.renderPriorityRecommendations(projects);
    this.renderDecisionFactors(projects);
    this.applyFilters();
  },

  setupPortfolioContext() {
    if (!this.pageHeading || !this.pageSubtitle) {
      return;
    }

    const organizationContext =
      document.createElement("p");
    const sampleDataNotice =
      document.createElement("p");
    const dataSourceNotice =
      document.createElement("p");

    organizationContext.className =
      "sf-organization-context";
    organizationContext.textContent =
      `${APP_CONFIG.organization.shortName} Portfolio`;

    dataSourceNotice.className =
      "sf-data-source-notice";
    dataSourceNotice.setAttribute("role", "status");
    dataSourceNotice.textContent =
      "Live data is temporarily unavailable. Showing simulated fallback data.";

    sampleDataNotice.className =
      "sf-sample-data-notice";
    sampleDataNotice.textContent =
      APP_CONFIG.portfolio.sampleDataNotice;

    this.pageSubtitle.after(
      dataSourceNotice,
      organizationContext,
      sampleDataNotice,
    );

    this.dataSourceNotice = dataSourceNotice;
    this.organizationContext =
      organizationContext;
    this.sampleDataNotice = sampleDataNotice;
    this.setPortfolioContextVisibility(false);
    this.setDataSourceNoticeVisibility(false);
  },

  setPortfolioContextVisibility(isVisible) {
    if (this.organizationContext) {
      this.organizationContext.hidden = !isVisible;
    }

    if (this.sampleDataNotice) {
      this.sampleDataNotice.hidden = !isVisible;
    }
  },

  setDataSourceNoticeVisibility(isVisible) {
    if (this.dataSourceNotice) {
      this.dataSourceNotice.hidden = !isVisible;
    }
  },

  setDefaultPageHeaderContext() {
    if (this.governanceBadge) this.governanceBadge.hidden = true;
    if (this.pageEyebrow) {
      this.pageEyebrow.textContent =
        "AI-Enabled Project Portfolio Intelligence";
    }

    if (this.pageSupportingLine) {
      this.pageSupportingLine.textContent = "";
      this.pageSupportingLine.hidden = true;
    }
  },

  setStakeholderPageHeaderContext() {
    if (this.governanceBadge) this.governanceBadge.hidden = true;
    if (this.pageEyebrow) {
      this.pageEyebrow.textContent =
        "PRESENTATION & STAKEHOLDER INTELLIGENCE";
    }

    if (this.pageSupportingLine) {
      this.pageSupportingLine.textContent =
        "Read-only views tailored for executive, sponsor and delivery conversations.";
      this.pageSupportingLine.hidden = false;
    }
  },

  setupSidebar() {
    this.appShell = document.querySelector(".sf-app-shell");
    this.mainArea = document.querySelector(".sf-main-area");
    this.sidebar = document.querySelector("#sf-sidebar");

    this.sidebarToggle = document.querySelector(
      "[data-sidebar-toggle]",
    );

    this.mobileMenuButton = document.querySelector(
      "[data-mobile-menu-button]",
    );

    this.sidebarCloseButton = document.querySelector(
      "[data-sidebar-close]",
    );

    this.sidebarOverlay = document.querySelector(
      "[data-sidebar-overlay]",
    );

    this.navLinks = document.querySelectorAll(
      ".sf-nav-link",
    );

    if (!this.appShell || !this.sidebar) {
      return;
    }

    this.sidebarToggle?.addEventListener(
      "click",
      () => this.toggleSidebar(),
    );

    this.mobileMenuButton?.addEventListener(
      "click",
      () => this.openSidebar(),
    );

    this.sidebarCloseButton?.addEventListener(
      "click",
      () => this.closeSidebar(),
    );

    this.sidebarOverlay?.addEventListener(
      "click",
      () => this.closeSidebar(),
    );

    this.navLinks.forEach((link) => {
      link.addEventListener("click", () => {
        if (this.isSmallScreen()) {
          this.closeSidebar();
        }
      });
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        this.closeSidebar();
      }
    });
  },

  setupFilters() {
    this.filterForm?.addEventListener(
      "submit",
      (event) => event.preventDefault(),
    );

    this.searchInput?.addEventListener(
      "input",
      () => {
        this.resetProjectPagination();
        this.applyFilters();
      },
    );

    this.statusFilter?.addEventListener(
      "change",
      () => {
        this.resetProjectPagination();
        this.applyFilters();
      },
    );
  },

  setupProjectFilters() {
    if (!this.filterForm) return;
    const header = this.projectsSection.querySelector(".sf-section-header");
    const quickViews = document.createElement("div");
    quickViews.className = "sf-explorer-quick-views";
    quickViews.setAttribute("role", "group");
    quickViews.setAttribute("aria-label", "Quick Views");
    this.explorerQuickButtons = new Map();
    EXPLORER_QUICK_VIEWS.forEach(([key, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.title = key === "over-budget" ? "Forecast exceeds approved budget (VAC < 0)"
        : key === "behind-schedule" ? "Schedule performance index is below target (SPI < 1)"
        : key === "high-risk" ? `Risk score above ${APP_CONFIG.portfolio.riskScoreBands.mediumMax}/25`
        : key === "ending-soon" ? "Ends within 60 days of the selected reference date" : label;
      button.addEventListener("click", () => {
        if (key === "all") this.clearProjectFilters();
        else {
          this.projectFilters.quickView = key;
          this.resetProjectPagination();
          this.applyFilters();
        }
      });
      this.explorerQuickButtons.set(key, button);
      quickViews.append(button);
    });
    const panel = document.createElement("details");
    panel.className = "sf-explorer-filter-panel";
    panel.open = window.matchMedia("(min-width: 721px)").matches;
    const summary = document.createElement("summary");
    summary.textContent = "Filters";
    panel.append(summary, this.filterForm);
    this.filterForm.classList.add("sf-explorer-controls");
    [this.searchInput, this.statusFilter].forEach((control) => {
      const label = this.filterForm.querySelector(`label[for="${control.id}"]`);
      const field = document.createElement("div");
      field.className = "sf-project-filter-field";
      label.classList.remove("sf-visually-hidden");
      field.append(label, control);
      this.filterForm.append(field);
    });
    this.searchInput.placeholder = "ID, project, manager or category";
    this.explorerFilterControls = new Map();
    const definitions = [
      ["priority", "Strategic Priority", "All Priorities", []],
      ["resourceDemand", "Resource Demand", "All Resource Demand", []],
      ["manager", "Project Manager", "All Managers", []],
      ["category", "Business Unit / Category", "All Business Units", []],
      ["risk", "Risk", "All Risk", [
        { key: "Low", label: `Low (0-${APP_CONFIG.portfolio.riskScoreBands.lowMax})` },
        { key: "Medium", label: `Medium (${APP_CONFIG.portfolio.riskScoreBands.lowMax + 1}-${APP_CONFIG.portfolio.riskScoreBands.mediumMax})` },
        { key: "High", label: `High (${APP_CONFIG.portfolio.riskScoreBands.mediumMax + 1}-25)` },
      ]],
      ["budget", `Budget (${APP_CONFIG.portfolio.currencyCode})`, "All Budgets", EXPLORER_BUDGET_RANGES],
    ];
    definitions.forEach(([key, label, allLabel, options]) => {
      const field = this.createProjectFilter({
        id: `project-${key}-filter`, label, className: "", allLabel, options,
        onChange: (value) => { this.projectFilters[key] = value; },
      });
      this.explorerFilterControls.set(key, field.querySelector("select"));
      this.filterForm.append(field);
    });
    const referenceField = document.createElement("label");
    referenceField.className = "sf-project-filter-field";
    const referenceLabel = document.createElement("span");
    referenceLabel.textContent = "Ending Soon reference date";
    this.explorerReferenceDate = document.createElement("input");
    this.explorerReferenceDate.type = "date";
    this.explorerReferenceDate.className = "sf-project-filter";
    const today = new Date();
    this.explorerReferenceDate.value = APP_CONFIG.portfolio.reportingDate
      || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    this.explorerReferenceDate.addEventListener("change", () => {
      this.resetProjectPagination();
      this.applyFilters();
    });
    referenceField.append(referenceLabel, this.explorerReferenceDate);
    this.explorerReferenceField = referenceField;
    this.filterForm.append(referenceField);
    this.explorerSummary = document.createElement("div");
    this.explorerSummary.className = "sf-explorer-filter-summary";
    this.explorerSummary.setAttribute("aria-label", "Active filters");
    header.after(quickViews, panel, this.explorerSummary);
  },

  refreshExplorerOptions() {
    const fields = { priority: "strategicPriority", resourceDemand: "resourceDemand", manager: "projectManager", category: "category" };
    Object.entries(fields).forEach(([key, field]) => {
      const select = this.explorerFilterControls?.get(key);
      if (!select) return;
      let values = getExplorerOptions(this.state.projects, field);
      if (key === "priority" || key === "resourceDemand") {
        const ranks = { High: 3, Medium: 2, Low: 1 };
        values = values.sort((a, b) => (ranks[b] ?? 0) - (ranks[a] ?? 0));
      }
      while (select.options.length > 1) select.remove(1);
      values.forEach((value) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        select.append(option);
      });
      if (!values.includes(this.projectFilters[key])) this.projectFilters[key] = "all";
      select.value = this.projectFilters[key];
    });
  },

  clearProjectFilters(key = null) {
    if (!key || key === "search") this.searchInput.value = "";
    if (!key || key === "status") this.statusFilter.value = "";
    Object.keys(this.projectFilters).forEach((field) => {
      if (!key || key === field) {
        this.projectFilters[field] = "all";
        const control = this.explorerFilterControls?.get(field);
        if (control) control.value = "all";
      }
    });
    this.resetProjectPagination();
    this.applyFilters();
    if (key || document.activeElement?.isConnected === false) {
      const control = key === "status" ? this.statusFilter
        : key === "quickView" ? this.explorerQuickButtons?.get("all")
        : this.explorerFilterControls?.get(key) ?? this.searchInput;
      control?.focus();
    }
  },

  renderExplorerSummary() {
    if (!this.explorerSummary) return;
    this.explorerSummary.replaceChildren();
    this.explorerQuickButtons.forEach((button, key) => {
      button.setAttribute("aria-pressed", String(key === this.projectFilters.quickView));
    });
    this.explorerReferenceField.hidden = this.projectFilters.quickView !== "ending-soon";
    const filters = [];
    if (this.searchInput.value.trim()) filters.push(["search", `Search: ${this.searchInput.value.trim()}`]);
    if (this.statusFilter.value) filters.push(["status", `Status: ${this.statusFilter.value}`]);
    const labels = { priority: "Priority", resourceDemand: "Resource", manager: "Manager", category: "Category", risk: "Risk", budget: `Budget (${APP_CONFIG.portfolio.currencyCode})` };
    Object.entries(labels).forEach(([key, label]) => {
      if (this.projectFilters[key] !== "all") {
        const select = this.explorerFilterControls.get(key);
        filters.push([key, `${label}: ${select.selectedOptions[0].textContent}`]);
      }
    });
    if (this.projectFilters.quickView !== "all") {
      const label = EXPLORER_QUICK_VIEWS.find(([key]) => key === this.projectFilters.quickView)[1];
      filters.push(["quickView", `Quick View: ${label}${this.projectFilters.quickView === "ending-soon" ? ` (60 days from ${this.explorerReferenceDate.value || "no date"})` : ""}`]);
    }
    filters.forEach(([key, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${label} \u00d7`;
      button.setAttribute("aria-label", `Remove ${label} filter`);
      button.addEventListener("click", () => this.clearProjectFilters(key));
      this.explorerSummary.append(button);
    });
    this.explorerSummary.hidden = !filters.length;
    if (filters.length) {
      const clear = document.createElement("button");
      clear.type = "button";
      clear.textContent = "Clear All";
      clear.addEventListener("click", () => this.clearProjectFilters());
      this.explorerSummary.append(clear);
    }
  },

  createProjectFilter({
    id,
    label,
    className,
    allLabel,
    options,
    onChange,
  }) {
    const wrapper =
      document.createElement("label");
    const labelText =
      document.createElement("span");
    const select =
      document.createElement("select");
    const allOption =
      document.createElement("option");

    wrapper.className = "sf-project-filter-field";
    wrapper.htmlFor = id;

    labelText.textContent = label;

    select.id = id;
    select.className =
      `sf-project-filter ${className}`;
    select.setAttribute("aria-label", label);

    allOption.value = "all";
    allOption.textContent = allLabel;
    select.append(allOption);

    options.forEach((optionValue) => {
      const option =
        document.createElement("option");

      option.value = typeof optionValue === "string" ? optionValue : optionValue.key;
      option.textContent = typeof optionValue === "string" ? optionValue : optionValue.label;

      select.append(option);
    });

    select.addEventListener("change", () => {
      onChange(select.value);
      this.resetProjectPagination();
      this.applyFilters();
    });

    wrapper.append(
      labelText,
      select,
    );

    return wrapper;
  },

  setupProjectSorting() {
    const headerCells =
      this.projectTable?.querySelectorAll("thead th");

    if (!headerCells) {
      return;
    }

    PROJECT_SORT_COLUMNS.forEach((column, index) => {
      const headerCell = headerCells[index];

      if (!headerCell) {
        return;
      }

      const button =
        document.createElement("button");
      const label =
        document.createElement("span");
      const indicator =
        document.createElement("span");

      button.type = "button";
      button.className = "sf-sort-button";
      button.dataset.sortKey = column.key;
      button.setAttribute(
        "aria-label",
        `Sort by ${column.label}`,
      );

      label.textContent = column.label;

      indicator.className = "sf-sort-indicator";
      indicator.setAttribute("aria-hidden", "true");

      button.append(
        label,
        indicator,
      );

      button.addEventListener("click", () => {
        this.handleProjectSort(column.key);
      });

      headerCell.replaceChildren(button);
    });

    this.updateProjectSortHeaders();
  },

  setupProjectResultCount() {
    const header =
      this.projectsSection?.querySelector(
        ".sf-section-header",
      );

    if (!header || !this.filterForm) {
      return;
    }

    const resultCount =
      document.createElement("span");

    resultCount.className =
      "sf-project-result-count";
    resultCount.setAttribute(
      "aria-live",
      "polite",
    );

    header.append(resultCount);

    this.projectResultCount = resultCount;
    this.updateProjectResultCount(0);
  },

  setupProjectPagination() {
    if (!this.projectsSection || !this.projectTableWrap) {
      return;
    }

    const pagination =
      document.createElement("div");
    const summary =
      document.createElement("span");
    const sizeLabel =
      document.createElement("label");
    const sizeText =
      document.createElement("span");
    const sizeSelect =
      document.createElement("select");
    const previousButton =
      document.createElement("button");
    const pageIndicator =
      document.createElement("span");
    const nextButton =
      document.createElement("button");

    pagination.className = "sf-project-pagination";
    summary.className = "sf-pagination-summary";
    sizeLabel.className = "sf-pagination-size";
    pageIndicator.className = "sf-pagination-page";

    sizeText.textContent = "Rows per page";

    PROJECT_PAGE_SIZES.forEach((pageSize) => {
      const option = document.createElement("option");

      option.value = String(pageSize);
      option.textContent = String(pageSize);

      sizeSelect.append(option);
    });

    sizeSelect.value = String(
      this.projectPagination.pageSize,
    );

    sizeSelect.addEventListener("change", () => {
      const nextPageSize =
        Number(sizeSelect.value);

      if (
        PROJECT_PAGE_SIZES.includes(nextPageSize)
      ) {
        this.projectPagination.pageSize =
          nextPageSize;
        this.resetProjectPagination();
        this.applyFilters();
      }
    });

    previousButton.type = "button";
    previousButton.className = "sf-pagination-button";
    previousButton.textContent = "Previous";
    previousButton.setAttribute(
      "aria-label",
      "Previous page",
    );
    previousButton.addEventListener("click", () => {
      if (this.projectPagination.currentPage <= 1) {
        return;
      }

      this.projectPagination.currentPage -= 1;
      this.applyFilters();
    });

    nextButton.type = "button";
    nextButton.className = "sf-pagination-button";
    nextButton.textContent = "Next";
    nextButton.setAttribute(
      "aria-label",
      "Next page",
    );
    nextButton.addEventListener("click", () => {
      this.projectPagination.currentPage += 1;
      this.applyFilters();
    });

    sizeLabel.append(
      sizeText,
      sizeSelect,
    );

    pagination.append(
      summary,
      sizeLabel,
      previousButton,
      pageIndicator,
      nextButton,
    );

    this.projectTableWrap.after(pagination);

    this.projectPaginationElements = {
      summary,
      sizeSelect,
      previousButton,
      pageIndicator,
      nextButton,
    };

    this.updateProjectPaginationControls({
      totalItems: 0,
      totalPages: 1,
      startItem: 0,
      endItem: 0,
    });
  },

  setupPortfolioAnalysis() {
    this.portfolioAnalysisSelect?.addEventListener(
      "change",
      () => {
        if (
          Object.hasOwn(
            PORTFOLIO_ANALYSES,
            this.portfolioAnalysisSelect.value,
          )
        ) {
          this.portfolioChartSelection =
            this.portfolioAnalysisSelect.value;
        }

        this.renderPortfolioAnalysis(
          this.state.projects,
        );
      },
    );

    this.radarProjectSelect?.addEventListener(
      "change",
      () => {
        this.portfolioRadarProjectId =
          this.radarProjectSelect.value || null;

        this.renderPortfolioAnalysis(
          this.state.projects,
        );
      },
    );
  },

  setupExportControls() {
    if (
      !this.accountArea ||
      this.accountArea.querySelector(".sf-export-control")
    ) {
      return;
    }

    const wrapper = document.createElement("div");
    const button = document.createElement("button");
    const icon = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    const path = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path",
    );
    const label = document.createElement("span");

    wrapper.className = "sf-export-control";

    button.type = "button";
    button.className = "sf-export-button";
    button.setAttribute(
      "aria-label",
      "Export current view as PDF",
    );
    button.title = "Export current view as PDF";

    icon.classList.add("sf-button-icon");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("focusable", "false");

    path.setAttribute(
      "d",
      "M12 3v12m0 0 4-4m-4 4-4-4M5 19h14",
    );

    label.className = "sf-export-button-label";
    label.textContent = "Export PDF";

    icon.append(path);
    button.append(
      icon,
      label,
    );

    wrapper.append(
      button,
    );

    this.accountArea.append(wrapper);

    this.exportControl = wrapper;
    this.exportButton = button;

    button.addEventListener("click", () => {
      this.handlePdfExport();
    });
  },

  handlePdfExport() {
    printCurrentView();
  },

  handleProjectSort(key) {
    const column = PROJECT_SORT_COLUMNS.find(
      (sortColumn) => sortColumn.key === key,
    );

    if (!column) {
      return;
    }

    if (this.projectSort.key === key) {
      this.projectSort = {
        key,
        direction:
          this.projectSort.direction === "asc"
            ? "desc"
            : "asc",
      };
    } else {
      this.projectSort = {
        key,
        direction: column.initialDirection,
      };
    }

    this.resetProjectPagination();
    this.updateProjectSortHeaders();
    this.applyFilters();
  },

  setupRouting() {
  this.navLinks.forEach((link) => {
    link.addEventListener(
      "click",
      (event) => this.handleNavigationClick(event, link),
    );
  });

  listenForRouteChanges(() => {
    this.renderRouteFromUrl();
  });
  },

  setupAuthChanges() {
    window.addEventListener(
      "auth:changed",
      () => {
        this.renderProjectsPageActions();
        this.governanceWorkflow?.handleAuthChange();

        const route = getCurrentRoute();

        if (route.view === "project") {
          this.showProjectDetail(route.projectId);
        }
      },
    );
  },

  async loadDashboard({
    allowCsvFallback = true,
  } = {}) {
    const loader = this.createDelayedLoader();

    this.renderTableMessage("Loading portfolio data...");

    try {
      const projects = await loadPortfolioData({
        allowCsvFallback,
      });
      const dataSource = getLastPortfolioDataSource();

      this.state.projects = projects;
      this.state.filteredProjects = projects;
      this.refreshExplorerOptions();

      this.setDataSourceNoticeVisibility(
        dataSource === "csv-fallback",
      );

      this.renderKpis(projects);
      this.renderFinancialPerformance(projects);
      this.renderPortfolioAnalysis(projects);
      this.renderPortfolioIntelligence(projects);
      this.renderBudgetKpis(projects);
      this.renderEvmPerformance(projects);
      this.renderProjectVariance(projects);
      this.renderForecastingKpis(projects);
      this.renderPortfolioForecast(projects);
      this.renderProjectForecastAnalysis(projects);
      renderScenarioAnalysis(this.scenarioAnalysis, projects, {
        onProjectChange: (project) => {
          renderSensitivityAnalysis(this.sensitivityAnalysis, project);
        },
      });
      this.renderDecisionSupportKpis(projects);
      this.renderPriorityRecommendations(projects);
      this.renderDecisionFactors(projects);
      const governanceAssessment = renderGovernanceView(
        this.governanceView,
        projects,
      );
      const governanceRestore = this.governanceWorkflowRestore;
      this.governanceWorkflowRestore = null;
      this.governanceWorkflow = initGovernanceWorkflow({
        container: this.governanceView?.querySelector(
          "[data-governance-workflow]",
        ),
        projects,
        assessment: governanceAssessment,
        initialSelectedId: governanceRestore?.requestId ?? null,
        initialSuccess: governanceRestore?.successMessage ?? "",
        onProjectDataRefresh: async ({ requestId, successMessage = "" }) => {
          this.governanceWorkflowRestore = { requestId, successMessage };
          try {
            await this.loadDashboard({ allowCsvFallback: false });
          } catch (error) {
            this.governanceWorkflowRestore = null;
            throw error;
          }
        },
      });
      this.applyFilters();
      this.renderRouteFromUrl();
    } catch (error) {
      console.error("Portfolio data load failed:", error);

      this.renderKpis([]);
      this.portfolioIntelligenceContent?.replaceChildren(
        Object.assign(document.createElement("p"), {
          textContent: "Portfolio intelligence is unavailable because the latest project data could not be loaded.",
        }),
      );

      this.renderTableMessage(
        "Portfolio data could not be loaded.",
        "error",
      );

      if (!allowCsvFallback) {
        throw error;
      }
    } finally {
      await loader.hide();
    }
  },

  createDelayedLoader() {
    const showDelay = 225;
    const minimumVisibleTime = 300;
    let isVisible = false;
    let shownAt = 0;
    let timeoutId = window.setTimeout(() => {
      this.showAppLoader();
      isVisible = true;
      shownAt = Date.now();
    }, showDelay);

    return {
      hide: async () => {
        if (timeoutId) {
          window.clearTimeout(timeoutId);
          timeoutId = null;
        }

        if (!isVisible) {
          return;
        }

        const elapsed = Date.now() - shownAt;
        const remaining = minimumVisibleTime - elapsed;

        if (remaining > 0) {
          await new Promise((resolve) => {
            window.setTimeout(resolve, remaining);
          });
        }

        this.hideAppLoader();
      },
    };
  },

  showAppLoader() {
    if (
      !this.mainArea ||
      this.mainArea.querySelector(".sf-app-loader")
    ) {
      return;
    }

    const loader = document.createElement("div");
    const mark = document.createElement("div");
    const ring = document.createElement("span");
    const letter = document.createElement("span");
    const text = document.createElement("p");

    loader.className = "sf-app-loader";
    loader.setAttribute("role", "status");
    loader.setAttribute("aria-live", "polite");

    mark.className = "sf-app-loader-mark";
    ring.className = "sf-app-loader-ring";
    letter.className = "sf-app-loader-letter";
    letter.textContent = "S";

    text.className = "sf-app-loader-text";
    text.textContent = "Loading portfolio…";

    mark.append(
      ring,
      letter,
    );
    loader.append(
      mark,
      text,
    );

    this.mainArea.append(loader);
  },

  hideAppLoader() {
    this.mainArea
      ?.querySelector(".sf-app-loader")
      ?.remove();
  },

  applyFilters() {
    this.state.filteredProjects = filterExplorerProjects(this.state.projects, {
      ...this.projectFilters,
      search: this.searchInput?.value ?? "",
      status: this.statusFilter?.value ?? "",
    }, this.explorerReferenceDate?.value);
    this.renderExplorerSummary();

    this.updateProjectResultCount(
      this.state.filteredProjects.length,
    );

    const sortedProjects =
      this.getSortedProjects(
        this.state.filteredProjects,
      );

    const paginatedProjects =
      this.getPaginatedProjects(sortedProjects);

    this.renderProjects(
      paginatedProjects.projects,
    );

    this.updateProjectPaginationControls(
      paginatedProjects,
    );
  },

  updateProjectResultCount(count) {
    if (!this.projectResultCount) {
      return;
    }

    this.projectResultCount.textContent =
      `${count}${count !== this.state.projects.length ? ` of ${this.state.projects.length}` : ""} ${count === 1 && count === this.state.projects.length ? "project" : "projects"}`;
  },

  resetProjectPagination() {
    this.projectPagination.currentPage = 1;
  },

  getSortedProjects(projects) {
    const sortColumn =
      PROJECT_SORT_COLUMNS.find((column) => {
        return column.key === this.projectSort.key;
      });

    if (!sortColumn) {
      return [...projects];
    }

    const directionFactor =
      this.projectSort.direction === "asc" ? 1 : -1;

    return [...projects].sort((projectA, projectB) => {
      const comparison =
        this.compareProjectSortValues(
          projectA,
          projectB,
          sortColumn,
        );

      if (comparison !== 0) {
        return comparison * directionFactor;
      }

      return String(projectA.projectName ?? "")
        .localeCompare(
          String(projectB.projectName ?? ""),
          undefined,
          {
            sensitivity: "base",
            numeric: true,
          },
        );
    });
  },

  compareProjectSortValues(
    projectA,
    projectB,
    sortColumn,
  ) {
    if (sortColumn.type === "number") {
      return (
        Number(projectA[sortColumn.key] ?? 0) -
        Number(projectB[sortColumn.key] ?? 0)
      );
    }

    if (sortColumn.type === "rank") {
      return (
        Number(
          sortColumn.ranks?.[
            projectA[sortColumn.key]
          ] ?? 0,
        ) -
        Number(
          sortColumn.ranks?.[
            projectB[sortColumn.key]
          ] ?? 0,
        )
      );
    }

    return String(projectA[sortColumn.key] ?? "")
      .localeCompare(
        String(projectB[sortColumn.key] ?? ""),
        undefined,
        {
          sensitivity: "base",
          numeric: true,
        },
      );
  },

  getPaginatedProjects(projects) {
    const totalItems = projects.length;
    const pageSize =
      this.projectPagination.pageSize;
    const totalPages = Math.max(
      1,
      Math.ceil(totalItems / pageSize),
    );

    if (this.projectPagination.currentPage > totalPages) this.projectPagination.currentPage = 1;

    if (totalItems === 0) {
      this.projectPagination.currentPage = 1;

      return {
        projects: [],
        totalItems,
        totalPages,
        startItem: 0,
        endItem: 0,
      };
    }

    this.projectPagination.currentPage = Math.min(
      Math.max(
        this.projectPagination.currentPage,
        1,
      ),
      totalPages,
    );

    const startIndex =
      (this.projectPagination.currentPage - 1) *
      pageSize;
    const endIndex = Math.min(
      startIndex + pageSize,
      totalItems,
    );

    return {
      projects: projects.slice(
        startIndex,
        endIndex,
      ),
      totalItems,
      totalPages,
      startItem: startIndex + 1,
      endItem: endIndex,
    };
  },

  updateProjectPaginationControls({
    totalItems,
    totalPages,
    startItem,
    endItem,
  }) {
    const elements =
      this.projectPaginationElements;

    if (!elements) {
      return;
    }

    elements.summary.textContent =
      totalItems === 0
        ? "Showing 0 of 0"
        : `Showing ${startItem}-${endItem} of ${totalItems}`;

    elements.sizeSelect.value = String(
      this.projectPagination.pageSize,
    );

    elements.previousButton.disabled =
      this.projectPagination.currentPage === 1;

    elements.nextButton.disabled =
      this.projectPagination.currentPage >= totalPages;

    elements.pageIndicator.textContent =
      `Page ${this.projectPagination.currentPage} of ${totalPages}`;
  },

  updateProjectSortHeaders() {
    const headerCells =
      this.projectTable?.querySelectorAll("thead th");

    headerCells?.forEach((headerCell) => {
      const button =
        headerCell.querySelector(".sf-sort-button");
      const indicator =
        headerCell.querySelector(".sf-sort-indicator");
      const isActive =
        button?.dataset.sortKey === this.projectSort.key;

      if (!button || !indicator) {
        return;
      }

      button.classList.toggle(
        "sf-sort-button--active",
        isActive,
      );

      if (isActive) {
        const ariaSort =
          this.projectSort.direction === "asc"
            ? "ascending"
            : "descending";

        headerCell.setAttribute(
          "aria-sort",
          ariaSort,
        );

        indicator.textContent =
          this.projectSort.direction === "asc"
            ? "↑"
            : "↓";
      } else {
        headerCell.removeAttribute("aria-sort");
        indicator.textContent = "";
      }
    });
  },

renderRouteFromUrl() {
  const route = getCurrentRoute();

  if (this.governanceView) {
    this.governanceView.hidden = route.view !== "governance";
  }

  if (route.view === "project") {
    this.showProjectDetail(route.projectId);
    return;
  }

  if (route.view === "projects") {
    this.showPortfolioView({
      activeArea: "Projects",
      focusProjects: true,
    });

    return;
  }

  if (route.view === "budget") {
    this.showBudgetView();

    return;
  }

  if (route.view === "forecasting") {
    this.showForecastingView();

    return;
  }

  if (route.view === "decision-support") {
    this.showDecisionSupportView();

    return;
  }

  if (route.view === "governance") {
    this.showGovernanceView();
    return;
  }

  if (route.view === "stakeholder-view") {
    this.showStakeholderView();

    return;
  }

  if (route.view === "settings") {
    this.showSettingsView();
    return;
  }

  this.showPortfolioView({
    activeArea: "Portfolio",
  });
},

showSettingsView() {
  this.setDefaultPageHeaderContext();
  this.state.currentProjectId = null;
  this.pageTitle.textContent = "Settings";
  this.pageSubtitle.textContent = "Application preferences.";
  this.setPortfolioContextVisibility(false);
  [
    ...this.portfolioOverviewViews,
    ...this.projectsViews,
    this.projectDetail,
    this.budgetView,
    this.forecastingView,
    this.decisionSupportView,
    this.governanceView,
    this.stakeholderView,
  ].forEach((view) => { if (view) view.hidden = true; });
  this.setNavigationArea("Settings");
  this.renderProjectsPageActions();
  this.mainArea.scrollTop = 0;
},

  getProjectById(projectId) {
    return this.state.projects.find((project) => {
      return (
        project.projectId.toLowerCase() ===
        String(projectId).toLowerCase()
      );
    });
  },

openProject(projectId) {
  pushProjectRoute(projectId);
  this.showProjectDetail(projectId);
},

navigateToPortfolio() {
  pushPortfolioRoute();

  this.showPortfolioView({
    activeArea: "Portfolio",
  });
},

navigateToProjects() {
  pushProjectsRoute();

  this.showPortfolioView({
    activeArea: "Projects",
    focusProjects: true,
  });
},

showPortfolioView({
  activeArea = "Portfolio",
  focusProjects = false,
} = {}) {
    if (this.governanceView) this.governanceView.hidden = true;
    this.setDefaultPageHeaderContext();

    this.state.currentProjectId = null;

    const isProjectsView =
      activeArea === "Projects";

    this.pageTitle.textContent =
      isProjectsView
        ? "Projects"
        : "Portfolio Overview";

    this.pageSubtitle.textContent =
      isProjectsView
        ? "Browse and review individual project performance."
        : "Monitor performance, budget, risk and portfolio health.";

    this.setPortfolioContextVisibility(
      !isProjectsView,
    );

    this.portfolioOverviewViews.forEach(
      (view) => {
        view.hidden = isProjectsView;
      },
    );

    if (this.budgetView) {
      this.budgetView.hidden = true;
    }

    if (this.forecastingView) {
      this.forecastingView.hidden = true;
    }

    if (this.decisionSupportView) {
      this.decisionSupportView.hidden = true;
    }

    if (this.stakeholderView) {
      this.stakeholderView.hidden = true;
    }

    this.projectsViews.forEach((view) => {
      view.hidden = !isProjectsView;
    });

    this.projectDetail.hidden = true;
    this.projectDetail.replaceChildren();

    this.setNavigationArea(activeArea);
    this.renderProjectsPageActions();

    if (focusProjects) {
      this.focusProjectsSection();
    }
  },

  showProjectDetail(projectId) {
    if (this.governanceView) this.governanceView.hidden = true;
    this.setDefaultPageHeaderContext();

    const project =
      this.getProjectById(projectId);

    this.state.currentProjectId =
      projectId;

    this.portfolioOverviewViews.forEach(
      (view) => {
        view.hidden = true;
      },
    );

    this.projectsViews.forEach((view) => {
      view.hidden = true;
    });

    if (this.budgetView) {
      this.budgetView.hidden = true;
    }

    if (this.forecastingView) {
      this.forecastingView.hidden = true;
    }

    if (this.decisionSupportView) {
      this.decisionSupportView.hidden = true;
    }

    if (this.stakeholderView) {
      this.stakeholderView.hidden = true;
    }

    this.projectDetail.hidden = false;
    this.projectDetail.replaceChildren();

    this.pageTitle.textContent =
      "Project Performance";

    this.pageSubtitle.textContent =
      "Review project baseline, progress, risk and resource context.";

    this.setPortfolioContextVisibility(false);

    this.setNavigationArea("Projects");

    if (!project) {
        renderProjectNotFound(
        this.projectDetail,
        {
          onBackToProjects: () => {
            this.navigateToProjects();
          },
        },
      );

      return;
  }

    this.renderProjectDetail(project);
  },

showBudgetView() {
  if (this.governanceView) this.governanceView.hidden = true;
  this.setDefaultPageHeaderContext();

  this.state.currentProjectId = null;

  this.pageTitle.textContent = "Budget & EVM";

  this.pageSubtitle.textContent =
    "Monitor portfolio cost, schedule efficiency and project variances.";

  this.setPortfolioContextVisibility(false);

  this.portfolioOverviewViews.forEach((view) => {
    view.hidden = true;
  });

  this.projectsViews.forEach((view) => {
    view.hidden = true;
  });

  this.projectDetail.hidden = true;

  if (this.budgetView) {
    this.budgetView.hidden = false;
  }

  if (this.forecastingView) {
    this.forecastingView.hidden = true;
  }

  if (this.decisionSupportView) {
    this.decisionSupportView.hidden = true;
  }

  if (this.stakeholderView) {
    this.stakeholderView.hidden = true;
  }

  this.setNavigationArea("Budget & EVM");
},

showForecastingView() {
  if (this.governanceView) this.governanceView.hidden = true;
  this.setDefaultPageHeaderContext();

  this.state.currentProjectId = null;

  this.pageTitle.textContent = "Forecasting";

  this.pageSubtitle.textContent =
    "Forecast projected costs, remaining spend and budget exposure.";

  this.setPortfolioContextVisibility(false);

  this.portfolioOverviewViews.forEach((view) => {
    view.hidden = true;
  });

  this.projectsViews.forEach((view) => {
    view.hidden = true;
  });

  this.projectDetail.hidden = true;

  if (this.budgetView) {
    this.budgetView.hidden = true;
  }

  if (this.decisionSupportView) {
    this.decisionSupportView.hidden = true;
  }

  if (this.forecastingView) {
    this.forecastingView.hidden = false;
  }

  if (this.stakeholderView) {
    this.stakeholderView.hidden = true;
  }

  this.setNavigationArea("Forecasting");
},

showDecisionSupportView() {
  if (this.governanceView) this.governanceView.hidden = true;
  this.setDefaultPageHeaderContext();

  this.state.currentProjectId = null;

  this.pageTitle.textContent = "Decision Support";

  this.pageSubtitle.textContent =
    "Prioritize management attention using performance, risk and forecast signals.";

  this.setPortfolioContextVisibility(false);

  this.portfolioOverviewViews.forEach((view) => {
    view.hidden = true;
  });

  this.projectsViews.forEach((view) => {
    view.hidden = true;
  });

  this.projectDetail.hidden = true;

  if (this.budgetView) {
    this.budgetView.hidden = true;
  }

  if (this.forecastingView) {
    this.forecastingView.hidden = true;
  }

  if (this.decisionSupportView) {
    this.decisionSupportView.hidden = false;
  }

  if (this.stakeholderView) {
    this.stakeholderView.hidden = true;
  }

  this.setNavigationArea("Decision Support");
},

showGovernanceView() {
  this.state.currentProjectId = null;
  this.setDefaultPageHeaderContext();
  this.governanceBadge.hidden = false;
  this.pageEyebrow.textContent = "BUDGET CONTROL & GOVERNANCE";
  this.pageTitle.textContent = "Budget Governance";
  this.pageSubtitle.textContent =
    "Assess proposed budget changes before they affect the approved baseline.";
  this.pageSupportingLine.textContent =
    "Review financial impact, governance requirements and baseline implications without modifying project records.";
  this.pageSupportingLine.hidden = false;
  this.setPortfolioContextVisibility(false);
  this.portfolioOverviewViews.forEach((view) => { view.hidden = true; });
  this.projectsViews.forEach((view) => { view.hidden = true; });
  this.projectDetail.hidden = true;
  this.budgetView.hidden = true;
  this.forecastingView.hidden = true;
  this.decisionSupportView.hidden = true;
  this.stakeholderView.hidden = true;
  this.governanceView.hidden = false;
  this.setNavigationArea("Governance");
},

showStakeholderView() {
  if (this.governanceView) this.governanceView.hidden = true;
  this.state.currentProjectId = null;

  this.setStakeholderPageHeaderContext();

  this.pageTitle.textContent = "Stakeholder View";

  this.pageSubtitle.textContent =
    "Present the right portfolio signals to the right audience.";

  this.setPortfolioContextVisibility(false);

  this.portfolioOverviewViews.forEach((view) => {
    view.hidden = true;
  });

  this.projectsViews.forEach((view) => {
    view.hidden = true;
  });

  this.projectDetail.hidden = true;

  if (this.budgetView) {
    this.budgetView.hidden = true;
  }

  if (this.forecastingView) {
    this.forecastingView.hidden = true;
  }

  if (this.decisionSupportView) {
    this.decisionSupportView.hidden = true;
  }

  if (this.stakeholderView) {
    this.stakeholderView.hidden = false;
    renderStakeholderView(
      this.stakeholderView,
      this.state.projects,
    );
  }

  this.setNavigationArea("Stakeholder View");
},

renderKpis(projects) {
  const summary =
    getPortfolioStatusSummary(projects);

  this.kpiElements.totalProjects.textContent =
    String(summary.totalProjects);

  this.kpiElements.onTrack.textContent =
    String(summary.onTrack);

  this.kpiElements.atRisk.textContent =
    String(summary.atRisk);

  this.kpiElements.critical.textContent =
    String(summary.critical);
},

renderFinancialPerformance(projects) {
  const summary =
    getPortfolioFinancialSummary(projects);

  const chart =
    createFinancialPerformanceChart(summary);

  this.financialChart.replaceChildren(chart);
},

renderPortfolioAnalysis(projects) {
  if (!this.portfolioAnalysisChart) {
    return;
  }

  const analysis =
    PORTFOLIO_ANALYSES[this.portfolioChartSelection] ??
    PORTFOLIO_ANALYSES["risk-completion"];

  if (this.portfolioAnalysisSelect) {
    this.portfolioAnalysisSelect.value =
      this.portfolioChartSelection;
  }

  if (this.portfolioAnalysisTitle) {
    this.portfolioAnalysisTitle.textContent =
      analysis.title;
  }

  if (this.portfolioAnalysisDescription) {
    this.portfolioAnalysisDescription.textContent =
      analysis.description;
  }

  this.updateRadarProjectControl(projects);

  const chart =
    this.createSelectedPortfolioAnalysisChart(projects);

  this.portfolioAnalysisChart.replaceChildren(chart);
},

updateRadarProjectControl(projects) {
  const isRadar =
    this.portfolioChartSelection === "health-radar";

  if (this.radarProjectControl) {
    this.radarProjectControl.hidden = !isRadar;
  }

  if (!this.radarProjectSelect || !isRadar) {
    return;
  }

  const currentSelection =
    this.portfolioRadarProjectId;

  this.radarProjectSelect.replaceChildren();

  projects.forEach((project) => {
    if (!project.projectId) {
      return;
    }

    const option =
      document.createElement("option");

    option.value = project.projectId;
    option.textContent =
      project.projectName || project.projectId;

    this.radarProjectSelect.append(option);
  });

  const hasCurrentSelection = projects.some((project) => {
    return project.projectId === currentSelection;
  });

  if (!hasCurrentSelection) {
    this.portfolioRadarProjectId =
      projects[0]?.projectId ?? null;
  }

  if (this.portfolioRadarProjectId) {
    this.radarProjectSelect.value =
      this.portfolioRadarProjectId;
  }
},

createSelectedPortfolioAnalysisChart(projects) {
  if (
    !projects.length &&
    this.portfolioChartSelection === "health-radar"
  ) {
    return createProjectHealthRadar(null);
  }

  if (!projects.length) {
    const message =
      document.createElement("p");

    message.className = "sf-chart-empty";
    message.textContent =
      "No project data is available for this analysis.";

    return message;
  }

  if (this.portfolioChartSelection === "resource-demand") {
    return createResourceDemandChart(
      getResourceDemandByStatus(projects),
    );
  }

  if (this.portfolioChartSelection === "budget-actual") {
    return createBudgetActualChart(projects);
  }

  if (this.portfolioChartSelection === "project-completion") {
    return createProjectCompletionChart(projects);
  }

  if (this.portfolioChartSelection === "project-risk") {
    return createProjectRiskChart(projects);
  }

  if (this.portfolioChartSelection === "status-distribution") {
    return createStatusDistributionChart(projects);
  }

  if (this.portfolioChartSelection === "priority-distribution") {
    return createPriorityDistributionChart(projects);
  }

  if (this.portfolioChartSelection === "health-heatmap") {
    return createProjectHealthHeatmap(projects);
  }

  if (this.portfolioChartSelection === "health-radar") {
    const project = projects.find((candidate) => {
      return (
        candidate.projectId ===
        this.portfolioRadarProjectId
      );
    });

    return createProjectHealthRadar(project);
  }

  return createRiskCompletionChart(projects);
},

renderEvmPerformance(projects) {
  const container = this.evmPerformance;

  if (!container) return;

  const summary = calculatePortfolioEvmSummary(projects);

  const chart = createPortfolioEvmPerformanceChart(summary);

  container.replaceChildren(chart);
},

renderProjectVariance(projects) {
  const container = this.varianceAnalysis;

  if (!container) return;

  const data = getProjectVarianceData(projects);

  const chart = createProjectVarianceChart(data);

  container.replaceChildren(chart);
},

renderPortfolioForecast(projects) {
  const container = this.portfolioForecast;

  if (!container) return;

  const forecast = calculatePortfolioForecast(projects);

  const chart = createPortfolioForecastChart(forecast);

  container.replaceChildren(chart);
},

renderProjectForecastAnalysis(projects) {
  const container = this.projectForecastAnalysis;

  if (!container) return;

  const data = getProjectForecastData(projects);

  const chart = createProjectForecastAnalysisChart(data);

  container.replaceChildren(chart);
},

renderBudgetKpis(projects) {
  const summary = calculatePortfolioEvmSummary(projects);

  const cards = this.budgetKpiCards;

  if (!cards || cards.length < 4) {
    return;
  }

  const [cvCard, svCard, cpiCard, spiCard] = Array.from(cards);

  const setCard = (card, labelText, valueText) => {
    if (!card) return;

    const label = card.querySelector(".sf-kpi-label");
    const value = card.querySelector(".sf-kpi-value");

    if (label) label.textContent = labelText;
    if (value) value.textContent = valueText;
  };

  const cvText = formatDisplayCurrency(summary.cv);
  const svText = formatDisplayCurrency(summary.sv);

  const cpiText = summary.cpi === null ? "—" : String(summary.cpi.toFixed(2));
  const spiText = summary.spi === null ? "—" : String(summary.spi.toFixed(2));

  setCard(cvCard, "Cost Variance (CV)", cvText);
  setCard(svCard, "Schedule Variance (SV)", svText);
  setCard(cpiCard, "Cost Performance Index (CPI)", cpiText);
  setCard(spiCard, "Schedule Performance Index (SPI)", spiText);

  const cvValueEl = cvCard?.querySelector(".sf-kpi-value");
  const svValueEl = svCard?.querySelector(".sf-kpi-value");
  const cpiValueEl = cpiCard?.querySelector(".sf-kpi-value");
  const spiValueEl = spiCard?.querySelector(".sf-kpi-value");

  const removeSemantic = (el) => {
    if (!el) return;
    el.classList.remove(
      "sf-kpi-value--success",
      "sf-kpi-value--warning",
      "sf-kpi-value--danger",
    );
  };

  removeSemantic(cvValueEl);
  removeSemantic(svValueEl);
  removeSemantic(cpiValueEl);
  removeSemantic(spiValueEl);

  /* CV / SV semantics: value < 0 danger, > 0 success, =0 none */
  const cvVal = summary.cv;
  const svVal = summary.sv;

  if (cvValueEl) {
    if (cvVal < 0) cvValueEl.classList.add("sf-kpi-value--danger");
    else if (cvVal > 0) cvValueEl.classList.add("sf-kpi-value--success");
  }

  if (svValueEl) {
    if (svVal < 0) svValueEl.classList.add("sf-kpi-value--danger");
    else if (svVal > 0) svValueEl.classList.add("sf-kpi-value--success");
  }

  /* CPI / SPI semantics use configured warning and target indexes. */
  const cpiVal = summary.cpi;
  const spiVal = summary.spi;
  const { warningIndex, targetIndex } =
    APP_CONFIG.portfolio.performanceThresholds;

  if (cpiValueEl && cpiVal !== null && typeof cpiVal !== "undefined") {
    if (cpiVal < warningIndex) cpiValueEl.classList.add("sf-kpi-value--danger");
    else if (cpiVal >= warningIndex && cpiVal < targetIndex) cpiValueEl.classList.add("sf-kpi-value--warning");
    else if (cpiVal >= targetIndex) cpiValueEl.classList.add("sf-kpi-value--success");
  }

  if (spiValueEl && spiVal !== null && typeof spiVal !== "undefined") {
    if (spiVal < warningIndex) spiValueEl.classList.add("sf-kpi-value--danger");
    else if (spiVal >= warningIndex && spiVal < targetIndex) spiValueEl.classList.add("sf-kpi-value--warning");
    else if (spiVal >= targetIndex) spiValueEl.classList.add("sf-kpi-value--success");
  }
},

renderForecastingKpis(projects) {
  const forecast = calculatePortfolioForecast(projects);

  const cards = this.forecastingKpiCards;

  if (!cards || cards.length < 4) {
    return;
  }

  const [eacCard, etcCard, vacCard, tcpiCard] = Array.from(cards);

  const setCard = (card, labelText, valueText) => {
    if (!card) return;

    const label = card.querySelector(".sf-kpi-label");
    const value = card.querySelector(".sf-kpi-value");

    if (label) label.textContent = labelText;
    if (value) value.textContent = valueText;
  };

  const eacText = forecast.eac === null ? "—" : formatDisplayCurrency(forecast.eac);
  const etcText = forecast.etc === null ? "—" : formatDisplayCurrency(forecast.etc);
  const vacText = forecast.vac === null ? "—" : formatDisplayCurrency(forecast.vac);
  const tcpiText = forecast.tcpi === null ? "—" : String(forecast.tcpi.toFixed(2));

  setCard(eacCard, "Estimate at Completion (EAC)", eacText);
  setCard(etcCard, "Estimate to Complete (ETC)", etcText);
  setCard(vacCard, "Variance at Completion (VAC)", vacText);
  setCard(tcpiCard, "To-Complete Performance Index (TCPI)", tcpiText);

  // Apply semantic styling to VAC and TCPI only
  const vacValueEl = vacCard?.querySelector(".sf-kpi-value");
  const tcpiValueEl = tcpiCard?.querySelector(".sf-kpi-value");

  const removeSemantic = (el) => {
    if (!el) return;
    el.classList.remove(
      "sf-kpi-value--success",
      "sf-kpi-value--warning",
      "sf-kpi-value--danger",
    );
  };

  removeSemantic(vacValueEl);
  removeSemantic(tcpiValueEl);

  /* VAC semantics: value < 0 danger, > 0 success, =0 none */
  const vacVal = forecast.vac;

  if (vacValueEl) {
    if (vacVal < 0) vacValueEl.classList.add("sf-kpi-value--danger");
    else if (vacVal > 0) vacValueEl.classList.add("sf-kpi-value--success");
  }

  /* TCPI semantics use configured target and pressure indexes. */
  const tcpiVal = forecast.tcpi;
  const {
    targetIndex,
    highCompletionPressureTcpi,
  } = APP_CONFIG.portfolio.performanceThresholds;

  if (tcpiValueEl && tcpiVal !== null && typeof tcpiVal !== "undefined") {
    if (tcpiVal <= targetIndex) tcpiValueEl.classList.add("sf-kpi-value--success");
    else if (tcpiVal > targetIndex && tcpiVal <= highCompletionPressureTcpi) tcpiValueEl.classList.add("sf-kpi-value--warning");
    else if (tcpiVal > highCompletionPressureTcpi) tcpiValueEl.classList.add("sf-kpi-value--danger");
  }
},

renderDecisionSupportKpis(projects) {
  const summary = calculateDecisionSupportSummary(projects);

  const cards = this.decisionSupportKpiCards;

  if (!cards || cards.length < 4) {
    return;
  }

  const [attentionCard, criticalCard, exposureCard, actionsCard] = Array.from(cards);

  const setCard = (card, labelText, valueText) => {
    if (!card) return;

    const label = card.querySelector(".sf-kpi-label");
    const value = card.querySelector(".sf-kpi-value");

    if (label) label.textContent = labelText;
    if (value) value.textContent = valueText;
  };

  setCard(attentionCard, "Projects Requiring Attention", String(summary.projectsRequiringAttention));
  setCard(criticalCard, "Critical Priority", String(summary.criticalPriority));
  setCard(exposureCard, "Forecast Budget Exposure", formatDisplayCurrency(summary.forecastBudgetExposure));
  setCard(actionsCard, "Recommended Actions", String(summary.recommendedActions));

  const attentionValueEl = attentionCard?.querySelector(".sf-kpi-value");
  const criticalValueEl = criticalCard?.querySelector(".sf-kpi-value");
  const exposureValueEl = exposureCard?.querySelector(".sf-kpi-value");
  const actionsValueEl = actionsCard?.querySelector(".sf-kpi-value");

  const removeSemantic = (el) => {
    if (!el) return;
    el.classList.remove(
      "sf-kpi-value--success",
      "sf-kpi-value--warning",
      "sf-kpi-value--danger",
    );
  };

  removeSemantic(attentionValueEl);
  removeSemantic(criticalValueEl);
  removeSemantic(exposureValueEl);
  removeSemantic(actionsValueEl);

  /* Projects Requiring Attention: > 0 warning, = 0 none */
  if (attentionValueEl && summary.projectsRequiringAttention > 0) {
    attentionValueEl.classList.add("sf-kpi-value--warning");
  }

  /* Critical Priority: > 0 danger, = 0 none */
  if (criticalValueEl && summary.criticalPriority > 0) {
    criticalValueEl.classList.add("sf-kpi-value--danger");
  }

  /* Forecast Budget Exposure: > 0 danger, = 0 none */
  if (exposureValueEl && summary.forecastBudgetExposure > 0) {
    exposureValueEl.classList.add("sf-kpi-value--danger");
  }

  /* Recommended Actions: keep neutral */
},

renderPriorityRecommendations(projects) {
  const container = this.priorityRecommendations;

  if (!container) return;

  const recommendations = getPriorityRecommendations(projects);

  const list = createPriorityRecommendationsList(recommendations);

  container.replaceChildren(list);
},

renderDecisionFactors(projects) {
  const container = this.decisionFactors;

  if (!container) return;

  const recommendations = getPriorityRecommendations(projects);

  const list = createDecisionFactorsList(recommendations);

  container.replaceChildren(list);
},

renderProjectsPageActions() {
  const header =
    this.projectsSection?.querySelector(
      ".sf-section-header",
    );

  header
    ?.querySelectorAll(
      ".sf-project-create-button, .sf-project-management-actions",
    )
    .forEach((button) => {
      button.remove();
    });

  if (
    !header ||
    this.projectsSection.hidden ||
    !isAuthenticated()
  ) {
    return;
  }

  const button =
    document.createElement("button");

  button.type = "button";
  button.className =
    "sf-project-create-button";
  button.textContent = "New Project";

  button.addEventListener(
    "click",
    () => {
      this.openNewProjectForm();
    },
  );

  const importButton = document.createElement("button");
  importButton.type = "button";
  importButton.className = "sf-project-import-button";
  importButton.textContent = "Import Projects";
  importButton.addEventListener("click", () => openProjectImport({
    onImported: async (result) => {
      await this.loadDashboard({ allowCsvFallback: false });
      const projectIds = new Set(this.state.projects.map((project) => project.projectId));
      if (result.rows.some((row) => !projectIds.has(row.project_id))) {
        throw new Error("The refreshed portfolio does not contain every imported project.");
      }
    },
    onViewProjects: () => this.navigateToProjects(),
  }));
  const actions = document.createElement("div");
  actions.className = "sf-project-management-actions";
  actions.append(button, importButton);
  header.append(actions);
},

openNewProjectForm() {
  let createdProject = null;

  openProjectForm({
    mode: "create",
    onSubmit: async (projectData) => {
      if (!createdProject) {
        createdProject =
          await createProject(projectData);
      }

      try {
        await this.loadDashboard({
          allowCsvFallback: false,
        });
      } catch {
        throw new Error(
          "Project was created, but the latest data could not be refreshed.",
        );
      }

      this.openProject(
        createdProject.projectId,
      );
    },
  });
},

openEditProjectForm(project) {
  let hasUpdatedProject = false;

  openProjectForm({
    mode: "edit",
    project,
    onSubmit: async (projectData) => {
      if (!hasUpdatedProject) {
        await updateProject(
          project.projectId,
          projectData,
        );

        hasUpdatedProject = true;
      }

      try {
        await this.loadDashboard({
          allowCsvFallback: false,
        });
      } catch {
        throw new Error(
          "Project was updated, but the latest data could not be refreshed.",
        );
      }
    },
  });
},

openDeleteProjectConfirmation(project) {
  let hasDeletedProject = false;

  openConfirmDialog({
    title: "Delete Project",
    message: `Delete "${project.projectName}"?`,
    confirmText: "Delete Project",
    cancelText: "Cancel",
    danger: true,
    onConfirm: async () => {
      if (!hasDeletedProject) {
        await deleteProject(project.projectId);
        hasDeletedProject = true;
      }

      pushProjectsRoute();

      try {
        await this.loadDashboard({
          allowCsvFallback: false,
        });
      } catch {
        throw new Error(
          "Project was deleted, but the latest data could not be refreshed.",
        );
      }
    },
  });
},

renderPortfolioIntelligence(projects) {
  renderPortfolioIntelligence(this.portfolioIntelligenceContent, projects, {
    onOpenProject: (projectId) => this.openProject(projectId),
  });
},

  renderProjects(projects) {
    this.tableBody.replaceChildren();

    if (projects.length === 0) {
      this.renderTableMessage(
        "No projects match the current filters.",
      );
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "sf-explorer-clear";
      clear.textContent = "Clear Filters";
      clear.addEventListener("click", () => this.clearProjectFilters());
      this.tableBody.querySelector("td").append(document.createElement("br"), clear);

      return;
    }

    projects.forEach((project) => {
      const row =
        document.createElement("tr");

      this.appendProjectLinkCell(
        row,
        project,
      );

      this.appendCell(
        row,
        project.projectManager,
      );

      this.appendCell(
        row,
        project.strategicPriority,
      );

      this.appendCell(
        row,
        formatPercent(
          project.percentComplete,
        ),
      );

      this.appendCell(
        row,
        formatDisplayCurrency(
          project.budgetBAC,
        ),
      );

      this.appendCell(
        row,
        this.createRiskScoreElement(project.riskScore),
      );

      this.appendCell(
        row,
        project.resourceDemand,
      );

      this.appendStatusCell(
        row,
        project.projectStatus,
      );

      this.tableBody.append(row);
    });
  },

  appendProjectLinkCell(row, project) {
    const cell =
      document.createElement("td");

    const link =
      document.createElement("a");

    link.classList.add(
      "sf-project-link",
    );

    link.href =
      `?project=${encodeURIComponent(
        project.projectId,
      )}`;

    link.textContent =
      project.projectName;

    link.addEventListener(
      "click",
      (event) => {
        if (!isPlainLeftClick(event)) {
          return;
        }

        event.preventDefault();

        this.openProject(
          project.projectId,
        );
      },
    );

    cell.classList.add(
      "sf-project-name",
    );

    cell.append(link);
    row.append(cell);
  },

  appendCell(
    row,
    value,
    className = "",
  ) {
    const cell =
      document.createElement("td");

    if (value instanceof Node) {
      cell.append(value);
    } else {
      cell.textContent = value;
    }

    if (className) {
      cell.classList.add(className);
    }

    row.append(cell);
  },

  createRiskScoreElement(riskScore) {
    const value =
      document.createElement("span");
    const numericRiskScore =
      Number(riskScore);

    value.classList.add(
      "sf-risk-score",
      this.getRiskScoreClass(numericRiskScore),
    );

    value.textContent = String(riskScore);

    return value;
  },

  getRiskScoreClass(riskScore) {
    const { lowMax, mediumMax } =
      APP_CONFIG.portfolio.riskScoreBands;

    if (riskScore <= lowMax) {
      return "sf-risk-score--low";
    }

    if (riskScore <= mediumMax) {
      return "sf-risk-score--medium";
    }

    return "sf-risk-score--high";
  },

  appendStatusCell(row, status) {
    const cell =
      document.createElement("td");

    cell.append(
      createStatusBadge(status),
    );

    row.append(cell);
  },

renderProjectDetail(project) {
  renderProjectPerformance(
    this.projectDetail,
    project,
    {
      onBackToProjects: () => {
        this.navigateToProjects();
      },
      onEditProject: isAuthenticated()
        ? () => {
            this.openEditProjectForm(project);
          }
        : undefined,
      onDeleteProject: isAuthenticated()
        ? () => {
            this.openDeleteProjectConfirmation(project);
          }
        : undefined,
    },
  );
},


  handleNavigationClick(
    event,
    link,
  ) {
    const target =
      link.dataset.navTarget;

    if (!isPlainLeftClick(event)) {
      return;
    }

    if (target === "portfolio") {
      event.preventDefault();
      this.navigateToPortfolio();
    } else if (
      target === "projects"
    ) {
      event.preventDefault();
      this.navigateToProjects();
    } else if (
      target === "future"
    ) {
      event.preventDefault();

      const label = link.textContent.trim();

      if (label === "Budget & EVM") {
        pushBudgetRoute();
        this.renderRouteFromUrl();
      } else if (label === "Forecasting") {
        pushForecastingRoute();
        this.renderRouteFromUrl();
      } else if (label === "Decision Support") {
        pushDecisionSupportRoute();
        this.renderRouteFromUrl();
      } else if (label === "Stakeholder View") {
        pushStakeholderViewRoute();
        this.renderRouteFromUrl();
      }
    } else if (target === "stakeholder") {
      event.preventDefault();
      pushStakeholderViewRoute();
      this.renderRouteFromUrl();
    } else if (target === "governance") {
      event.preventDefault();
      pushGovernanceRoute();
      this.renderRouteFromUrl();
    } else if (target === "settings") {
      event.preventDefault();
      pushSettingsRoute();
      this.renderRouteFromUrl();
    }

    if (this.isSmallScreen()) {
      this.closeSidebar();
    }
  },

  focusProjectsSection() {
    requestAnimationFrame(() => {
      this.projectsSection?.scrollIntoView({
        block: "start",
      });

      this.projectsSection?.focus({
        preventScroll: true,
      });
    });
  },

  setupCalculatorControl() {
    if (!this.accountArea || this.calculatorButton) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sf-calculator-button";
    button.title = "Open calculator";
    button.setAttribute("aria-label", "Open calculator");
    button.innerHTML = '<svg class="sf-button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h2m4 0h2m-8 4h2m4 0h2m-8 3h2m4 0h2"/></svg><span>Calculator</span>';
    button.addEventListener("click", () => {
      const project = this.activeHeaderView === "project"
        ? this.getProjectById(this.state.currentProjectId)
        : null;
      openCalculator(project);
    });
    this.accountArea.insertBefore(button, this.helpButton ?? null);
    this.calculatorButton = button;
  },

  updateHeaderActionsForView(view) {
    this.activeHeaderView = view;
    const sharedViews = ["portfolio", "budget", "forecasting", "decision-support", "governance", "stakeholder-view"];
    if (this.exportControl) this.exportControl.hidden = !sharedViews.includes(view) && view !== "project";
    if (this.helpButton) this.helpButton.hidden = false;
    if (this.calculatorButton) this.calculatorButton.hidden = !["budget", "forecasting", "decision-support", "project"].includes(view);
  },

  setNavigationArea(areaName) {
    const views = {
      Portfolio: "portfolio",
      Projects: "projects",
      "Budget & EVM": "budget",
      Forecasting: "forecasting",
      "Decision Support": "decision-support",
      Governance: "governance",
      "Stakeholder View": "stakeholder-view",
      Settings: "settings",
    };
    this.updateHeaderActionsForView(this.state.currentProjectId ? "project" : views[areaName]);
    if (this.settingsView) this.settingsView.hidden = areaName !== "Settings";
    this.navLinks.forEach((link) => {
      const isActive =
        link.textContent.trim() ===
        areaName;

      link.classList.toggle(
        "sf-nav-link--active",
        isActive,
      );

      if (isActive) {
        link.setAttribute(
          "aria-current",
          "page",
        );
      } else {
        link.removeAttribute(
          "aria-current",
        );
      }
    });
  },

  renderTableMessage(
    message,
    type = "",
  ) {
    this.tableBody.replaceChildren();

    const row =
      document.createElement("tr");

    const cell =
      document.createElement("td");

    row.classList.add(
      "sf-table-message-row",
    );

    if (type === "error") {
      row.classList.add(
        "sf-table-message-row--error",
      );
    }

    cell.colSpan = 8;
    cell.textContent = message;

    row.append(cell);
    this.tableBody.append(row);
  },

  openSidebar() {
    document.body.classList.add(
      "sf-sidebar-open",
    );

    this.sidebarOverlay.hidden =
      false;

    this.mobileMenuButton?.setAttribute(
      "aria-expanded",
      "true",
    );
  },

  closeSidebar() {
    document.body.classList.remove(
      "sf-sidebar-open",
    );

    this.sidebarOverlay.hidden =
      true;

    this.mobileMenuButton?.setAttribute(
      "aria-expanded",
      "false",
    );
  },

  toggleSidebar() {
    const isCollapsed =
      this.appShell.classList.toggle(
        "sf-sidebar-collapsed",
      );

    const isExpanded =
      String(!isCollapsed);

    this.sidebarToggle.setAttribute(
      "aria-expanded",
      isExpanded,
    );

    this.sidebarToggle.setAttribute(
      "aria-label",
      isCollapsed
        ? "Expand sidebar"
        : "Collapse sidebar",
    );

    this.sidebarToggle.title =
      isCollapsed
        ? "Expand sidebar"
        : "Collapse sidebar";
  },

  isSmallScreen() {
    return window.matchMedia(
      "(max-width: 820px)",
    ).matches;
  },
};

document.addEventListener(
  "DOMContentLoaded",
  () => {
    SteerfoldApp.init();
  },
);
