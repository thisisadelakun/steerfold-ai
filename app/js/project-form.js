const MODAL_ID = "sf-project-form-modal";

const SELECT_OPTIONS = {
  strategicPriority: [
    "High",
    "Medium",
    "Low",
  ],
  resourceDemand: [
    "High",
    "Medium",
    "Low",
  ],
  projectStatus: [
    "On Track",
    "At Risk",
    "Critical",
  ],
};

const FIELD_DEFINITIONS = [
  {
    name: "projectName",
    label: "Project Name",
    type: "text",
    required: true,
  },
  {
    name: "projectManager",
    label: "Project Manager",
    type: "text",
    required: true,
  },
  {
    name: "projectType",
    label: "Project Type",
    type: "text",
    required: true,
  },
  {
    name: "strategicPriority",
    label: "Strategic Priority",
    type: "select",
    options: SELECT_OPTIONS.strategicPriority,
    defaultValue: "Medium",
    required: true,
  },
  {
    name: "budgetBAC",
    label: "Budget at Completion (BAC)",
    type: "number",
    min: 0,
    step: 1,
    required: true,
  },
  {
    name: "plannedValuePV",
    label: "Planned Value (PV)",
    type: "number",
    min: 0,
    step: 1,
    required: true,
  },
  {
    name: "earnedValueEV",
    label: "Earned Value (EV)",
    type: "number",
    min: 0,
    step: 1,
    required: true,
  },
  {
    name: "actualCostAC",
    label: "Actual Cost (AC)",
    type: "number",
    min: 0,
    step: 1,
    required: true,
  },
  {
    name: "percentComplete",
    label: "Percent Complete",
    type: "number",
    min: 0,
    max: 100,
    step: 1,
    required: true,
  },
  {
    name: "riskScore",
    label: "Risk Score",
    type: "number",
    min: 0,
    max: 25,
    step: 1,
    required: true,
  },
  {
    name: "startDate",
    label: "Start Date",
    type: "date",
    required: true,
  },
  {
    name: "endDate",
    label: "End Date",
    type: "date",
    required: true,
  },
  {
    name: "resourceDemand",
    label: "Resource Demand",
    type: "select",
    options: SELECT_OPTIONS.resourceDemand,
    defaultValue: "Medium",
    required: true,
  },
  {
    name: "projectStatus",
    label: "Project Status",
    type: "select",
    options: SELECT_OPTIONS.projectStatus,
    defaultValue: "On Track",
    required: true,
  },
];

function isValidDateParts(year, month, day) {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1
  ) {
    return false;
  }

  const daysByMonth = [
    31,
    year % 4 === 0 &&
    (year % 100 !== 0 || year % 400 === 0)
      ? 29
      : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  return day <= daysByMonth[month - 1];
}

function formatDateInputValue(year, month, day) {
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function toDateInputValue(value) {
  if (typeof value !== "string") {
    return "";
  }

  const normalizedMatch =
    value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (normalizedMatch) {
    const [, yearText, monthText, dayText] =
      normalizedMatch;

    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);

    return isValidDateParts(year, month, day)
      ? value
      : "";
  }

  const slashDateMatch =
    value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (!slashDateMatch) {
    return "";
  }

  const [, monthText, dayText, yearText] =
    slashDateMatch;

  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (!isValidDateParts(year, month, day)) {
    return "";
  }

  return formatDateInputValue(
    year,
    month,
    day,
  );
}

function getInitialValue(definition, project) {
  if (!project) {
    return definition.defaultValue ?? "";
  }

  if (definition.name === "percentComplete") {
    const percentValue =
      Number(project.percentComplete) * 100;

    return Number.isFinite(percentValue)
      ? String(Math.round(percentValue))
      : "";
  }

  if (
    definition.name === "startDate" ||
    definition.name === "endDate"
  ) {
    return toDateInputValue(project[definition.name]);
  }

  return project[definition.name] ?? definition.defaultValue ?? "";
}

function createField(definition, project) {
  const wrapper = document.createElement("div");
  const label = document.createElement("label");
  const fieldId = `sf-project-form-${definition.name}`;
  let control;

  wrapper.className = "sf-project-form-field";

  label.htmlFor = fieldId;
  label.textContent = definition.label;

  if (definition.type === "select") {
    control = document.createElement("select");

    definition.options.forEach((optionValue) => {
      const option = document.createElement("option");

      option.value = optionValue;
      option.textContent = optionValue;

      control.append(option);
    });
  } else {
    control = document.createElement("input");
    control.type = definition.type;
  }

  control.id = fieldId;
  control.name = definition.name;
  control.required = Boolean(definition.required);
  control.value = getInitialValue(definition, project);

  if (typeof definition.min !== "undefined") {
    control.min = String(definition.min);
  }

  if (typeof definition.max !== "undefined") {
    control.max = String(definition.max);
  }

  if (typeof definition.step !== "undefined") {
    control.step = String(definition.step);
  }

  wrapper.append(
    label,
    control,
  );

  return {
    wrapper,
    control,
  };
}

function createReadonlyProjectIdField(project) {
  const wrapper = document.createElement("div");
  const label = document.createElement("label");
  const input = document.createElement("input");

  wrapper.className = "sf-project-form-field";

  label.htmlFor = "sf-project-form-projectId";
  label.textContent = "Project ID";

  input.id = "sf-project-form-projectId";
  input.name = "projectId";
  input.type = "text";
  input.readOnly = true;
  input.value = project?.projectId ?? "";

  wrapper.append(
    label,
    input,
  );

  return wrapper;
}

function getTrimmedValue(form, name) {
  return String(form.elements[name]?.value ?? "").trim();
}

function readNumber(form, name) {
  return Number(getTrimmedValue(form, name));
}

function buildProjectData(form, mode, project) {
  const projectData = {
    projectName: getTrimmedValue(form, "projectName"),
    projectManager: getTrimmedValue(form, "projectManager"),
    projectType: getTrimmedValue(form, "projectType"),
    strategicPriority: getTrimmedValue(form, "strategicPriority"),
    budgetBAC: readNumber(form, "budgetBAC"),
    plannedValuePV: readNumber(form, "plannedValuePV"),
    earnedValueEV: readNumber(form, "earnedValueEV"),
    actualCostAC: readNumber(form, "actualCostAC"),
    percentComplete:
      readNumber(form, "percentComplete") / 100,
    riskScore: readNumber(form, "riskScore"),
    startDate: getTrimmedValue(form, "startDate"),
    endDate: getTrimmedValue(form, "endDate"),
    resourceDemand: getTrimmedValue(form, "resourceDemand"),
    projectStatus: getTrimmedValue(form, "projectStatus"),
  };

  if (mode === "edit") {
    projectData.projectId = project?.projectId;
  }

  return projectData;
}

function validateForm(form) {
  const requiredFields = [
    "projectName",
    "projectManager",
    "projectType",
    "strategicPriority",
    "budgetBAC",
    "plannedValuePV",
    "earnedValueEV",
    "actualCostAC",
    "percentComplete",
    "riskScore",
    "startDate",
    "endDate",
    "resourceDemand",
    "projectStatus",
  ];

  const missingField = requiredFields.some((name) => {
    return getTrimmedValue(form, name) === "";
  });

  if (missingField) {
    return "Complete all required fields.";
  }

  const financialFields = [
    "budgetBAC",
    "plannedValuePV",
    "earnedValueEV",
    "actualCostAC",
  ];

  const hasInvalidFinancialValue =
    financialFields.some((name) => {
      const value = readNumber(form, name);

      return !Number.isFinite(value) || value < 0;
    });

  if (hasInvalidFinancialValue) {
    return "Financial values must be zero or greater.";
  }

  const percentComplete =
    readNumber(form, "percentComplete");

  if (
    !Number.isFinite(percentComplete) ||
    percentComplete < 0 ||
    percentComplete > 100
  ) {
    return "Percent complete must be between 0 and 100.";
  }

  const riskScore = readNumber(form, "riskScore");

  if (
    !Number.isFinite(riskScore) ||
    riskScore < 0 ||
    riskScore > 25
  ) {
    return "Risk score must be between 0 and 25.";
  }

  const startDate = getTrimmedValue(form, "startDate");
  const endDate = getTrimmedValue(form, "endDate");

  if (endDate < startDate) {
    return "End date must be on or after start date.";
  }

  return "";
}

function restoreFocus(previouslyFocusedElement) {
  if (previouslyFocusedElement?.isConnected) {
    previouslyFocusedElement.focus();
  }
}

function getFocusableElements(container) {
  const focusableSelector = [
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[href]",
    '[tabindex]:not([tabindex="-1"])',
  ].join(",");

  return Array.from(
    container.querySelectorAll(focusableSelector),
  ).filter((element) => {
    return (
      !element.closest("[hidden]") &&
      element.getClientRects().length > 0
    );
  });
}

function trapFocus(event, dialog) {
  const focusableElements = getFocusableElements(dialog);

  if (focusableElements.length === 0) {
    event.preventDefault();
    dialog.focus();
    return;
  }

  const firstFocusableElement = focusableElements[0];
  const lastFocusableElement =
    focusableElements[focusableElements.length - 1];

  if (!dialog.contains(document.activeElement)) {
    event.preventDefault();
    firstFocusableElement.focus();
    return;
  }

  if (
    event.shiftKey &&
    document.activeElement === firstFocusableElement
  ) {
    event.preventDefault();
    lastFocusableElement.focus();
    return;
  }

  if (
    !event.shiftKey &&
    document.activeElement === lastFocusableElement
  ) {
    event.preventDefault();
    firstFocusableElement.focus();
  }
}

function applyBackgroundInert(overlay) {
  const inertElements = Array.from(
    document.body.children,
  )
    .filter((element) => element !== overlay)
    .map((element) => {
      return {
        element,
        wasInert: element.inert,
      };
    });

  inertElements.forEach(({ element }) => {
    element.inert = true;
  });

  return () => {
    inertElements.forEach(({ element, wasInert }) => {
      element.inert = wasInert;
    });
  };
}

export function openProjectForm({
  mode,
  project = null,
  onSubmit,
  onCancel,
}) {
  if (mode !== "create" && mode !== "edit") {
    throw new Error(
      'Project form mode must be "create" or "edit".',
    );
  }

  if (
    mode === "edit" &&
    (
      !project ||
      typeof project.projectId !== "string" ||
      project.projectId.trim() === ""
    )
  ) {
    throw new Error("Edit mode requires an existing project.");
  }

  if (typeof onSubmit !== "function") {
    throw new Error("Project form requires an onSubmit handler.");
  }

  if (document.getElementById(MODAL_ID)) {
    return;
  }

  let isSubmitting = false;
  const previouslyFocusedElement = document.activeElement;
  const overlay = document.createElement("div");
  const modal = document.createElement("section");
  const header = document.createElement("div");
  const title = document.createElement("h2");
  const form = document.createElement("form");
  const grid = document.createElement("div");
  const errorBox = document.createElement("div");
  const actions = document.createElement("div");
  const cancelButton = document.createElement("button");
  const submitButton = document.createElement("button");
  const titleId = "sf-project-form-title";
  let restoreBackgroundInteraction = () => {};

  overlay.className = "sf-project-form-overlay";

  modal.id = MODAL_ID;
  modal.className = "sf-project-form-modal";
  modal.tabIndex = -1;
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", titleId);

  header.className = "sf-project-form-header";
  title.id = titleId;
  title.className = "sf-project-form-title";
  title.textContent =
    mode === "create"
      ? "Create Project"
      : "Edit Project";

  form.className = "sf-project-form";
  grid.className = "sf-project-form-grid";

  errorBox.className = "sf-project-form-error";
  errorBox.setAttribute("role", "alert");
  errorBox.setAttribute("aria-live", "polite");
  errorBox.hidden = true;

  actions.className = "sf-project-form-actions";

  cancelButton.type = "button";
  cancelButton.className = "sf-project-form-cancel";
  cancelButton.textContent = "Cancel";

  submitButton.type = "submit";
  submitButton.className = "sf-project-form-submit";
  submitButton.textContent =
    mode === "create"
      ? "Create Project"
      : "Save Project";

  header.append(title);

  if (mode === "edit") {
    grid.append(createReadonlyProjectIdField(project));
  }

  const fieldControls = FIELD_DEFINITIONS.map((definition) => {
    const field = createField(
      definition,
      project,
    );

    grid.append(field.wrapper);

    return field.control;
  });

  actions.append(
    cancelButton,
    submitButton,
  );

  form.append(
    grid,
    errorBox,
    actions,
  );

  modal.append(
    header,
    form,
  );

  overlay.append(modal);

  const closeForm = ({ cancelled = false } = {}) => {
    document.removeEventListener(
      "keydown",
      handleDocumentKeydown,
    );

    restoreBackgroundInteraction();
    overlay.remove();

    restoreFocus(previouslyFocusedElement);

    if (cancelled) {
      onCancel?.();
    }
  };

  function handleDocumentKeydown(event) {
    if (event.key === "Tab") {
      trapFocus(event, modal);
      return;
    }

    if (event.key === "Escape" && !isSubmitting) {
      closeForm({
        cancelled: true,
      });
    }
  }

  cancelButton.addEventListener("click", () => {
    if (isSubmitting) {
      return;
    }

    closeForm({
      cancelled: true,
    });
  });

  form.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();

      errorBox.hidden = true;
      errorBox.textContent = "";

      const validationMessage = validateForm(form);

      if (validationMessage) {
        errorBox.textContent = validationMessage;
        errorBox.hidden = false;

        return;
      }

      isSubmitting = true;
      submitButton.disabled = true;
      cancelButton.disabled = true;

      try {
        await onSubmit(
          buildProjectData(
            form,
            mode,
            project,
          ),
        );

        closeForm();
      } catch (error) {
        isSubmitting = false;
        errorBox.textContent =
          error?.message ?? "Project could not be saved.";
        errorBox.hidden = false;
        submitButton.disabled = false;
        cancelButton.disabled = false;
      }
    },
  );

  document.body.append(overlay);
  restoreBackgroundInteraction =
    applyBackgroundInert(overlay);

  document.addEventListener(
    "keydown",
    handleDocumentKeydown,
  );

  requestAnimationFrame(() => {
    const firstEditableField = fieldControls.find((control) => {
      return !control.disabled && !control.readOnly;
    });

    firstEditableField?.focus();
  });
}
