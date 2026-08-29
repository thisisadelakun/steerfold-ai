function buildRelativeUrl(url) {
  return `${url.pathname}${url.search}${url.hash}`;
}

export function getCurrentRoute() {
  const url = new URL(window.location.href);
  const projectId = url.searchParams.get("project");

  if (projectId) {
    return {
      view: "project",
      projectId,
    };
  }

  if (url.hash === "#projects") {
    return {
      view: "projects",
      projectId: null,
    };
  }

  if (url.hash === "#budget") {
    return {
      view: "budget",
      projectId: null,
    };
  }

  if (url.hash === "#forecasting") {
    return {
      view: "forecasting",
      projectId: null,
    };
  }

  if (url.hash === "#decision-support") {
    return {
      view: "decision-support",
      projectId: null,
    };
  }

  if (url.hash === "#stakeholder-view") {
    return {
      view: "stakeholder-view",
      projectId: null,
    };
  }

  return {
    view: "portfolio",
    projectId: null,
  };
}

export function pushProjectRoute(projectId) {
  const url = new URL(window.location.href);

  url.searchParams.set("project", projectId);
  url.hash = "";

  history.pushState(
    {
      view: "project",
      projectId,
    },
    "",
    buildRelativeUrl(url),
  );
}

export function pushPortfolioRoute() {
  const url = new URL(window.location.href);

  url.searchParams.delete("project");
  url.hash = "";

  history.pushState(
    {
      view: "portfolio",
    },
    "",
    buildRelativeUrl(url),
  );
}

export function pushProjectsRoute() {
  const url = new URL(window.location.href);

  url.searchParams.delete("project");
  url.hash = "projects";

  history.pushState(
    {
      view: "projects",
    },
    "",
    buildRelativeUrl(url),
  );
}

export function listenForRouteChanges(callback) {
  window.addEventListener("popstate", callback);

  return () => {
    window.removeEventListener("popstate", callback);
  };
}

export function pushBudgetRoute() {
  const url = new URL(window.location.href);

  url.searchParams.delete("project");
  url.hash = "budget";

  history.pushState(
    {
      view: "budget",
    },
    "",
    buildRelativeUrl(url),
  );
}

export function pushForecastingRoute() {
  const url = new URL(window.location.href);

  url.searchParams.delete("project");
  url.hash = "forecasting";

  history.pushState(
    {
      view: "forecasting",
    },
    "",
    buildRelativeUrl(url),
  );
}

export function pushDecisionSupportRoute() {
  const url = new URL(window.location.href);

  url.searchParams.delete("project");
  url.hash = "decision-support";

  history.pushState(
    {
      view: "decision-support",
    },
    "",
    buildRelativeUrl(url),
  );
}

export function pushStakeholderViewRoute() {
  const url = new URL(window.location.href);

  url.searchParams.delete("project");
  url.hash = "stakeholder-view";

  history.pushState(
    {
      view: "stakeholder-view",
    },
    "",
    buildRelativeUrl(url),
  );
}
