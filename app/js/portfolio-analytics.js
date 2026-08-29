import { APP_CONFIG } from "./app-config.js";

export function getPortfolioStatusSummary(projects) {
  const summary = {
    totalProjects: projects.length,
    onTrack: 0,
    atRisk: 0,
    critical: 0,
  };

  projects.forEach((project) => {
    if (project.projectStatus === "On Track") {
      summary.onTrack += 1;
    } else if (project.projectStatus === "At Risk") {
      summary.atRisk += 1;
    } else if (project.projectStatus === "Critical") {
      summary.critical += 1;
    }
  });

  return summary;
}

export function getPortfolioFinancialSummary(projects) {
  return projects.reduce(
    (summary, project) => {
      summary.totalBAC += project.budgetBAC;
      summary.totalPV += project.plannedValuePV;
      summary.totalEV += project.earnedValueEV;
      summary.totalAC += project.actualCostAC;

      return summary;
    },
    {
      totalBAC: 0,
      totalPV: 0,
      totalEV: 0,
      totalAC: 0,
    }
  );
}

export function getPortfolioRiskProfile(projects) {
  if (!projects.length) {
    return {
      averageRiskScore: 0,
      highestRiskProject: null,
      resourceDemand: {
        high: 0,
        medium: 0,
        low: 0,
      },
    };
  }

  let totalRiskScore = 0;
  let highestRiskProject = projects[0];

  const resourceDemand = {
    high: 0,
    medium: 0,
    low: 0,
  };

  projects.forEach((project) => {
    totalRiskScore += project.riskScore;

    if (project.riskScore > highestRiskProject.riskScore) {
      highestRiskProject = project;
    }

    const demand =
      project.resourceDemand?.toLowerCase();

    if (demand === "high") {
      resourceDemand.high += 1;
    } else if (demand === "medium") {
      resourceDemand.medium += 1;
    } else if (demand === "low") {
      resourceDemand.low += 1;
    }
  });

  return {
    averageRiskScore:
      totalRiskScore / projects.length,

    highestRiskProject,

    resourceDemand,
  };
}

export function getRiskCompletionData(projects) {
  return projects.map((project) => ({
    projectId: project.projectId,
    projectName: project.projectName,
    riskScore: project.riskScore,
    percentComplete: project.percentComplete,
    projectStatus: project.projectStatus,
  }));
}

export function getResourceDemandByStatus(projects) {
  const statuses = ["On Track", "At Risk", "Critical"];

  const result = statuses.map((s) => ({
    status: s,
    high: 0,
    medium: 0,
    low: 0,
  }));

  projects.forEach((project) => {
    const status = project.projectStatus;
    if (!status) return;

    const idx = statuses.indexOf(status);
    if (idx === -1) return;

    const demand = project.resourceDemand?.toLowerCase();

    if (demand === "high") {
      result[idx].high += 1;
    } else if (demand === "medium") {
      result[idx].medium += 1;
    } else if (demand === "low") {
      result[idx].low += 1;
    }
  });

  return result;
}

export function calculateProjectEvm(project) {
  const projectId = project.projectId;
  const projectName = project.projectName;

  const bac = project.budgetBAC;
  const pv = project.plannedValuePV;
  const ev = project.earnedValueEV;
  const ac = project.actualCostAC;

  const cv = ev - ac;
  const sv = ev - pv;

  const cpi = ac === 0 ? null : ev / ac;
  const spi = pv === 0 ? null : ev / pv;

  return {
    projectId,
    projectName,
    bac,
    pv,
    ev,
    ac,
    cv,
    sv,
    cpi,
    spi,
  };
}

export function calculateProjectForecast(project) {
  // Reuse EVM calculations to avoid duplicating BAC, EV, AC, and CPI logic
  const evm = calculateProjectEvm(project);

  const projectId = evm.projectId;
  const projectName = evm.projectName;
  const bac = evm.bac;
  const ev = evm.ev;
  const ac = evm.ac;
  const cpi = evm.cpi;

  // EAC assumes current cost efficiency continues
  let eac = null;

  if (Number.isFinite(cpi) && cpi > 0) {
    const calculatedEac = bac / cpi;

    if (Number.isFinite(calculatedEac)) {
      eac = calculatedEac;
    }
  }

  // ETC and VAC depend on a valid EAC
  let etc = null;
  let vac = null;

  if (eac !== null) {
    const calculatedEtc = eac - ac;
    const calculatedVac = bac - eac;

    if (Number.isFinite(calculatedEtc)) {
      etc = calculatedEtc;
    }

    if (Number.isFinite(calculatedVac)) {
      vac = calculatedVac;
    }
  }

  // TCPI = (BAC - EV) / (BAC - AC)
  let tcpi = null;

  const denominator = bac - ac;

  if (Number.isFinite(denominator) && denominator !== 0) {
    const calculatedTcpi = (bac - ev) / denominator;

    if (Number.isFinite(calculatedTcpi)) {
      tcpi = calculatedTcpi;
    }
  }

  return {
    projectId,
    projectName,
    bac,
    ev,
    ac,
    cpi,
    eac,
    etc,
    vac,
    tcpi,
  };
}

export function calculatePortfolioEvmSummary(projects) {
  const totals = projects.reduce(
    (acc, project) => {
      acc.totalBAC += Number(project.budgetBAC) || 0;
      acc.totalPV += Number(project.plannedValuePV) || 0;
      acc.totalEV += Number(project.earnedValueEV) || 0;
      acc.totalAC += Number(project.actualCostAC) || 0;

      return acc;
    },
    {
      totalBAC: 0,
      totalPV: 0,
      totalEV: 0,
      totalAC: 0,
    },
  );

  const cv = totals.totalEV - totals.totalAC;
  const sv = totals.totalEV - totals.totalPV;

  const cpi = totals.totalAC === 0 ? null : totals.totalEV / totals.totalAC;
  const spi = totals.totalPV === 0 ? null : totals.totalEV / totals.totalPV;

  return {
    totalBAC: totals.totalBAC,
    totalPV: totals.totalPV,
    totalEV: totals.totalEV,
    totalAC: totals.totalAC,
    cv,
    sv,
    cpi,
    spi,
  };
}

export function calculatePortfolioForecast(projects) {
  // Reuse portfolio EVM to avoid duplicating BAC, EV, AC, and CPI aggregation logic
  const summary = calculatePortfolioEvmSummary(projects);

  const bac = summary.totalBAC;
  const ev = summary.totalEV;
  const ac = summary.totalAC;
  const cpi = summary.cpi;

  // EAC assumes current portfolio cost efficiency continues
  let eac = null;

  if (Number.isFinite(cpi) && cpi > 0) {
    const calculatedEac = bac / cpi;

    if (Number.isFinite(calculatedEac)) {
      eac = calculatedEac;
    }
  }

  // ETC and VAC depend on a valid EAC
  let etc = null;
  let vac = null;

  if (eac !== null) {
    const calculatedEtc = eac - ac;
    const calculatedVac = bac - eac;

    if (Number.isFinite(calculatedEtc)) {
      etc = calculatedEtc;
    }

    if (Number.isFinite(calculatedVac)) {
      vac = calculatedVac;
    }
  }

  // TCPI = (BAC - EV) / (BAC - AC)
  let tcpi = null;

  const denominator = bac - ac;

  if (Number.isFinite(denominator) && denominator !== 0) {
    const calculatedTcpi = (bac - ev) / denominator;

    if (Number.isFinite(calculatedTcpi)) {
      tcpi = calculatedTcpi;
    }
  }

  return {
    bac,
    ev,
    ac,
    cpi,
    eac,
    etc,
    vac,
    tcpi,
  };
}

export function getProjectVarianceData(projects) {
  if (!Array.isArray(projects)) return [];

  return projects.map((project) =>
    calculateProjectEvm(project),
  );
}

export function getProjectForecastData(projects) {
  if (!Array.isArray(projects)) return [];

  return projects.map((project) =>
    calculateProjectForecast(project),
  );
}

export function calculateProjectDecisionSignals(project) {
  // Reuse existing EVM and forecasting calculations
  const evm = calculateProjectEvm(project);
  const forecast = calculateProjectForecast(project);

  const cpi = evm.cpi;
  const spi = evm.spi;
  const vac = forecast.vac;
  const tcpi = forecast.tcpi;
  const {
    highRiskScore,
    criticalRiskScore,
    inefficientIndex,
    highCompletionPressureTcpi,
  } = APP_CONFIG.portfolio.decisionThresholds;

  return {
    projectId: project.projectId,
    projectName: project.projectName,
    projectStatus: project.projectStatus,
    riskScore: project.riskScore,
    cpi,
    spi,
    vac,
    tcpi,
    statusNeedsAttention:
      project.projectStatus === "At Risk" ||
      project.projectStatus === "Critical",
    highRisk:
      Number.isFinite(project.riskScore) &&
      project.riskScore >= highRiskScore,
    criticalRisk:
      Number.isFinite(project.riskScore) &&
      project.riskScore >= criticalRiskScore,
    costInefficient:
      Number.isFinite(cpi) && cpi < inefficientIndex,
    scheduleInefficient:
      Number.isFinite(spi) && spi < inefficientIndex,
    forecastOverBudget:
      Number.isFinite(vac) && vac < 0,
    highCompletionPressure:
      Number.isFinite(tcpi) && tcpi > highCompletionPressureTcpi,
  };
}

export function calculateDecisionSupportSummary(projects) {
  const projectList = Array.isArray(projects) ? projects : [];

  let projectsRequiringAttention = 0;
  let criticalPriority = 0;
  let forecastBudgetExposure = 0;

  projectList.forEach((project) => {
  const signals = calculateProjectDecisionSignals(project);

  const requiresAttention =
    signals.statusNeedsAttention ||
    signals.highRisk ||
    signals.costInefficient ||
    signals.scheduleInefficient ||
    signals.forecastOverBudget ||
    signals.highCompletionPressure;

  if (requiresAttention) {
    projectsRequiringAttention += 1;
  }

  const isCriticalPriority =
    project.projectStatus === "Critical" ||
    signals.criticalRisk === true ||
    signals.highCompletionPressure === true;

  if (isCriticalPriority) {
    criticalPriority += 1;
  }

  const vac = signals.vac;

  if (Number.isFinite(vac) && vac < 0) {
    forecastBudgetExposure += Math.abs(vac);
  }
});

return {
  projectsRequiringAttention,
  criticalPriority,
  forecastBudgetExposure,
  recommendedActions: projectsRequiringAttention,
};
}

export function getPriorityRecommendations(projects) {
  const projectList = Array.isArray(projects) ? projects : [];

  const priorityOrder = {
    Critical: 0,
    High: 1,
    Moderate: 2,
  };

  const recommendations = [];

  projectList.forEach((project) => {
    const signals = calculateProjectDecisionSignals(project);

    const requiresAttention =
      signals.statusNeedsAttention ||
      signals.highRisk ||
      signals.costInefficient ||
      signals.scheduleInefficient ||
      signals.forecastOverBudget ||
      signals.highCompletionPressure;

    if (!requiresAttention) {
      return;
    }

    let priorityLevel;

    if (
      project.projectStatus === "Critical" ||
      signals.criticalRisk === true ||
      signals.highCompletionPressure === true
    ) {
      priorityLevel = "Critical";
    } else if (
      signals.statusNeedsAttention === true ||
      signals.highRisk === true ||
      signals.forecastOverBudget === true
    ) {
      priorityLevel = "High";
    } else {
      priorityLevel = "Moderate";
    }

    const factors = [];

    if (signals.statusNeedsAttention) {
      factors.push("Project status requires attention");
    }

    if (signals.highRisk) {
      factors.push("High risk exposure");
    }

    if (signals.criticalRisk) {
      factors.push("Critical risk exposure");
    }

    if (signals.costInefficient) {
      factors.push("Cost efficiency below target");
    }

    if (signals.scheduleInefficient) {
      factors.push("Schedule efficiency below target");
    }

    if (signals.forecastOverBudget) {
      factors.push("Forecast final cost exceeds budget");
    }

    if (signals.highCompletionPressure) {
      factors.push("Remaining work requires high cost efficiency");
    }

    let primaryAction;

    if (signals.highCompletionPressure) {
      primaryAction = "Reassess remaining cost plan and recovery options.";
    } else if (signals.criticalRisk) {
      primaryAction = "Escalate risk response and mitigation review.";
    } else if (signals.forecastOverBudget) {
      primaryAction = "Review cost drivers and update the cost recovery plan.";
    } else if (signals.costInefficient && signals.scheduleInefficient) {
      primaryAction = "Initiate cost and schedule recovery review.";
    } else if (signals.costInefficient) {
      primaryAction = "Review cost efficiency and corrective actions.";
    } else if (signals.scheduleInefficient) {
      primaryAction = "Review schedule recovery options.";
    } else if (signals.highRisk) {
      primaryAction = "Review risk mitigation and ownership.";
    } else {
      primaryAction = "Review project health and recovery plan.";
    }

    recommendations.push({
      projectId: project.projectId,
      projectName: project.projectName,
      priorityLevel,
      factors,
      primaryAction,
      riskScore: project.riskScore,
      cpi: signals.cpi,
      spi: signals.spi,
      vac: signals.vac,
      tcpi: signals.tcpi,
    });
  });

  recommendations.sort((a, b) => {
  const levelDiff =
    priorityOrder[a.priorityLevel] -
    priorityOrder[b.priorityLevel];

  if (levelDiff !== 0) {
    return levelDiff;
  }

  const aRisk = Number.isFinite(a.riskScore) ? a.riskScore : 0;
  const bRisk = Number.isFinite(b.riskScore) ? b.riskScore : 0;

  return bRisk - aRisk;
});

return recommendations;
}
