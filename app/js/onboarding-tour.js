const TOUR_STORAGE_KEY = "steerfold_tour_completed";
const TOUR_OVERLAY_ID = "sf-onboarding-tour";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const TOUR_STEPS = [
  {
    title: "Welcome to Steerfold AI",
    copy:
      "Explore project performance, budgets, risk, forecasting and management decision signals in one interactive portfolio.",
  },
  {
    title: "Portfolio Overview",
    copy:
      "Start with a high-level view of portfolio health, financial performance, risk and resource demand.",
    selector: '.sf-nav-link[data-nav-target="portfolio"]',
    fallbackSelector: ".sf-sidebar",
  },
  {
    title: "Explore Projects",
    copy:
      "Search, filter and review individual projects, then open any project for detailed performance information.",
    selector: '.sf-nav-link[href="./#projects"]',
    fallbackSelector: ".sf-sidebar",
  },
  {
    title: "Performance & Forecasting",
    copy:
      "Review earned value performance, cost and schedule efficiency, projected final cost and remaining budget pressure.",
    selectors: [
      '.sf-nav-link[href="./#budget"]',
      '.sf-nav-link[href="./#forecasting"]',
    ],
    fallbackSelector: ".sf-nav, .sf-sidebar",
  },
  {
    title: "Choose Your Analysis",
    copy:
      "Switch between risk, budget, completion, donut, heatmap and project health radar views to explore the portfolio from different angles.",
    selector: "[data-portfolio-analysis-select]",
    fallbackSelector: "[data-portfolio-analysis]",
  },
  {
    title: "Decision Support",
    copy:
      "See which projects require management attention and the performance, risk and forecast signals driving each recommendation.",
    selector: '.sf-nav-link[href="./#decision-support"]',
    fallbackSelector: ".sf-sidebar",
  },
  {
    title: "Explore Freely",
    copy:
      "Portfolio data is simulated for demonstration. Public visitors can explore the dashboard, while authenticated admins can create, edit and delete project records.",
    selector: '.sf-icon-button[aria-label="Account controls"]',
    fallbackSelector: ".sf-account-area",
  },
];

function isVisible(element) {
  const rect = element?.getBoundingClientRect();

  return (
    element instanceof Element &&
    !element.closest("[hidden]") &&
    element.getClientRects().length > 0 &&
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < window.innerHeight &&
    rect.left < window.innerWidth
  );
}

function getVisibleElement(selector) {
  if (!selector) {
    return null;
  }

  return Array.from(
    document.querySelectorAll(selector),
  ).find(isVisible) ?? null;
}

function getTargetElements(step) {
  const selectors =
    step.selectors ?? (step.selector ? [step.selector] : []);

  const targets = selectors
    .map(getVisibleElement)
    .filter(Boolean);

  if (targets.length > 0) {
    return targets;
  }

  const fallback = getVisibleElement(step.fallbackSelector);

  return fallback ? [fallback] : [];
}

function getCombinedRect(elements) {
  if (elements.length === 0) {
    return null;
  }

  const rects = elements.map((element) => {
    return element.getBoundingClientRect();
  });

  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  const left = Math.min(...rects.map((rect) => rect.left));

  return {
    top,
    right,
    bottom,
    left,
    width: right - left,
    height: bottom - top,
  };
}

function getFocusableElements(container) {
  return Array.from(
    container.querySelectorAll(FOCUSABLE_SELECTOR),
  ).filter(isVisible);
}

function trapFocus(event, card) {
  const focusableElements = getFocusableElements(card);

  if (focusableElements.length === 0) {
    event.preventDefault();
    card.focus();
    return;
  }

  const firstFocusableElement = focusableElements[0];
  const lastFocusableElement =
    focusableElements[focusableElements.length - 1];

  if (!card.contains(document.activeElement)) {
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
  const inertElements = Array.from(document.body.children)
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

function createTourButton() {
  const accountArea = document.querySelector(".sf-account-area");

  if (
    !accountArea ||
    accountArea.querySelector(".sf-tour-button")
  ) {
    return null;
  }

  const button = document.createElement("button");

  button.type = "button";
  button.className = "sf-tour-button";
  button.setAttribute(
    "aria-label",
    "Take Steerfold tour",
  );
  button.title = "Take Tour";
  button.textContent = "?";

  const accountButton = accountArea.querySelector(
    '.sf-icon-button[aria-label="Account controls"]',
  );

  if (accountButton) {
    accountArea.insertBefore(button, accountButton);
  } else {
    accountArea.append(button);
  }

  return button;
}

function positionTourCard({
  card,
  spotlight,
  step,
}) {
  const targetRect = getCombinedRect(getTargetElements(step));
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const margin = 16;
  const gap = 14;

  card.style.removeProperty("top");
  card.style.removeProperty("right");
  card.style.removeProperty("bottom");
  card.style.removeProperty("left");
  card.style.removeProperty("transform");

  if (!targetRect) {
    spotlight.hidden = true;
    card.classList.add("sf-tour-card--centered");
    return;
  }

  const paddedRect = {
    top: Math.max(margin, targetRect.top - 8),
    left: Math.max(margin, targetRect.left - 8),
    width: Math.min(
      viewportWidth - margin * 2,
      targetRect.width + 16,
    ),
    height: Math.min(
      viewportHeight - margin * 2,
      targetRect.height + 16,
    ),
  };

  spotlight.hidden = false;
  spotlight.style.top = `${paddedRect.top}px`;
  spotlight.style.left = `${paddedRect.left}px`;
  spotlight.style.width = `${paddedRect.width}px`;
  spotlight.style.height = `${paddedRect.height}px`;

  card.classList.remove("sf-tour-card--centered");

  const cardRect = card.getBoundingClientRect();
  const cardWidth = Math.min(cardRect.width, viewportWidth - margin * 2);
  const cardHeight = cardRect.height;
  const availableRight =
    viewportWidth - targetRect.right - gap - margin;
  const availableLeft = targetRect.left - gap - margin;
  let left;
  let top;

  if (viewportWidth <= 720) {
    left = margin;
    top = Math.min(
      Math.max(targetRect.bottom + gap, margin),
      viewportHeight - cardHeight - margin,
    );

    if (targetRect.bottom + gap + cardHeight > viewportHeight) {
      top = Math.max(margin, targetRect.top - cardHeight - gap);
    }
  } else if (availableRight >= cardWidth) {
    left = targetRect.right + gap;
    top = targetRect.top;
  } else if (availableLeft >= cardWidth) {
    left = targetRect.left - cardWidth - gap;
    top = targetRect.top;
  } else {
    left = Math.min(
      Math.max(targetRect.left, margin),
      viewportWidth - cardWidth - margin,
    );
    top = targetRect.bottom + gap;
  }

  top = Math.min(
    Math.max(top, margin),
    Math.max(margin, viewportHeight - cardHeight - margin),
  );
  left = Math.min(
    Math.max(left, margin),
    Math.max(margin, viewportWidth - cardWidth - margin),
  );

  card.style.top = `${top}px`;
  card.style.left = `${left}px`;
}

function openTour({
  launchedBy = null,
  markCompletedOnClose = false,
} = {}) {
  if (document.getElementById(TOUR_OVERLAY_ID)) {
    return;
  }

  let currentStepIndex = 0;
  let restoreBackgroundInteraction = () => {};
  const previouslyFocusedElement =
    launchedBy ?? document.activeElement;
  const overlay = document.createElement("div");
  const spotlight = document.createElement("div");
  const card = document.createElement("section");
  const progress = document.createElement("p");
  const title = document.createElement("h2");
  const copy = document.createElement("p");
  const actions = document.createElement("div");
  const backButton = document.createElement("button");
  const skipButton = document.createElement("button");
  const nextButton = document.createElement("button");
  const titleId = "sf-tour-title";
  const descriptionId = "sf-tour-description";
  const progressId = "sf-tour-progress";

  overlay.id = TOUR_OVERLAY_ID;
  overlay.className = "sf-tour-overlay";

  spotlight.className = "sf-tour-spotlight";
  spotlight.setAttribute("aria-hidden", "true");

  card.className = "sf-tour-card";
  card.tabIndex = -1;
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-labelledby", titleId);
  card.setAttribute(
    "aria-describedby",
    `${progressId} ${descriptionId}`,
  );

  progress.id = progressId;
  progress.className = "sf-tour-progress";

  title.id = titleId;
  title.className = "sf-tour-title";

  copy.id = descriptionId;
  copy.className = "sf-tour-copy";

  actions.className = "sf-tour-actions";

  backButton.type = "button";
  backButton.className = "sf-tour-button-secondary";
  backButton.textContent = "Back";

  skipButton.type = "button";
  skipButton.className = "sf-tour-button-secondary";
  skipButton.textContent = "Skip Tour";

  nextButton.type = "button";
  nextButton.className = "sf-tour-button-primary";

  actions.append(
    backButton,
    skipButton,
    nextButton,
  );

  card.append(
    progress,
    title,
    copy,
    actions,
  );

  overlay.append(
    spotlight,
    card,
  );

  const markCompleted = () => {
    localStorage.setItem(TOUR_STORAGE_KEY, "true");
  };

  const restoreFocus = () => {
    if (previouslyFocusedElement?.isConnected) {
      previouslyFocusedElement.focus();
    }
  };

  const closeTour = ({ completed = false } = {}) => {
    window.removeEventListener("resize", handleResize);
    document.removeEventListener(
      "keydown",
      handleDocumentKeydown,
    );

    if (completed || markCompletedOnClose) {
      markCompleted();
    }

    restoreBackgroundInteraction();
    overlay.remove();
    restoreFocus();
  };

  const renderStep = () => {
    const step = TOUR_STEPS[currentStepIndex];
    const isFirstStep = currentStepIndex === 0;
    const isFinalStep =
      currentStepIndex === TOUR_STEPS.length - 1;

    progress.textContent =
      `${currentStepIndex + 1} of ${TOUR_STEPS.length}`;
    title.textContent = step.title;
    copy.textContent = step.copy;
    backButton.disabled = isFirstStep;
    skipButton.hidden = isFinalStep;
    nextButton.textContent =
      isFinalStep ? "Start Exploring" : "Next";

    requestAnimationFrame(() => {
      positionTourCard({
        card,
        spotlight,
        step,
      });
      nextButton.focus();
    });
  };

  function handleResize() {
    positionTourCard({
      card,
      spotlight,
      step: TOUR_STEPS[currentStepIndex],
    });
  }

  function handleDocumentKeydown(event) {
    if (event.key === "Tab") {
      trapFocus(event, card);
      return;
    }

    if (event.key === "Escape") {
      closeTour({
        completed: true,
      });
    }
  }

  backButton.addEventListener("click", () => {
    if (currentStepIndex === 0) {
      return;
    }

    currentStepIndex -= 1;
    renderStep();
  });

  skipButton.addEventListener("click", () => {
    closeTour({
      completed: true,
    });
  });

  nextButton.addEventListener("click", () => {
    if (currentStepIndex === TOUR_STEPS.length - 1) {
      closeTour({
        completed: true,
      });
      return;
    }

    currentStepIndex += 1;
    renderStep();
  });

  document.body.append(overlay);
  restoreBackgroundInteraction = applyBackgroundInert(overlay);
  document.addEventListener(
    "keydown",
    handleDocumentKeydown,
  );
  window.addEventListener("resize", handleResize);

  renderStep();
}

export function initOnboardingTour() {
  const tourButton = createTourButton();

  tourButton?.addEventListener("click", () => {
    openTour({
      launchedBy: tourButton,
    });
  });

  if (localStorage.getItem(TOUR_STORAGE_KEY) === "true") {
    return;
  }

  requestAnimationFrame(() => {
    openTour({
      markCompletedOnClose: true,
    });
  });
}
