import {
  formatCurrency,
  formatPercent,
  formatDate,
} from "./formatters.js";

import {
  createStatusBadge,
  createDetailCard,
  createKpiGrid,
} from "./ui-components.js";

function createBackButton(onBackToProjects) {
  const button = document.createElement("button");

  button.classList.add("sf-back-link");
  button.type = "button";
  button.textContent = "← Back to Projects";

  button.addEventListener("click", () => {
    onBackToProjects?.();
  });

  return button;
}

function createEditButton(onEditProject) {
  const button = document.createElement("button");

  button.classList.add("sf-project-edit-button");
  button.type = "button";
  button.textContent = "Edit Project";

  button.addEventListener("click", () => {
    onEditProject?.();
  });

  return button;
}

function createDeleteButton(onDeleteProject) {
  const button = document.createElement("button");

  button.classList.add("sf-project-delete-button");
  button.type = "button";
  button.textContent = "Delete Project";

  button.addEventListener("click", () => {
    onDeleteProject?.();
  });

  return button;
}

function createProjectHeader(
  project,
  {
    onBackToProjects,
    onEditProject,
    onDeleteProject,
  } = {},
) {
  const header = document.createElement("div");
  const actions = document.createElement("div");
  const titleGroup = document.createElement("div");
  const title = document.createElement("h2");
  const meta = document.createElement("div");

  header.classList.add("sf-project-detail-header");
  actions.classList.add("sf-project-detail-actions");
  titleGroup.classList.add("sf-project-title-group");
  meta.classList.add("sf-project-meta");

  title.textContent = project.projectName;

  const metaValues = [
    project.projectId,
    project.projectStatus,
    project.projectManager,
  ];

  metaValues.forEach((value, index) => {
    const item = document.createElement("span");

    item.classList.add("sf-project-meta-item");

    if (index === 1) {
      item.append(
        createStatusBadge(value),
      );
    } else {
      item.textContent = value;
    }

    meta.append(item);
  });

  titleGroup.append(
    title,
    meta,
  );

  actions.append(
    createBackButton(onBackToProjects),
  );

  if (typeof onEditProject === "function") {
    actions.append(
      createEditButton(onEditProject),
    );
  }

  if (typeof onDeleteProject === "function") {
    actions.append(
      createDeleteButton(onDeleteProject),
    );
  }

  header.append(
    actions,
    titleGroup,
  );

  return header;
}

function createProjectKpis(project) {
  return createKpiGrid(
    [
      {
        label: "Completion",
        value: formatPercent(
          project.percentComplete,
        ),
      },
      {
        label: "Approved Budget",
        value: formatCurrency(
          project.budgetBAC,
        ),
      },
      {
        label: "Risk Score",
        value: String(
          project.riskScore,
        ),
      },
      {
        label: "Resource Demand",
        value: project.resourceDemand,
      },
    ],
    "Project key performance indicators",
  );
}

function createProjectDetailGrid(project) {
  const detailGrid = document.createElement("div");

  detailGrid.classList.add("sf-detail-grid");

  detailGrid.append(
    createDetailCard(
      "General Information",
      [
        [
          "Project ID",
          project.projectId,
        ],
        [
          "Project Name",
          project.projectName,
        ],
        [
          "Project Manager",
          project.projectManager,
        ],
        [
          "Project Type",
          project.projectType,
        ],
        [
          "Strategic Priority",
          project.strategicPriority,
        ],
        [
          "Project Status",
          createStatusBadge(
            project.projectStatus,
          ),
        ],
      ],
    ),

    createDetailCard(
      "Financial Performance",
      [
        [
          "Budget at Completion (BAC)",
          formatCurrency(
            project.budgetBAC,
          ),
        ],
        [
          "Planned Value (PV)",
          formatCurrency(
            project.plannedValuePV,
          ),
        ],
        [
          "Earned Value (EV)",
          formatCurrency(
            project.earnedValueEV,
          ),
        ],
        [
          "Actual Cost (AC)",
          formatCurrency(
            project.actualCostAC,
          ),
        ],
      ],
    ),

    createDetailCard(
      "Schedule / Progress",
      [
        [
          "Percent Complete",
          formatPercent(
            project.percentComplete,
          ),
        ],
        [
          "Start Date",
          formatDate(
            project.startDate,
          ),
        ],
        [
          "End Date",
          formatDate(
            project.endDate,
          ),
        ],
      ],
    ),

    createDetailCard(
      "Risk & Resources",
      [
        [
          "Risk Score",
          String(
            project.riskScore,
          ),
        ],
        [
          "Resource Demand",
          project.resourceDemand,
        ],
        [
          "Project Status",
          createStatusBadge(
            project.projectStatus,
          ),
        ],
      ],
    ),
  );

  return detailGrid;
}

export function renderProjectPerformance(
  container,
  project,
  {
    onBackToProjects,
    onEditProject,
    onDeleteProject,
  } = {},
) {
  container.replaceChildren();

  container.append(
    createProjectHeader(
      project,
      {
        onBackToProjects,
        onEditProject,
        onDeleteProject,
      },
    ),
    createProjectKpis(project),
    createProjectDetailGrid(project),
  );
}

export function renderProjectNotFound(
  container,
  {
    onBackToProjects,
  } = {},
) {
  const panel = document.createElement("section");
  const heading = document.createElement("h2");
  const message = document.createElement("p");

  panel.classList.add(
    "sf-panel",
    "sf-project-not-found",
  );

  heading.textContent =
    "Project could not be found.";

  message.textContent =
    "The selected project ID does not match the loaded portfolio data.";

  panel.append(
    createBackButton(onBackToProjects),
    heading,
    message,
  );

  container.replaceChildren(panel);
}
