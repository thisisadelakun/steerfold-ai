// Offline browser QA only. Synthetic rates are not live reference rates.
import { acceptOrganizationSettings } from "../../app/js/organization-currency.js";
import { setActiveWorkspace } from "../../app/js/workspace-context.js";
export { workspaceHeaders, getActiveWorkspace, assertWorkspaceCurrent, getWorkspaceRevision,
  canWriteWorkspace, requireWritableWorkspace, isDemoWorkspace } from "../../app/js/workspace-context.js";
setActiveWorkspace({ id: "11111111-1111-4111-8111-111111111111", name: "Brisk & Zip", industry: "", currency: "CAD", isDemo: false, canWrite: true });
let currency = "CAD";
let fxCalls = 0;
export function showCounts() {
  document.querySelector("#fixture-counts").textContent = `Offline FX requests: ${fxCalls}. No Supabase requests or imports.`;
}
export async function loadOrganizationSettings() {
  return acceptOrganizationSettings({ id: true, organization_currency: currency, updated_at: new Date().toISOString() });
}
export async function updateOrganizationCurrency(value, { confirmed, expectedCurrency }) {
  if ((value !== currency && confirmed !== true) || expectedCurrency !== currency) throw new Error("Explicit confirmation and the current currency are required.");
  currency = value;
  return loadOrganizationSettings();
}
export async function loadFxRate(base, quote) {
  fxCalls += 1; showCounts();
  if (document.querySelector("#fixture-fail-fx").checked) return { status: "unavailable", base, quote, rate: null, error: "Offline simulated FX failure." };
  return { status: "ready", base, quote, rate: 0.8, provider: "Frankfurter", rateDate: new Date().toISOString().slice(0, 10), fetchedAt: new Date().toISOString() };
}
