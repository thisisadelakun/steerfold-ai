import {
  renderProjectPerformance,
  renderProjectNotFound,
} from "./project-view.js";

import {
  formatCurrency,
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
  getPortfolioRiskProfile,
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

import { renderStakeholderView } from "./stakeholder-view.js";

import { openProjectForm } from "./project-form.js";

import { openConfirmDialog } from "./confirm-dialog.js";

import { printCurrentView } from "./export-service.js";

import { isAuthenticated } from "./auth-service.js";

import { APP_CONFIG } from "./app-config.js";

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
  },

  portfolioChartSelection: "risk-completion",

  portfolioRadarProjectId: null,

    init() {
    document.documentElement.dataset.sfReady = "true";

    this.cacheElements();
    this.applyAppConfig();
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
    initOnboardingTour();
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
    this.currencyIndicator = document.querySelector(
      "[data-currency-indicator]",
    );
    this.accountArea = document.querySelector(
      ".sf-page-header .sf-account-area",
    );
    this.mainArea = document.querySelector(".sf-main-area");

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

    this.decisionSupportView = document.querySelector(
      "[data-decision-support-view]",
    );

    this.stakeholderView = document.querySelector(
      "[data-stakeholder-view]",
    );

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

    this.portfolioInsightsContent = document.querySelector(
    "[data-portfolio-insights-content]",
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

    const currencyCode =
      APP_CONFIG.portfolio.currencyCode;
    const label =
      document.createElement("span");

    label.className = "sf-currency-label";
    label.textContent =
      `Currency ${String.fromCharCode(183)}`;

    this.currencyIndicator.setAttribute(
      "aria-label",
      `Display currency: ${currencyCode}`,
    );

    this.currencyIndicator.replaceChildren(
      label,
      document.createTextNode(` ${currencyCode}`),
    );
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
    if (!this.filterForm) {
      return;
    }

    const priorityFilter =
      this.createProjectFilter({
        id: "project-priority-filter",
        label: "Strategic Priority",
        className: "sf-project-priority-filter",
        allLabel: "All Priorities",
        options: [
          "High",
          "Medium",
          "Low",
        ],
        onChange: (value) => {
          this.projectFilters.priority = value;
        },
      });

    const resourceFilter =
      this.createProjectFilter({
        id: "project-resource-filter",
        label: "Resource Demand",
        className: "sf-project-resource-filter",
        allLabel: "All Resource Demand",
        options: [
          "High",
          "Medium",
          "Low",
        ],
        onChange: (value) => {
          this.projectFilters.resourceDemand = value;
        },
      });

    this.filterForm.append(
      priorityFilter,
      resourceFilter,
    );
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

    labelText.className = "sf-visually-hidden";
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

      option.value = optionValue;
      option.textContent = optionValue;

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

    header.insertBefore(
      resultCount,
      this.filterForm,
    );

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

      this.setDataSourceNoticeVisibility(
        dataSource === "csv-fallback",
      );

      this.renderKpis(projects);
      this.renderFinancialPerformance(projects);
      this.renderPortfolioAnalysis(projects);
      this.renderPortfolioInsights(projects);
      this.renderBudgetKpis(projects);
      this.renderEvmPerformance(projects);
      this.renderProjectVariance(projects);
      this.renderForecastingKpis(projects);
      this.renderPortfolioForecast(projects);
      this.renderProjectForecastAnalysis(projects);
      this.renderDecisionSupportKpis(projects);
      this.renderPriorityRecommendations(projects);
      this.renderDecisionFactors(projects);
      this.applyFilters();
      this.renderRouteFromUrl();
    } catch (error) {
      console.error("Portfolio data load failed:", error);

      this.renderKpis([]);

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
    const searchTerm = (
      this.searchInput?.value ?? ""
    )
      .trim()
      .toLowerCase();

    const selectedStatus =
      this.statusFilter?.value ?? "";

    const selectedPriority =
      this.projectFilters.priority;

    const selectedResourceDemand =
      this.projectFilters.resourceDemand;

    this.state.filteredProjects =
      this.state.projects.filter((project) => {
        const searchableFields = [
          project.projectName,
          project.projectManager,
          project.projectType,
          project.projectId,
        ];

        const matchesSearch =
          !searchTerm ||
          searchableFields.some((field) => {
            return String(field)
              .toLowerCase()
              .includes(searchTerm);
          });

        const matchesStatus =
          !selectedStatus ||
          project.projectStatus === selectedStatus;

        const matchesPriority =
          selectedPriority === "all" ||
          project.strategicPriority === selectedPriority;

        const matchesResourceDemand =
          selectedResourceDemand === "all" ||
          project.resourceDemand ===
            selectedResourceDemand;

        return (
          matchesSearch &&
          matchesStatus &&
          matchesPriority &&
          matchesResourceDemand
        );
      });

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
      `${count} ${count === 1 ? "project" : "projects"}`;
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

  if (route.view === "stakeholder-view") {
    this.showStakeholderView();

    return;
  }

  this.showPortfolioView({
    activeArea: "Portfolio",
  });
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

showStakeholderView() {
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
    renderStakeholderView(this.stakeholderView);
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

  const cvText = formatCurrency(summary.cv);
  const svText = formatCurrency(summary.sv);

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

  const eacText = forecast.eac === null ? "—" : formatCurrency(forecast.eac);
  const etcText = forecast.etc === null ? "—" : formatCurrency(forecast.etc);
  const vacText = forecast.vac === null ? "—" : formatCurrency(forecast.vac);
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
  setCard(exposureCard, "Forecast Budget Exposure", formatCurrency(summary.forecastBudgetExposure));
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
      ".sf-project-create-button",
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

  header.append(button);
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

  renderPortfolioInsights(projects) {
  const riskProfile =
    getPortfolioRiskProfile(projects);

  const statusSummary =
    getPortfolioStatusSummary(projects);

  const attentionCount =
    statusSummary.atRisk + statusSummary.critical;

  const highDemandPercent =
    projects.length > 0
      ? Math.round(
          (riskProfile.resourceDemand.high /
            projects.length) *
            100,
        )
      : 0;

  const highestRisk =
    riskProfile.highestRiskProject;

const insights = [
  {
    title: "Portfolio Exposure",
    value: `${attentionCount} projects need attention`,
    text:
      `${statusSummary.atRisk} are currently At Risk and ` +
      `${statusSummary.critical} is Critical. ` +
      `These projects should be prioritized for management review.`,
  },
  {
    title: "Priority Risk",
    value: highestRisk
      ? highestRisk.projectName
      : "No elevated risk",
    text: highestRisk
      ? `This project has the portfolio's highest risk score at ` +
        `${highestRisk.riskScore}/25 and is currently ` +
        `${formatPercent(highestRisk.percentComplete)} complete.`
      : "No project risk information is currently available.",
  },
  {
    title: "Resource Capacity",
    value:
      `${riskProfile.resourceDemand.high} projects under high demand`,
    text:
      `${highDemandPercent}% of the portfolio currently requires high ` +
      `resource capacity, while ${riskProfile.resourceDemand.medium} ` +
      `projects have medium demand.`,
  },
];

  const grid =
    document.createElement("div");

  grid.classList.add("sf-insights-grid");

  insights.forEach((insight) => {
    const card =
      document.createElement("article");

    const title =
      document.createElement("span");

    const value =
      document.createElement("strong");

    const text =
      document.createElement("p");

    card.classList.add("sf-insight-card");
    title.classList.add("sf-insight-label");
    value.classList.add("sf-insight-value");
    text.classList.add("sf-insight-text");

    title.textContent = insight.title;
    value.textContent = insight.value;
    text.textContent = insight.text;

    card.append(
      title,
      value,
      text,
    );

    grid.append(card);
  });

  this.portfolioInsightsContent.replaceChildren(
    grid,
  );
},

  renderProjects(projects) {
    this.tableBody.replaceChildren();

    if (projects.length === 0) {
      this.renderTableMessage(
        "No projects match the current filters.",
      );

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
        formatCurrency(
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

  setNavigationArea(areaName) {
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
