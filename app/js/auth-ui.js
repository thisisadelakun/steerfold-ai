import {
  signIn,
  signOut,
  getCurrentUser,
  isAuthenticated,
} from "./auth-service.js";
import * as authService from "./auth-service.js";
import { profileInitials, profileDisplayName } from "./profile-identity.js";

const PANEL_ID = "sf-auth-panel";

function accountInitials() {
  return profileInitials(getCurrentUser());
}

function accountLabel() {
  return isAuthenticated() ? profileDisplayName(getCurrentUser()) : "Sign In";
}

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
      ? "username"
      : "current-password";

  wrapper.append(label, input);

  return {
    wrapper,
    input,
  };
}

function createAuthMark(initial = null) {
  const mark = document.createElement("span");

  mark.className = initial ? "sf-auth-mark sf-account-avatar" : "sf-auth-mark";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = initial || "S";

  return mark;
}

function createHeader(titleText, copyText = "", initial = null) {
  const header = document.createElement("div");
  header.className = "sf-auth-panel-header";

  const title = document.createElement("h2");
  title.className = "sf-auth-panel-title";
  title.textContent = titleText;

  header.append(
    createAuthMark(initial),
    title,
  );

  if (copyText) {
    const copy = document.createElement("p");

    copy.className = "sf-auth-panel-copy";
    copy.textContent = copyText;

    header.append(copy);
  }

  return header;
}

function createPasswordToggle(input) {
  const button = document.createElement("button");
  const icon = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  const circle = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "circle",
  );
  const path = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path",
  );

  button.type = "button";
  button.className = "sf-auth-password-toggle";
  button.setAttribute("aria-label", "Show password");
  button.title = "Show password";

  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");
  icon.classList.add("sf-auth-password-icon");

  path.setAttribute(
    "d",
    "M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z",
  );
  circle.setAttribute("cx", "12");
  circle.setAttribute("cy", "12");
  circle.setAttribute("r", "3");

  icon.append(
    path,
    circle,
  );
  button.append(icon);

  button.addEventListener("click", () => {
    const shouldShow =
      input.type === "password";

    input.type = shouldShow ? "text" : "password";
    button.setAttribute(
      "aria-label",
      shouldShow ? "Hide password" : "Show password",
    );
    button.title =
      shouldShow ? "Hide password" : "Show password";
  });

  return button;
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
  mode = "signin",
  initialEmail = "",
) {
  panel.replaceChildren();
  const signingUp = mode === "signup";

  const header = createHeader(
    signingUp ? "Sign Up" : "Sign In",
    signingUp
      ? "Create your Steerfold account."
      : "Sign in to your Steerfold account. Public visitors can continue exploring the portfolio without signing in.",
  );

  const form = document.createElement("form");
  form.className = "sf-auth-form";

  const emailField = createField(
    signingUp ? "Email Address" : "Email",
    "email",
    "email",
  );
  emailField.input.value = initialEmail;

  const fullNameField = signingUp ? createField("Full Name", "text", "fullName") : null;
  if (fullNameField) {
    fullNameField.input.autocomplete = "name";
    fullNameField.input.maxLength = 120;
  }

  const passwordField = createField(
    "Password",
    "password",
    "password",
  );
  const passwordControl =
    document.createElement("div");

  passwordControl.className =
    "sf-auth-password-control";

  passwordField.wrapper.replaceChildren(
    passwordField.wrapper.querySelector("label"),
    passwordControl,
  );

  passwordControl.append(
    passwordField.input,
    createPasswordToggle(passwordField.input),
  );

  const confirmField = signingUp ? createField("Confirm Password", "password", "confirmPassword") : null;
  if (signingUp) {
    passwordField.input.autocomplete = "new-password";
    confirmField.input.autocomplete = "new-password";
    const confirmControl = document.createElement("div");
    confirmControl.className = "sf-auth-password-control";
    confirmField.wrapper.replaceChildren(confirmField.wrapper.querySelector("label"), confirmControl);
    confirmControl.append(confirmField.input, createPasswordToggle(confirmField.input));
  }

  const errorBox =
    createErrorBox(message);

  const submitButton =
    document.createElement("button");

  submitButton.type = "submit";
  submitButton.className =
    "sf-auth-submit";
  submitButton.textContent = signingUp ? "Sign Up" : "Sign In";

  const switchButton = document.createElement("button");
  switchButton.type = "button";
  switchButton.className = "sf-auth-switch";
  switchButton.textContent = signingUp ? "Return to Sign In" : "Sign Up";
  switchButton.addEventListener("click", (event) => {
    event.stopPropagation();
    renderLoggedOut(panel, "", signingUp ? "signin" : "signup", emailField.input.value.trim());
    repositionAuthView(panel);
  });

  const supportText =
    document.createElement("p");

  supportText.className = "sf-auth-support";
  supportText.textContent =
    "Authenticated access is required for project changes.";

  if (fullNameField) form.append(fullNameField.wrapper);
  form.append(
    emailField.wrapper,
    passwordField.wrapper,
  );
  if (confirmField) form.append(confirmField.wrapper);
  form.append(
    errorBox,
    submitButton,
    switchButton,
    supportText,
  );

  panel.append(
    header,
    form,
  );

  form.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();
      if (submitButton.disabled) return;

      const email =
        emailField.input.value.trim();

      const password =
        passwordField.input.value;

      errorBox.hidden = true;
      errorBox.textContent = "";
      if (signingUp) {
        const fullName = fullNameField.input.value.trim();
        let validationMessage = "";
        let invalidInput = null;
        if (!fullName || fullName.length > 120) {
          validationMessage = "Enter your full name using at most 120 characters.";
          invalidInput = fullNameField.input;
        } else if (!email || !emailField.input.validity.valid) {
          validationMessage = "Enter a valid email address.";
          invalidInput = emailField.input;
        } else if (!password) {
          validationMessage = "Enter a password.";
          invalidInput = passwordField.input;
        } else if (password !== confirmField.input.value) {
          validationMessage = "Passwords must match.";
          invalidInput = confirmField.input;
        }
        if (validationMessage) {
          errorBox.textContent = validationMessage;
          errorBox.hidden = false;
          invalidInput.focus();
          return;
        }
      }
      submitButton.disabled = true;
      switchButton.disabled = true;

      try {
        if (signingUp) {
          const result = await authService.signUp(email, password, fullNameField.input.value.trim());
          passwordField.input.value = "";
          confirmField.input.value = "";
          if (result.needsEmailVerification || !result.session) {
            if (form.isConnected && !isAuthenticated()) renderVerificationPending(panel, email);
            return;
          }
        } else {
          await signIn(email, password);
        }

        window.dispatchEvent(
          new CustomEvent("auth:changed"),
        );
      } catch (error) {
        errorBox.textContent =
          error?.message ??
          (signingUp ? "Sign up failed." : "Sign in failed.");

        errorBox.hidden = false;
      } finally {
        if (submitButton.isConnected) {
          submitButton.disabled = false;
          switchButton.disabled = false;
        }
      }
    },
  );
}

function repositionAuthView(panel) {
  const launcher = document.querySelector("[data-auth-launcher]");
  if (panel.hidden) return;
  if (launcher) positionPanel(launcher, panel);
  panel.querySelector("input, button")?.focus();
}

function renderVerificationPending(panel, email) {
  const status = document.createElement("p");
  status.className = "sf-auth-support sf-auth-verification";
  status.setAttribute("role", "status");
  status.textContent = `Check ${email} for a verification link. Verify your email, then return here to sign in. You are not signed in yet.`;
  const back = document.createElement("button");
  back.type = "button";
  back.className = "sf-auth-switch";
  back.textContent = "Return to Sign In";
  back.addEventListener("click", (event) => {
    event.stopPropagation();
    renderLoggedOut(panel, "", "signin", email);
    repositionAuthView(panel);
  });
  panel.replaceChildren(createHeader("Check Your Email"), status, back);
  repositionAuthView(panel);
}

function renderLoggedIn(panel) {
  panel.replaceChildren();

  const header = createHeader(
    accountLabel(),
    "Manage your profile and available workspaces.",
    accountInitials(),
  );

  const user = getCurrentUser();

  const signedIn =
    document.createElement("div");

  signedIn.className =
    "sf-auth-signed-in";

  const label =
    document.createElement("span");

  label.className = "sf-auth-signed-in-label";
  label.textContent = "Signed in as";

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
  const gap = 10;

  const rect =
    button.getBoundingClientRect();

  const viewportWidth =
    window.innerWidth;

  const viewportHeight =
    window.innerHeight;

  const panelWidth = Math.min(
    360,
    viewportWidth - gutter * 2,
  );

  panel.style.position = "fixed";
  panel.style.width =
    `${panelWidth}px`;

  panel.style.maxWidth =
    `calc(100vw - ${gutter * 2}px)`;

  panel.style.zIndex = "100";
  panel.style.maxHeight = `calc(100vh - ${gutter * 2}px)`;
  panel.style.overflowY = "auto";

  const panelHeight =
    panel.offsetHeight;

  let left =
    rect.right + gap;

  if (
    left + panelWidth >
    viewportWidth - gutter
  ) {
    left =
      rect.left - panelWidth - gap;
  }

  left = Math.max(
    gutter,
    Math.min(
      left,
      viewportWidth -
        panelWidth -
        gutter,
    ),
  );

  let top = rect.top;

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

function updateLauncherState(button) {
  const isSignedIn = isAuthenticated();
  const labelText =
    accountLabel();
  const label = button.querySelector(
    ".sf-sidebar-account-label",
  );

  if (label) {
    label.textContent = labelText;
  }

  button.title = labelText;

  const icon = button.querySelector(".sf-button-icon");
  if (icon) icon.toggleAttribute("hidden", isSignedIn);
  let avatar = button.querySelector(".sf-account-avatar");
  if (!avatar && isSignedIn) {
    avatar = document.createElement("span");
    avatar.className = "sf-account-avatar";
    avatar.setAttribute("aria-hidden", "true");
    button.prepend(avatar);
  }
  if (avatar) {
    avatar.hidden = !isSignedIn;
    avatar.textContent = isSignedIn ? accountInitials() : "";
  }
  if (isSignedIn && button.dataset.accountPage === "true") {
    for (const attribute of ["aria-haspopup", "aria-expanded", "aria-controls"]) button.removeAttribute(attribute);
  } else {
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-controls", PANEL_ID);
  }
}

export function initAuthUI({ onOpenAccount } = {}) {
  const button =
    document.querySelector(
      "[data-auth-launcher]",
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
  button.dataset.accountPage = String(typeof onOpenAccount === "function");

  window.addEventListener("profile:identity-changed", () => {
    updateLauncherState(button);
    const avatar = panel.querySelector(".sf-account-avatar");
    if (avatar && isAuthenticated()) {
      avatar.textContent = accountInitials();
      panel.querySelector(".sf-auth-panel-title").textContent = accountLabel();
    }
  });

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
  updateLauncherState(button);

  button.addEventListener(
    "click",
    () => {
      if (isAuthenticated() && typeof onOpenAccount === "function") {
        if (!panel.hidden) closePanel(panel, button);
        onOpenAccount();
        return;
      }
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
      updateLauncherState(button);

      if (isAuthenticated() && typeof onOpenAccount === "function" && !panel.hidden) {
        closePanel(panel, button);
        updateLauncherState(button);
        return;
      }

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
