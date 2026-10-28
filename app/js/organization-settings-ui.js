import { getOrganizationCurrencyState, subscribeOrganizationCurrency } from "./organization-currency.js";
import { loadOrganizationSettings, updateOrganizationCurrency } from "./organization-settings-service.js";
import { getCurrentUser, isAuthenticated } from "./auth-service.js";
import { getMyGovernanceRoles } from "./governance-role-service.js";
import { createUtilityDialog } from "./utility-dialog.js";
import { canWriteWorkspace, isDemoWorkspace } from "./workspace-context.js";

export function initOrganizationCurrencySettings({ onAdminChange = () => {} } = {}) {
  const select = document.querySelector("[data-organization-currency-select]");
  const save = document.querySelector("[data-organization-currency-save]");
  const status = document.querySelector("[data-organization-currency-status]");
  let admin = false;
  let busy = false;
  let version = 0;
  let message = "";
  let confirmation = null;
  function render() {
    const state = getOrganizationCurrencyState();
    select.disabled = busy || !admin || isDemoWorkspace() || state.status !== "ready";
    save.disabled = busy || !admin || state.status !== "ready";
    status.textContent = message || (state.status === "loading" ? "Loading organization currency..."
      : state.status !== "ready" ? "Organization currency is unverified. Settings and new imports are unavailable. Reload Settings to retry."
        : isDemoWorkspace() ? `Demo workspace currency is fixed to ${state.currency}.`
        : admin ? "Changing organization currency requires explicit acknowledgement. Existing numeric amounts are not converted."
          : "Only a Governance Admin can change organization currency.");
  }
  async function loadRoles() {
    const current = ++version;
    admin = false;
    message = "";
    if (confirmation && !busy) confirmation.dialog.close();
    onAdminChange(false);
    render();
    if (!isAuthenticated()) return;
    try {
      const roles = await getMyGovernanceRoles();
      if (current === version) admin = canWriteWorkspace() && roles.some((item) => item.role === "governance_admin");
    } catch { /* Missing roles never grant settings authority. */ }
    if (current === version) onAdminChange(admin);
    render();
  }
  subscribeOrganizationCurrency((state) => {
    select.value = state.currency;
    if (confirmation && !busy) confirmation.dialog.close();
    render();
  });
  select.addEventListener("change", () => { message = ""; render(); });
  save.addEventListener("click", async () => {
    if (save.disabled || busy || confirmation) return;
    const actor = getCurrentUser()?.id;
    const current = version;
    const expectedCurrency = getOrganizationCurrencyState().currency;
    const currency = select.value;
    if (isDemoWorkspace() && currency !== expectedCurrency) return;
    const eligible = () => current === version && admin && isAuthenticated()
      && actor === getCurrentUser()?.id && getOrganizationCurrencyState().status === "ready"
      && getOrganizationCurrencyState().currency === expectedCurrency;
    async function persist(confirmed) {
      if (busy || !eligible()) return;
      busy = true; message = "Saving organization currency..."; render();
      if (confirmation) confirmation.dialog.querySelectorAll("button, input").forEach((control) => { control.disabled = true; });
      try {
        await updateOrganizationCurrency(currency, { expectedCurrency, confirmed });
        if (current === version && actor === getCurrentUser()?.id) {
          message = `Organization currency is ${currency}. Existing numeric amounts were not converted.`;
        }
        return true;
      } catch (error) {
        if (current === version) message = error.message;
        return false;
      } finally { busy = false; render(); }
    }
    if (currency === expectedCurrency) { await persist(false); return; }
    const modal = createUtilityDialog("Change Organization Currency", "sf-organization-currency-confirm");
    if (!modal) return;
    confirmation = modal;
    const context = document.createElement("p");
    context.className = "sf-utility-intro";
    context.textContent = `Organization currency: ${expectedCurrency} to ${currency}.`;
    const warning = document.createElement("p");
    warning.className = "sf-utility-intro";
    warning.textContent = "Changing organization currency does not convert existing project financial amounts. Existing numeric values will be interpreted using the newly selected currency.";
    const label = document.createElement("label");
    label.className = "sf-organization-currency-acknowledgement";
    const acknowledge = document.createElement("input");
    acknowledge.type = "checkbox";
    const labelText = document.createElement("span");
    labelText.textContent = "I understand and acknowledge this currency interpretation change.";
    label.append(acknowledge, labelText);
    const error = document.createElement("p");
    error.className = "sf-utility-error";
    error.setAttribute("role", "alert");
    const cancel = document.createElement("button");
    cancel.type = "button"; cancel.className = "sf-utility-secondary"; cancel.textContent = "Cancel";
    const confirm = document.createElement("button");
    confirm.type = "button"; confirm.className = "sf-utility-primary"; confirm.textContent = "Confirm Currency Change"; confirm.disabled = true;
    const syncConfirmation = () => { confirm.disabled = busy || !acknowledge.checked || !eligible(); };
    acknowledge.addEventListener("change", syncConfirmation);
    cancel.addEventListener("click", () => { if (!busy) modal.dialog.close(); });
    modal.dialog.addEventListener("cancel", (event) => { if (busy) event.preventDefault(); });
    modal.dialog.addEventListener("close", () => {
      if (confirmation === modal) confirmation = null;
      render();
      if (document.activeElement === document.body && !select.disabled) select.focus();
    }, { once: true });
    confirm.addEventListener("click", async () => {
      if (confirm.disabled || !acknowledge.checked || !eligible()) return;
      const saved = await persist(true);
      if (saved || current !== version || actor !== getCurrentUser()?.id) { modal.dialog.close(); return; }
      error.textContent = message;
      modal.dialog.querySelectorAll("button, input").forEach((control) => { control.disabled = false; });
      syncConfirmation();
    });
    const actions = document.createElement("div");
    actions.className = "sf-confirm-actions"; actions.append(cancel, confirm);
    modal.dialog.append(context, warning, label, error, actions);
    modal.open(); cancel.focus();
  });
  const reload = document.querySelector("[data-organization-currency-reload]");
  reload.addEventListener("click", async () => {
    if (busy) return;
    reload.disabled = true; message = "";
    try { await loadOrganizationSettings(); } catch { /* State displays the failure. */ }
    finally { reload.disabled = false; render(); }
  });
  window.addEventListener("auth:changed", loadRoles);
  window.addEventListener("workspace:changed", () => {
    loadRoles();
    loadOrganizationSettings().catch(() => null);
  });
  select.value = getOrganizationCurrencyState().currency;
  loadRoles();
  return { ready: loadOrganizationSettings().catch(() => null) };
}
