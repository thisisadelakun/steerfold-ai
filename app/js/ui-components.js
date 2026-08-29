function getStatusBadgeClass(status) {
  const statusClassMap = {
    "On Track": "sf-status-badge--on-track",
    "At Risk": "sf-status-badge--at-risk",
    Critical: "sf-status-badge--critical",
  };

  return statusClassMap[status] ?? "";
}

export function createStatusBadge(status) {
  const badge = document.createElement("span");
  const statusClass = getStatusBadgeClass(status);

  badge.classList.add("sf-status-badge");

  if (statusClass) {
    badge.classList.add(statusClass);
  }

  badge.textContent = status;

  return badge;
}

function createDetailRow(label, value) {
  const row = document.createElement("div");
  const labelElement = document.createElement("span");
  const valueElement = document.createElement("span");

  row.classList.add("sf-detail-row");
  labelElement.classList.add("sf-detail-label");
  valueElement.classList.add("sf-detail-value");

  labelElement.textContent = label;

  if (value instanceof Node) {
    valueElement.append(value);
  } else {
    valueElement.textContent = value;
  }

  row.append(labelElement, valueElement);

  return row;
}

export function createDetailCard(title, rows) {
  const card = document.createElement("section");
  const heading = document.createElement("h2");
  const list = document.createElement("div");

  card.classList.add(
    "sf-panel",
    "sf-detail-card",
  );

  list.classList.add(
    "sf-detail-list",
  );

  heading.textContent = title;

  rows.forEach(([label, value]) => {
    list.append(
      createDetailRow(label, value),
    );
  });

  card.append(
    heading,
    list,
  );

  return card;
}

export function createKpiGrid(
  kpis,
  ariaLabel = "Key performance indicators",
) {
  const grid = document.createElement("section");

  grid.classList.add("sf-kpi-grid");
  grid.setAttribute("aria-label", ariaLabel);

  kpis.forEach(({ label, value, valueClass = "" }) => {
    const card = document.createElement("article");
    const labelElement = document.createElement("span");
    const valueElement = document.createElement("strong");

    card.classList.add("sf-kpi-card");
    labelElement.classList.add("sf-kpi-label");
    valueElement.classList.add("sf-kpi-value");

    if (valueClass) {
      valueElement.classList.add(valueClass);
    }

    labelElement.textContent = label;
    valueElement.textContent = value;

    card.append(
      labelElement,
      valueElement,
    );

    grid.append(card);
  });

  return grid;
}

export function createPriorityRecommendationsList(recommendations) {
  const list = document.createElement("div");
  const recommendationList = Array.isArray(recommendations) ? recommendations : [];

  list.classList.add("sf-recommendation-list");

  if (recommendationList.length === 0) {
    const emptyMessage = document.createElement("p");

    emptyMessage.classList.add("sf-recommendation-empty");
    emptyMessage.textContent =
      "No projects currently require management attention.";

    list.append(emptyMessage);

    return list;
  }

  const priorityClassMap = {
    Critical: "sf-recommendation-card--critical",
    High: "sf-recommendation-card--high",
    Moderate: "sf-recommendation-card--moderate",
  };

  const priorityBadgeClassMap = {
    Critical: "sf-recommendation-priority--critical",
    High: "sf-recommendation-priority--high",
    Moderate: "sf-recommendation-priority--moderate",
  };

  recommendationList.forEach((recommendation) => {
    const card = document.createElement("article");
    const header = document.createElement("div");
    const projectName = document.createElement("span");
    const priorityBadge = document.createElement("span");
    const actionLabel = document.createElement("span");
    const action = document.createElement("p");

    card.classList.add("sf-recommendation-card");

    const cardPriorityClass =
      priorityClassMap[recommendation.priorityLevel];

    if (cardPriorityClass) {
      card.classList.add(cardPriorityClass);
    }

    header.classList.add("sf-recommendation-header");
    projectName.classList.add("sf-recommendation-project");
    priorityBadge.classList.add("sf-recommendation-priority");

    const badgePriorityClass =
      priorityBadgeClassMap[recommendation.priorityLevel];

    if (badgePriorityClass) {
      priorityBadge.classList.add(badgePriorityClass);
    }

    actionLabel.classList.add("sf-recommendation-action-label");
    action.classList.add("sf-recommendation-action");

    projectName.textContent = recommendation.projectName;
    priorityBadge.textContent = recommendation.priorityLevel;
    actionLabel.textContent = "Recommended action";
    action.textContent = recommendation.primaryAction;

    header.append(
      projectName,
      priorityBadge,
    );

    card.append(
      header,
      actionLabel,
      action,
    );

    list.append(card);
  });

  return list;
}

export function createDecisionFactorsList(recommendations) {
  const container = document.createElement("div");
  const recommendationList = Array.isArray(recommendations) ? recommendations : [];

  container.classList.add("sf-decision-factor-list");

  if (recommendationList.length === 0) {
    const emptyMessage = document.createElement("p");

    emptyMessage.classList.add("sf-decision-factor-empty");
    emptyMessage.textContent =
      "No decision factors are currently active.";

    container.append(emptyMessage);

    return container;
  }

  const priorityClassMap = {
    Critical: "sf-decision-factor-priority--critical",
    High: "sf-decision-factor-priority--high",
    Moderate: "sf-decision-factor-priority--moderate",
  };

  recommendationList.forEach((recommendation) => {
    const card = document.createElement("article");
    const header = document.createElement("div");
    const projectName = document.createElement("span");
    const priorityBadge = document.createElement("span");
    const factorsContainer = document.createElement("div");

    card.classList.add("sf-decision-factor-card");

    header.classList.add("sf-decision-factor-header");
    projectName.classList.add("sf-decision-factor-project");
    priorityBadge.classList.add("sf-decision-factor-priority");

    const priorityClass =
      priorityClassMap[recommendation.priorityLevel];

    if (priorityClass) {
      priorityBadge.classList.add(priorityClass);
    }

    factorsContainer.classList.add("sf-decision-factor-items");

    projectName.textContent = recommendation.projectName;
    priorityBadge.textContent = recommendation.priorityLevel;

    header.append(
      projectName,
      priorityBadge,
    );

    const factors = Array.isArray(recommendation.factors)
      ? recommendation.factors
      : [];

    if (factors.length === 0) {
      const noneMessage = document.createElement("span");

      noneMessage.classList.add("sf-decision-factor-none");
      noneMessage.textContent = "No active decision signals.";

      factorsContainer.append(noneMessage);
    } else {
      factors.forEach((factor) => {
        const factorItem = document.createElement("span");

        factorItem.classList.add("sf-decision-factor-item");
        factorItem.textContent = factor;

        factorsContainer.append(factorItem);
      });
    }

    card.append(
      header,
      factorsContainer,
    );

    container.append(card);
  });

  return container;
}
