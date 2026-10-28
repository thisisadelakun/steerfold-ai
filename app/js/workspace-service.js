import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";
import { getCurrentUser, getValidAccessToken } from "./auth-service.js";
import { getActiveWorkspace, setActiveWorkspace } from "./workspace-context.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURRENCIES = ["CAD", "USD", "GBP", "EUR"];
let generation = 0;
let choices = [];

function normalize(row) {
  if (!UUID.test(row?.id) || typeof row.organization_name !== "string" || !row.organization_name.trim()
    || typeof row.industry !== "string" || !CURRENCIES.includes(row.organization_currency)
    || typeof row.is_demo !== "boolean" || typeof row.can_write !== "boolean") {
    throw new Error("Workspace response could not be verified.");
  }
  return { id: row.id, name: row.organization_name, industry: row.industry,
    currency: row.organization_currency, isDemo: row.is_demo, canWrite: row.can_write };
}
function preferenceKey() { return `steerfold-workspace:${getCurrentUser()?.id || "public"}`; }
function remember(workspace) {
  try { localStorage.setItem(preferenceKey(), workspace.id); } catch { /* Preference is optional, never authority. */ }
}
class WorkspaceServiceError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}
async function rpc(name, body, { authenticated = false } = {}) {
  const actor = getCurrentUser()?.id;
  let token;
  try { token = await getValidAccessToken(); }
  catch {
    throw new WorkspaceServiceError("auth-unavailable", "Your authentication session could not be verified. Sign in again or retry.");
  }
  if (actor !== getCurrentUser()?.id || (authenticated && (!actor || !token))) {
    throw new WorkspaceServiceError("auth-unavailable", "Sign in again before managing your workspace.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: "POST", headers: { apikey: SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body), signal: controller.signal,
    });
    if (!response.ok) {
      let details = null;
      try { details = await response.json(); } catch { /* Error bodies may be empty. */ }
      if (response.status === 404 && details?.code === "PGRST202") {
        throw new WorkspaceServiceError("setup-disabled", "Workspace setup is not enabled on this environment yet.");
      }
      if (response.status === 401) {
        throw new WorkspaceServiceError("auth-unavailable", "Your authentication session could not be verified. Sign in again or retry.");
      }
      throw new WorkspaceServiceError("request-failed", "Workspace service is not available yet. Reload Workspaces to retry.");
    }
    const value = await response.json();
    if (actor !== getCurrentUser()?.id) throw new Error("Your account changed. Reload your workspaces.");
    return value;
  } catch (failure) {
    if (failure instanceof WorkspaceServiceError) throw failure;
    if (failure instanceof TypeError || failure.name === "AbortError") {
      throw new WorkspaceServiceError("supabase-unavailable", "Cannot reach Supabase. Authentication and workspace availability could not be verified. Check your connection and retry.");
    }
    throw failure;
  } finally { clearTimeout(timeout); }
}
export function getWorkspaceChoices() { return [...choices]; }
export function resetWorkspaceSession() {
  generation++;
  choices = [];
  setActiveWorkspace(null);
}
export async function loadWorkspaces() {
  const current = ++generation;
  const actor = getCurrentUser()?.id;
  setActiveWorkspace(null);
  choices = [];
  const rows = await rpc("list_my_workspaces", {});
  if (current !== generation || actor !== getCurrentUser()?.id) throw new Error("Workspace session changed.");
  if (!Array.isArray(rows)) throw new Error("Workspace list could not be verified.");
  const normalized = rows.map(normalize);
  if (new Set(normalized.map((row) => row.id)).size !== normalized.length) throw new Error("Duplicate workspace response.");
  // Discovery is authoritative; signed-out clients never display private rows.
  choices = actor ? normalized : normalized.filter((row) => row.isDemo && !row.canWrite);
  let preferred;
  try { preferred = localStorage.getItem(preferenceKey()); } catch { /* Optional preference. */ }
  // A first-time authenticated user never inherits the public/demo selection.
  const workspace = choices.find((row) => row.id === preferred)
    || choices.find((row) => actor ? !row.isDemo : row.isDemo) || null;
  setActiveWorkspace(workspace);
  return { workspace: getActiveWorkspace(), choices: getWorkspaceChoices(), needsSetup: Boolean(actor && !choices.some((row) => !row.isDemo)) };
}
export function selectWorkspace(id) {
  const workspace = choices.find((row) => row.id === id);
  if (!workspace) throw new Error("Workspace is not available to this account.");
  setActiveWorkspace(workspace);
  remember(workspace);
  return getActiveWorkspace();
}
export async function createWorkspace({ name, industry = "", currency }) {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 120
    || typeof industry !== "string" || industry.trim().length > 120 || !CURRENCIES.includes(currency)) {
    throw new Error("Enter an organization name and explicitly choose CAD, USD, GBP or EUR.");
  }
  const current = generation;
  const row = normalize(await rpc("create_workspace", { p_name: name.trim(), p_industry: industry.trim(), p_currency: currency }, { authenticated: true }));
  if (current !== generation) throw new Error("Workspace session changed. Reload to verify creation.");
  if (row.isDemo || !row.canWrite) throw new Error("New workspace could not be verified. Reload before trying again.");
  choices = [...choices.filter((value) => value.id !== row.id), row];
  setActiveWorkspace(row);
  remember(row);
  return getActiveWorkspace();
}
