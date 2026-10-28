// Offline QA only: synthetic identities and local fixture storage, never Supabase.
import { setActiveWorkspace } from "../../app/js/workspace-context.js";
export { workspaceHeaders, getActiveWorkspace, assertWorkspaceCurrent, getWorkspaceRevision,
  canWriteWorkspace, requireWritableWorkspace, isDemoWorkspace } from "../../app/js/workspace-context.js";
const workspace = { id: "11111111-1111-4111-8111-111111111111", name: "Brisk & Zip", industry: "", currency: "CAD", isDemo: false, canWrite: true };
setActiveWorkspace(workspace);
const key = "steerfold-account-settings-offline-fixture-v2";
export const state = JSON.parse(localStorage.getItem(key) || "null") || {
  signedIn: true, admin: false, company: { id: true, organization_name: "Brisk & Zip", industry: "", organization_currency: "CAD", updated_at: "2026-10-26T00:00:00.000Z" },
  profile: { user_id: "11111111-1111-4111-8111-111111111111", full_name: "", job_title: "", created_at: null, updated_at: null },
};
export const counts = { profileWrites: 0, organizationWrites: 0, securityRequests: 0 };
function persist() { localStorage.setItem(key, JSON.stringify(state)); }
export function isAuthenticated() { return state.signedIn; }
export function getCurrentUser() { return state.signedIn ? { id: state.profile.user_id, email: "taylor@example.invalid" } : null; }
export async function getValidAccessToken() { return state.signedIn ? "offline-fixture-token" : null; }
export async function signOut() { state.signedIn = false; setActiveWorkspace(null); persist(); }
export async function signIn() { state.signedIn = true; setActiveWorkspace(workspace); persist(); }
export async function getMyGovernanceRoles() { return state.signedIn && state.admin ? [{ role: "governance_admin" }] : []; }
export function authenticate(value) { state.signedIn = value; setActiveWorkspace(value ? workspace : null); persist(); window.dispatchEvent(new CustomEvent("auth:changed")); }
export function setAdmin(value) { state.admin = value; persist(); window.dispatchEvent(new CustomEvent("auth:changed")); }
export function installOfflineBackend() {
  window.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname;
    const body = options.body && JSON.parse(options.body);
    const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    if (path === "/rest/v1/organization_settings") {
      if (options.headers?.["x-steerfold-organization-id"] !== workspace.id) return response({}, 403);
      if (options.headers?.Authorization !== "Bearer offline-fixture-token" || !state.signedIn) return response({}, 401);
      return response([state.company]);
    }
    if (options.headers?.Authorization !== "Bearer offline-fixture-token" || !state.signedIn) return response({}, 401);
    if (["/rest/v1/rpc/save_organization_profile", "/rest/v1/rpc/set_organization_currency"].includes(path)
      && options.headers?.["x-steerfold-organization-id"] !== workspace.id) return response({}, 403);
    if (["/rest/v1/rpc/get_my_profile", "/rest/v1/rpc/save_my_profile"].includes(path)
      && options.headers?.["x-steerfold-organization-id"] !== undefined) return response({}, 400);
    if (document.querySelector("#fixture-failure").checked) throw new TypeError("Offline fixture failure");
    if (path.endsWith("/get_my_profile")) return response(state.profile);
    if (path.endsWith("/save_my_profile")) {
      counts.profileWrites++;
      if (body.p_expected_updated_at !== state.profile.updated_at) return response({}, 409);
      state.profile.created_at ??= new Date().toISOString();
      Object.assign(state.profile, { full_name: body.p_full_name, job_title: body.p_job_title, updated_at: new Date().toISOString() });
      persist(); return response(state.profile);
    }
    if (path.endsWith("/save_organization_profile")) {
      if (!state.admin) return response({}, 403);
      counts.organizationWrites++;
      if (body.p_expected_updated_at !== state.company.updated_at) return response({}, 409);
      Object.assign(state.company, { organization_name: body.p_name, industry: body.p_industry, updated_at: new Date().toISOString() });
      persist(); return response(state.company);
    }
    if (path.endsWith("/set_organization_currency")) {
      if (!state.admin) return response({}, 403);
      if (body.p_expected_currency !== state.company.organization_currency) return response({}, 409);
      if (!["CAD", "USD", "GBP", "EUR"].includes(body.p_currency)) return response({}, 400);
      if (body.p_currency !== state.company.organization_currency && body.p_confirm !== true) return response({}, 400);
      Object.assign(state.company, { organization_currency: body.p_currency, updated_at: new Date().toISOString() });
      persist();
      return response(state.company);
    }
    if (path.startsWith("/auth/v1/")) {
      counts.securityRequests++; return response({ id: state.profile.user_id });
    }
    throw new Error(`No network allowed in the offline fixture: ${path}`);
  };
}
