import {
  signIn,
  signOut,
  getCurrentUser,
  isAuthenticated,
} from "./auth-service.js";

const PANEL_ID = "sf-auth-panel";

function createPanel() {
  const existingPanel = document.getElementById(PANEL_ID);

  if (existingPanel) {
    return existingPanel;
  }

  const panel = document.createElement("div");

  panel.id = PANEL_ID;
  panel.className = "sf-auth-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Account");
  panel.hidden = true;

  document.body.append(panel);

  return panel;
}

function createField(
  labelText,
  inputType,
  inputName,
) {
  const wrapper = document.createElement("div");
  wrapper.className = "sf-auth-field";

  const label = document.createElement("label");
  label.textContent = labelText;
  label.htmlFor = `sf-auth-${inputName}`;

  const input = document.createElement("input");
  input.id = `sf-auth-${inputName}`;
  input.type = inputType;
  input.name = inputName;
  input.required = true;

  input.autocomplete =
    inputType === "email"
      ? "email"
      : "current-password";

  wrapper.append(label, input);

  return {
    wrapper,
    input,
  };
}

function createHeader(titleText) {
  const header = document.createElement("div");
  header.className = "sf-auth-panel-header";

  const title = document.createElement("span");
  title.className = "sf-auth-panel-title";
  title.textContent = titleText;

  header.append(title);

  return header;
}

function createErrorBox(message = "") {
  const errorBox = document.createElement("div");

  errorBox.className = "sf-auth-error";
  errorBox.setAttribute("role", "alert");
  errorBox.setAttribute(
    "aria-live",
    "polite",
  );

  if (message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  } else {
    errorBox.hidden = true;
  }

  return errorBox;
}

function renderLoggedOut(
  panel,
  message = "",
) {
  panel.replaceChildren();

  const header = createHeader(
    "Admin Sign In",
  );

  const form = document.createElement("form");
  form.className = "sf-auth-form";

  const emailField = createField(
    "Email",
    "email",
    "email",
  );

  const passwordField = createField(
    "Password",
    "password",
    "password",
  );

  const errorBox =
    createErrorBox(message);

  const submitButton =
    document.createElement("button");

  submitButton.type = "submit";
  submitButton.className =
    "sf-auth-submit";
  submitButton.textContent = "Sign In";

  form.append(
    emailField.wrapper,
    passwordField.wrapper,
    errorBox,
    submitButton,
  );

  panel.append(
    header,
    form,
  );

  form.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();

      const email =
        emailField.input.value.trim();

      const password =
        passwordField.input.value;

      errorBox.hidden = true;
      errorBox.textContent = "";
      submitButton.disabled = true;

      try {
        await signIn(
          email,
          password,
        );

        window.dispatchEvent(
          new CustomEvent("auth:changed"),
        );
      } catch (error) {
        errorBox.textContent =
          error?.message ??
          "Sign in failed.";

        errorBox.hidden = false;
      } finally {
        if (submitButton.isConnected) {
          submitButton.disabled = false;
        }
      }
    },
  );
}

function renderLoggedIn(panel) {
  panel.replaceChildren();

  const header = createHeader("Admin");

  const user = getCurrentUser();

  const signedIn =
    document.createElement("div");

  signedIn.className =
    "sf-auth-signed-in";

  const label =
    document.createElement("span");

  label.textContent = "Signed in as: ";

  const email =
    document.createElement("span");

  email.className = "sf-auth-email";
  email.textContent =
    user?.email ?? "—";

  signedIn.append(
    label,
    email,
  );

  const signOutButton =
    document.createElement("button");

  signOutButton.type = "button";
  signOutButton.className =
    "sf-auth-sign-out";

  signOutButton.textContent =
    "Sign Out";

  panel.append(
    header,
    signedIn,
    signOutButton,
  );

  signOutButton.addEventListener(
    "click",
    async () => {
      signOutButton.disabled = true;

      try {
        await signOut();

        window.dispatchEvent(
          new CustomEvent(
            "auth:changed",
          ),
        );
      } catch {
        /*
         * auth-service clears the local
         * session even if remote logout
         * fails.
         */
        window.dispatchEvent(
          new CustomEvent(
            "auth:changed",
            {
              detail: {
                message:
                  "Signed out locally. Server sign-out could not be confirmed.",
              },
            },
          ),
        );
      } finally {
        if (signOutButton.isConnected) {
          signOutButton.disabled = false;
        }
      }
    },
  );
}

function renderPanel(
  panel,
  message = "",
) {
  if (isAuthenticated()) {
    renderLoggedIn(panel);
  } else {
    renderLoggedOut(
      panel,
      message,
    );
  }
}

function positionPanel(
  button,
  panel,
) {
  const gutter = 12;
  const gap = 8;

  const rect =
    button.getBoundingClientRect();

  const viewportWidth =
    window.innerWidth;

  const viewportHeight =
    window.innerHeight;

  const panelWidth = Math.min(
    320,
    viewportWidth - gutter * 2,
  );

  panel.style.position = "fixed";
  panel.style.width =
    `${panelWidth}px`;

  panel.style.maxWidth =
    `calc(100vw - ${gutter * 2}px)`;

  panel.style.zIndex = "100";

  const panelHeight =
    panel.offsetHeight;

  let left =
    rect.right - panelWidth;

  left = Math.max(
    gutter,
    Math.min(
      left,
      viewportWidth -
        panelWidth -
        gutter,
    ),
  );

  let top =
    rect.bottom + gap;

  if (
    top + panelHeight >
    viewportHeight - gutter
  ) {
    const above =
      rect.top -
      panelHeight -
      gap;

    if (above >= gutter) {
      top = above;
    } else {
      top = Math.max(
        gutter,
        viewportHeight -
          panelHeight -
          gutter,
      );
    }
  }

  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

function focusPanelControl(panel) {
  if (isAuthenticated()) {
    panel
      .querySelector(
        ".sf-auth-sign-out",
      )
      ?.focus();

    return;
  }

  panel
    .querySelector(
      'input[type="email"]',
    )
    ?.focus();
}

function openPanel(
  panel,
  button,
  message = "",
) {
  renderPanel(
    panel,
    message,
  );

  panel.hidden = false;

  button.setAttribute(
    "aria-expanded",
    "true",
  );

  positionPanel(
    button,
    panel,
  );

  focusPanelControl(panel);
}

function closePanel(
  panel,
  button,
  restoreFocus = false,
) {
  panel.hidden = true;

  button.setAttribute(
    "aria-expanded",
    "false",
  );

  if (restoreFocus) {
    button.focus();
  }
}

export function initAuthUI() {
  const button =
    document.querySelector(
      ".sf-account-area .sf-icon-button",
    );

  if (!button) {
    return;
  }

  if (
    button.dataset.authUiInitialized ===
    "true"
  ) {
    return;
  }

  button.dataset.authUiInitialized =
    "true";

  const panel = createPanel();

  button.setAttribute(
    "aria-expanded",
    "false",
  );

  button.setAttribute(
    "aria-controls",
    PANEL_ID,
  );

  button.setAttribute(
    "aria-haspopup",
    "dialog",
  );

  button.addEventListener(
    "click",
    () => {
      if (!panel.hidden) {
        closePanel(
          panel,
          button,
        );

        return;
      }

      openPanel(
        panel,
        button,
      );
    },
  );

  document.addEventListener(
    "click",
    (event) => {
      if (
        panel.hidden ||
        panel.contains(event.target) ||
        button.contains(event.target)
      ) {
        return;
      }

      closePanel(
        panel,
        button,
      );
    },
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key !== "Escape" ||
        panel.hidden
      ) {
        return;
      }

      closePanel(
        panel,
        button,
        true,
      );
    },
  );

  const repositionPanel = () => {
    if (!panel.hidden) {
      positionPanel(
        button,
        panel,
      );
    }
  };

  window.addEventListener(
    "resize",
    repositionPanel,
  );

  window.addEventListener(
    "scroll",
    repositionPanel,
    true,
  );

  window.addEventListener(
    "auth:changed",
    (event) => {
      if (panel.hidden) {
        return;
      }

      openPanel(
        panel,
        button,
        event.detail?.message ?? "",
      );
    },
  );
}