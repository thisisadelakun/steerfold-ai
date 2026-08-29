const STAKEHOLDER_AUDIENCES = [
  {
    key: "executive",
    label: "Executive",
    description:
      "Portfolio-level performance, exposure and strategic attention.",
    placeholders: [
      "Executive key signals will appear here.",
      "Audience-specific performance view.",
      "Priority attention and decision signals.",
      "Supporting portfolio detail.",
    ],
  },
  {
    key: "sponsor",
    label: "Sponsor",
    description:
      "Project health, forecast confidence and decisions requiring sponsorship.",
    placeholders: [
      "Sponsor key signals will appear here.",
      "Audience-specific performance view.",
      "Priority attention and decision signals.",
      "Supporting project detail.",
    ],
  },
  {
    key: "team",
    label: "Team",
    description:
      "Delivery progress, risks, resource pressure and immediate actions.",
    placeholders: [
      "Team key signals will appear here.",
      "Audience-specific performance view.",
      "Priority attention and decision signals.",
      "Supporting delivery detail.",
    ],
  },
];

const DASHBOARD_SECTIONS = [
  "Key Signals",
  "Performance Overview",
  "Attention & Decisions",
  "Supporting Detail",
];

let selectedAudienceKey = "executive";

function getSelectedAudience() {
  return (
    STAKEHOLDER_AUDIENCES.find((audience) => {
      return audience.key === selectedAudienceKey;
    }) ?? STAKEHOLDER_AUDIENCES[0]
  );
}

function createAudienceSelector(container) {
  const selector = document.createElement("div");

  selector.className = "sf-stakeholder-selector";
  selector.setAttribute("role", "group");
  selector.setAttribute(
    "aria-label",
    "Stakeholder audience",
  );

  STAKEHOLDER_AUDIENCES.forEach((audience) => {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "sf-stakeholder-tab";
    button.dataset.audience = audience.key;
    button.textContent = audience.label;

    button.addEventListener("click", () => {
      selectedAudienceKey = audience.key;
      updateStakeholderView(container);
    });

    selector.append(button);
  });

  return selector;
}

function createDescriptor() {
  const descriptor = document.createElement("p");

  descriptor.className = "sf-stakeholder-audience-copy";
  descriptor.setAttribute("aria-live", "polite");

  return descriptor;
}

function createDashboardShell() {
  const dashboard = document.createElement("div");

  dashboard.className = "sf-stakeholder-dashboard";

  DASHBOARD_SECTIONS.forEach((sectionTitle, index) => {
    const section = document.createElement("section");
    const heading = document.createElement("h2");
    const placeholder = document.createElement("p");

    section.className = "sf-stakeholder-card";
    section.setAttribute("aria-labelledby", `stakeholder-section-${index}`);

    heading.id = `stakeholder-section-${index}`;
    heading.textContent = sectionTitle;

    placeholder.className = "sf-stakeholder-placeholder";

    section.append(
      heading,
      placeholder,
    );
    dashboard.append(section);
  });

  return dashboard;
}

function updateStakeholderView(container) {
  const selectedAudience = getSelectedAudience();
  const buttons = container.querySelectorAll(
    ".sf-stakeholder-tab",
  );
  const descriptor = container.querySelector(
    ".sf-stakeholder-audience-copy",
  );
  const placeholders = container.querySelectorAll(
    ".sf-stakeholder-placeholder",
  );

  buttons.forEach((button) => {
    const isSelected =
      button.dataset.audience === selectedAudience.key;

    button.classList.toggle(
      "sf-stakeholder-tab--active",
      isSelected,
    );
    button.setAttribute("aria-pressed", String(isSelected));
  });

  if (descriptor) {
    descriptor.textContent = selectedAudience.description;
  }

  placeholders.forEach((placeholder, index) => {
    placeholder.textContent =
      selectedAudience.placeholders[index] ??
      "Audience-specific portfolio detail.";
  });
}

export function renderStakeholderView(container) {
  if (!(container instanceof HTMLElement)) {
    return;
  }

  if (!container.dataset.stakeholderViewInitialized) {
    const selector = createAudienceSelector(container);
    const descriptor = createDescriptor();
    const dashboard = createDashboardShell();

    container.replaceChildren(
      selector,
      descriptor,
      dashboard,
    );

    container.dataset.stakeholderViewInitialized = "true";
  }

  updateStakeholderView(container);
}
