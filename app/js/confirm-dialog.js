const CONFIRM_DIALOG_ID = "sf-confirm-dialog";

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

export function openConfirmDialog({
  title,
  message,
  confirmText,
  cancelText = "Cancel",
  danger = false,
  onConfirm,
}) {
  if (typeof onConfirm !== "function") {
    throw new Error("Confirm dialog requires an onConfirm handler.");
  }

  if (document.getElementById(CONFIRM_DIALOG_ID)) {
    return;
  }

  let isConfirming = false;
  const previouslyFocusedElement = document.activeElement;
  const overlay = document.createElement("div");
  const dialog = document.createElement("section");
  const heading = document.createElement("h2");
  const body = document.createElement("p");
  const warning = document.createElement("p");
  const errorBox = document.createElement("div");
  const actions = document.createElement("div");
  const cancelButton = document.createElement("button");
  const confirmButton = document.createElement("button");
  const titleId = "sf-confirm-title";
  let restoreBackgroundInteraction = () => {};

  overlay.className = "sf-confirm-overlay";

  dialog.id = CONFIRM_DIALOG_ID;
  dialog.className = "sf-confirm-dialog";
  dialog.tabIndex = -1;
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", titleId);

  heading.id = titleId;
  heading.className = "sf-confirm-title";
  heading.textContent = title;

  body.className = "sf-confirm-message";
  body.textContent = message;

  warning.className = "sf-confirm-warning";
  warning.textContent = "This action cannot be undone.";

  errorBox.className = "sf-confirm-error";
  errorBox.setAttribute("role", "alert");
  errorBox.setAttribute("aria-live", "polite");
  errorBox.hidden = true;

  actions.className = "sf-confirm-actions";

  cancelButton.type = "button";
  cancelButton.className = "sf-confirm-cancel";
  cancelButton.textContent = cancelText;

  confirmButton.type = "button";
  confirmButton.className = "sf-confirm-delete";
  confirmButton.textContent = confirmText;

  if (danger) {
    confirmButton.dataset.danger = "true";
  }

  actions.append(
    cancelButton,
    confirmButton,
  );

  dialog.append(
    heading,
    body,
    warning,
    errorBox,
    actions,
  );

  overlay.append(dialog);

  const restoreFocus = () => {
    if (previouslyFocusedElement?.isConnected) {
      previouslyFocusedElement.focus();
    }
  };

  const closeDialog = () => {
    document.removeEventListener(
      "keydown",
      handleDocumentKeydown,
    );

    restoreBackgroundInteraction();
    overlay.remove();
    restoreFocus();
  };

  function handleDocumentKeydown(event) {
    if (event.key === "Tab") {
      trapFocus(event, dialog);
      return;
    }

    if (event.key === "Escape" && !isConfirming) {
      closeDialog();
    }
  }

  cancelButton.addEventListener("click", () => {
    if (isConfirming) {
      return;
    }

    closeDialog();
  });

  confirmButton.addEventListener(
    "click",
    async () => {
      if (isConfirming) {
        return;
      }

      isConfirming = true;
      confirmButton.disabled = true;
      cancelButton.disabled = true;
      errorBox.hidden = true;
      errorBox.textContent = "";

      try {
        await onConfirm();
        closeDialog();
      } catch (error) {
        isConfirming = false;
        confirmButton.disabled = false;
        cancelButton.disabled = false;
        errorBox.textContent =
          error?.message ?? "The action could not be completed.";
        errorBox.hidden = false;
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
    cancelButton.focus();
  });
}
