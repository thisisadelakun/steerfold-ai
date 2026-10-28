// Offline QA only. This module never delegates to native fetch or stores credentials.
export const SUPABASE_URL = "https://fixture.invalid";
export const SUPABASE_PUBLISHABLE_KEY = "offline-publishable-key";
const actorId = "11111111-1111-4111-8111-111111111111";
const demo = { id: "22222222-2222-4222-8222-222222222222", organization_name: "Brisk & Zip",
  industry: "Technology", organization_currency: "CAD", is_demo: true, can_write: false };
export const state = { user: null, pendingEmail: null, rows: [demo], fail: false, hold: false,
  calls: { signup: 0, signin: 0, list: 0, create: 0, blocked: 0 }, requests: [] };
const preferences = new Map();
const waiting = new Set();
let nextId = 3;
const storage = { getItem: (key) => preferences.get(String(key)) ?? null,
  setItem: (key, value) => preferences.set(String(key), String(value)),
  removeItem: (key) => preferences.delete(String(key)), clear: () => preferences.clear(),
  key: (index) => [...preferences.keys()][index] ?? null, get length() { return preferences.size; } };
Object.defineProperty(window, "localStorage", { configurable: true, value: storage });

function changed() { window.dispatchEvent(new CustomEvent("fixture:changed")); }
export function getCurrentUser() { return state.user; }
export function isAuthenticated() { return Boolean(state.user); }
export async function getValidAccessToken() { return state.user ? "offline-workspace-token" : null; }
export async function signUp(email, password, fullName) {
  if (!email || !password || !fullName?.trim()) throw new Error("Complete the signup fields.");
  state.calls.signup++;
  state.pendingEmail = email;
  changed();
  return { user: { id: actorId, email }, session: null, needsEmailVerification: true };
}
export async function signIn(email, password) {
  if (!email || !password) throw new Error("Enter a fixture email and password.");
  state.calls.signin++;
  state.user = { id: actorId, email };
  state.pendingEmail = null;
  changed();
  return { user: state.user, access_token: "offline-workspace-token" };
}
export async function signOut() { state.user = null; changed(); }
export function releaseRequests() { for (const resolve of waiting) resolve(); waiting.clear(); }
export function resetFixture() {
  state.user = null; state.pendingEmail = null; state.rows = [demo]; state.fail = false; state.hold = false;
  state.requests.length = 0;
  for (const key of Object.keys(state.calls)) state.calls[key] = 0;
  preferences.clear(); nextId = 3; releaseRequests(); changed();
  window.dispatchEvent(new CustomEvent("auth:changed"));
}
const response = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json" },
});

// No native fetch reference is retained: every accepted RPC is answered in memory.
window.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, location.href);
  if (url.origin !== SUPABASE_URL || !["/rest/v1/rpc/list_my_workspaces", "/rest/v1/rpc/create_workspace"].includes(url.pathname)
    || options.method !== "POST" || url.search || url.hash) {
    state.calls.blocked++; changed();
    throw new TypeError(`Offline fixture blocked fetch: ${url.origin}${url.pathname}`);
  }
  const actor = state.user?.id;
  state.requests.push({ path: url.pathname, actor: actor ?? null });
  const creating = url.pathname.endsWith("/create_workspace");
  state.calls[creating ? "create" : "list"]++;
  changed();
  if (state.hold) await new Promise((resolve) => {
    waiting.add(resolve);
    options.signal?.addEventListener("abort", () => { waiting.delete(resolve); resolve(); }, { once: true });
  });
  if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (state.fail) return response({ message: "Synthetic backend unavailable" }, 503);
  if (creating) {
    if (!actor || actor !== state.user?.id || options.headers?.Authorization !== "Bearer offline-workspace-token") return response({}, 401);
    const body = JSON.parse(options.body);
    if (!body.p_name?.trim() || !["CAD", "USD", "GBP", "EUR"].includes(body.p_currency)) return response({}, 400);
    const workspace = { id: `${String(nextId++).padStart(8, "0")}-3333-4333-8333-333333333333`,
      organization_name: body.p_name, industry: body.p_industry, organization_currency: body.p_currency,
      is_demo: false, can_write: true, owner: actor };
    state.rows.push(workspace); changed();
    return response(workspace);
  }
  return response(state.rows.filter((row) => row.is_demo || row.owner === actor));
};
