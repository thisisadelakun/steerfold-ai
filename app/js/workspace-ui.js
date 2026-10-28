import { getCurrentUser, isAuthenticated } from "./auth-service.js";
import { getActiveWorkspace, canWriteWorkspace } from "./workspace-context.js";
import { loadWorkspaces, getWorkspaceChoices, selectWorkspace, createWorkspace, resetWorkspaceSession } from "./workspace-service.js";

const AUTH_INTENT_KEY = "steerfold-auth-intent";

function node(tag, text = "", className = "") {
  const element = document.createElement(tag);
  element.textContent = text;
  element.className = className;
  return element;
}

export function initWorkspaceUI({ onPrepare, onWorkspace, onPortfolio, onCreateProject, onImport, onReady = () => false }) {
  const main = document.querySelector(".sf-main-content");
  const sidebar = document.querySelector(".sf-sidebar");
  const navigation = sidebar.querySelector(".sf-nav");
  const switcher = node("div", "", "sf-workspace-switcher");
  const label = node("label", "Workspace");
  label.htmlFor = "sf-workspace-select";
  const select = node("select");
  select.id = label.htmlFor;
  select.setAttribute("aria-label", "Active workspace");
  const compact = node("button", "", "sf-workspace-compact");
  compact.type = "button";
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "1.7");
  icon.setAttribute("stroke-linejoin", "round");
  icon.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M3 7h18v13H3z M8 7V4h8v3 M3 12h18 M10 12v3h4v-3");
  icon.append(path); compact.append(icon);
  const badge = node("span", "Demo Workspace", "sf-workspace-demo");
  badge.hidden = true;
  const switchStatus = node("p", "", "sf-workspace-switch-status");
  switchStatus.setAttribute("role", "status");
  switcher.append(label, select, badge, switchStatus);
  navigation.before(switcher);

  const gate = node("section", "", "sf-workspace-gate");
  gate.dataset.workspaceGate = "true";
  gate.setAttribute("aria-labelledby", "sf-workspace-setup-title");
  const heading = node("h2", "Create your workspace");
  heading.id = "sf-workspace-setup-title";
  const description = node("p", "Start with an empty portfolio for your organization.");
  const form = node("form", "", "sf-workspace-form");
  const inputs = {};
  for (const [key, title, required] of [["name", "Organization Name", true], ["industry", "Industry", false]]) {
    const field = node("div", "", "sf-workspace-field");
    const fieldLabel = node("label", title);
    const input = node("input");
    input.type = "text"; input.name = key; input.id = `sf-workspace-${key}`;
    input.maxLength = 120; input.required = required;
    fieldLabel.htmlFor = input.id;
    inputs[key] = input;
    field.append(fieldLabel, input); form.append(field);
  }
  const currencyField = node("div", "", "sf-workspace-field");
  const currencyLabel = node("label", "Organization Currency");
  const currency = node("select");
  currency.id = "sf-workspace-currency"; currency.name = "currency"; currency.required = true;
  currencyLabel.htmlFor = currency.id;
  for (const [value, text] of [["", "Choose a currency"], ["CAD", "CAD - Canadian Dollar"], ["USD", "USD - US Dollar"],
    ["GBP", "GBP - British Pound"], ["EUR", "EUR - Euro"]]) {
    const option = node("option", text); option.value = value; currency.append(option);
  }
  currencyField.append(currencyLabel, currency, node("small", "Financial records in this workspace use this currency. No demo records are copied."));
  const submit = node("button", "Create Workspace", "sf-utility-primary"); submit.type = "submit";
  const status = node("p"); status.setAttribute("role", "status");
  const retry = node("button", "Reload Workspaces", "sf-utility-secondary"); retry.type = "button";
  const demo = node("button", "Explore Demo Workspace", "sf-utility-secondary"); demo.type = "button";
  const demoStatus = node("p", "", "sf-workspace-switch-status");
  demoStatus.id = "sf-workspace-demo-status";
  demo.setAttribute("aria-describedby", demoStatus.id);
  const signIn = node("button", "Sign In / Sign Up", "sf-utility-primary"); signIn.type = "button";
  const actions = node("div", "", "sf-workspace-actions"); actions.append(retry, demo, signIn);
  form.append(currencyField, submit); gate.append(heading, description, form, status, actions, demoStatus);
  main.prepend(gate);

  const empty = node("section", "", "sf-workspace-empty");
  empty.dataset.workspaceEmpty = "true";
  empty.append(node("h2", "Your portfolio is ready."), node("p", "Create your first project or import project data to begin monitoring budget, schedule and portfolio performance."));
  const emptyActions = node("div", "", "sf-workspace-actions");
  for (const [text, handler] of [["Create Project", onCreateProject], ["Import Projects", onImport], ["Explore Demo Workspace", () => chooseDemo()]]) {
    const button = node("button", text, text === "Create Project" ? "sf-utility-primary" : "sf-utility-secondary");
    button.type = "button"; button.addEventListener("click", handler); emptyActions.append(button);
  }
  empty.append(emptyActions); empty.hidden = true; main.prepend(empty);
  let loading = true;
  let creating = false;
  let error = "";
  let setup = false;
  let route = "portfolio";
  let projectCount = 0;
  let version = 0;
  let creationUnverified = false;
  let discovering = false;
  let failureKind = "";
  let createIntent = false;
  try { createIntent = localStorage.getItem(AUTH_INTENT_KEY) === "create-workspace"; } catch { /* Navigation works without persistence. */ }

  function syncSidebar() {
    const collapsed = document.querySelector(".sf-app-shell")?.classList.contains("sf-sidebar-collapsed")
      && window.innerWidth > 820;
    switcher.replaceChildren(...(collapsed ? [compact, switchStatus] : [label, select, badge, switchStatus]));
  }
  compact.addEventListener("click", () => {
    sidebar.querySelector(".sf-sidebar-toggle")?.click();
    syncSidebar();
    if (switcher.contains(select)) select.focus();
  });
  window.addEventListener("resize", syncSidebar);

  function render(view = route, count = projectCount) {
    route = view; projectCount = count;
    const workspace = getActiveWorkspace();
    const blocked = loading || !workspace || setup || Boolean(error);
    document.documentElement.dataset.workspaceBlocked = String(blocked && route !== "account");
    document.documentElement.dataset.workspaceEmpty = String(!blocked && route === "portfolio" && !workspace.isDemo && count === 0);
    gate.hidden = !blocked || route === "account";
    empty.hidden = blocked || route !== "portfolio" || workspace?.isDemo || count !== 0;
    select.disabled = loading || creating || Boolean(error) || !getWorkspaceChoices().length;
    badge.hidden = !workspace?.isDemo;
    badge.textContent = workspace?.canWrite ? "Demo Workspace" : "Demo Workspace · Read-only";
    select.replaceChildren();
    const selectorLabel = loading ? "Loading workspaces..." : error ? "Workspace unavailable" : "Choose workspace";
    if (!workspace) {
      const placeholder = node("option", selectorLabel);
      placeholder.value = ""; placeholder.disabled = true; select.append(placeholder);
    }
    for (const choice of getWorkspaceChoices()) {
      const option = node("option", choice.name);
      option.value = choice.id; select.append(option);
    }
    if (!error && !loading) { const option = node("option", "+ Create Workspace"); option.value = "__create"; select.append(option); select.disabled = creating; }
    select.value = workspace?.id || "";
    select.title = error ? selectorLabel : workspace?.name || selectorLabel;
    select.setAttribute("aria-label", error ? "Workspace unavailable" : "Active workspace");
    select.setAttribute("aria-disabled", String(select.disabled));
    compact.disabled = select.disabled;
    compact.title = select.title;
    compact.setAttribute("aria-label", error ? "Workspace unavailable" : `Choose workspace: ${workspace?.name || selectorLabel}`);
    compact.setAttribute("aria-disabled", String(compact.disabled));
    syncSidebar();
    heading.textContent = loading ? "Loading workspaces..." : error ? "Workspace unavailable" : "Create your workspace";
    description.textContent = failureKind === "setup-disabled" ? "Workspace setup is not enabled on this environment yet."
      : "Start with an empty portfolio for your organization.";
    status.textContent = error;
    form.hidden = loading || !isAuthenticated() || Boolean(error);
    form.querySelectorAll("input, select, button").forEach((control) => { control.disabled = creating || creationUnverified; });
    submit.textContent = creating ? "Creating..." : "Create Workspace";
    retry.disabled = creating || loading;
    retry.textContent = discovering ? "Reloading..." : "Reload Workspaces";
    demo.disabled = creating || loading || Boolean(error) || !getWorkspaceChoices().some((row) => row.isDemo);
    demoStatus.textContent = failureKind === "setup-disabled" ? "Demo workspace will be available after workspace setup is enabled."
      : error ? "Demo workspace is unavailable until workspace discovery succeeds." : "";
    signIn.hidden = isAuthenticated();
    emptyActions.querySelectorAll("button").forEach((button, index) => { button.disabled = index < 2 && !canWriteWorkspace(); });
    return blocked && route !== "account";
  }
  function modalOpen() {
    return Boolean(document.querySelector("dialog[open], .sf-project-form-overlay, .sf-confirm-overlay"));
  }
  async function activate() {
    const current = ++version;
    error = ""; failureKind = ""; loading = true; render();
    onPrepare();
    try { if (getActiveWorkspace()) await onWorkspace(getActiveWorkspace()); }
    catch (failure) { if (current === version) error = failure.message; }
    finally { if (current === version) { loading = false; render(); } }
    return current === version && !error ? onReady() : false;
  }
  async function reload({ supersede = false } = {}) {
    if (discovering && !supersede) return;
    const current = ++version;
    discovering = true;
    resetWorkspaceSession(); error = ""; failureKind = ""; setup = false; loading = true; creating = false; render(); onPrepare();
    try {
      const result = await loadWorkspaces();
      if (current !== version) return;
      setup = (result.needsSetup && !result.workspace) || (isAuthenticated() && createIntent);
      if (result.workspace && !setup) await onWorkspace(result.workspace);
      creationUnverified = false;
    } catch (failure) { if (current === version) { error = failure.message; failureKind = failure.kind || "request-failed"; } }
    finally { if (current === version) { discovering = false; loading = false; render(); } }
    if (current === version && !error) {
      if (isAuthenticated() && createIntent && showCreateWorkspace()) {
        createIntent = false;
        try { localStorage.removeItem(AUTH_INTENT_KEY); } catch { /* Only an optional navigation hint. */ }
      } else if (getActiveWorkspace()) onReady();
    }
  }
  async function choose(id) {
    if (creating || loading) return;
    if (modalOpen()) { switchStatus.textContent = "Close or resolve the current dialog before switching workspaces."; render(); return; }
    const workspace = selectWorkspace(id); setup = false; switchStatus.textContent = "";
    const resumed = await activate();
    if (getActiveWorkspace() === workspace && !error && !resumed) onPortfolio();
  }
  async function chooseDemo() {
    const choice = getWorkspaceChoices().find((row) => row.isDemo);
    if (choice) await choose(choice.id);
  }
  function showCreateWorkspace() {
    if (!isAuthenticated() || loading || creating || modalOpen()) return false;
    setup = true; error = ""; render("portfolio"); onPortfolio(); inputs.name.focus();
    return true;
  }
  function openAuthentication(event) {
    // Keep the original click from closing the panel after the launcher opens it.
    event.stopPropagation();
    if (document.querySelector(".sf-auth-panel")?.hidden !== false) document.querySelector("[data-auth-launcher]")?.click();
  }
  select.addEventListener("change", (event) => {
    if (select.value === "__create") {
      select.value = getActiveWorkspace()?.id || "";
      if (isAuthenticated()) showCreateWorkspace();
      else {
        createIntent = true;
        try { localStorage.setItem(AUTH_INTENT_KEY, "create-workspace"); } catch { /* Retain intent for this page session. */ }
        openAuthentication(event);
      }
      return;
    }
    choose(select.value).catch((failure) => { error = failure.message; render(); });
  });
  demo.addEventListener("click", chooseDemo);
  signIn.addEventListener("click", openAuthentication);
  retry.addEventListener("click", () => reload());
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (creating || loading || creationUnverified || !form.reportValidity()) return;
    const actor = getCurrentUser()?.id;
    const current = version;
    creating = true; error = ""; render();
    try {
      const workspace = await createWorkspace({ name: inputs.name.value, industry: inputs.industry.value, currency: currency.value });
      if (current !== version || actor !== getCurrentUser()?.id) return;
      setup = false;
      creating = false;
      await activate();
      if (getActiveWorkspace() === workspace) onPortfolio();
    } catch (failure) {
      if (current === version && actor === getCurrentUser()?.id) {
        creationUnverified = true;
        error = `${failure.message} Reload workspaces to check whether creation succeeded before trying again.`;
      }
    } finally { if (current === version) { creating = false; render(); } }
  });
  window.addEventListener("auth:changed", () => reload({ supersede: true }));
  render();
  const ready = reload();
  return { ready, render, reload, syncSidebar };
}
