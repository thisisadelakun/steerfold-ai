import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";
import { getValidAccessToken } from "./auth-service.js";
import { acceptOrganizationSettings, organizationSettingsUnavailable, validateOrganizationCurrency } from "./organization-currency.js";
import { getActiveWorkspace, workspaceHeaders, assertWorkspaceCurrent, requireWritableWorkspace } from "./workspace-context.js";

let pendingRead;
async function settingsRequest(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  catch { throw new Error("Organization settings could not be reached. Reload Settings to verify the current currency before saving again."); }
  finally { clearTimeout(timeout); }
}

async function readResponse(response, expectedCurrency, workspace) {
  if (!response.ok) {
    if ([401, 403].includes(response.status)) throw new Error("Governance Admin access is required to change organization currency.");
    if (response.status === 409) throw new Error("Organization currency changed elsewhere. Reload Settings before saving again.");
    throw new Error("Organization settings are unavailable. No currency change was confirmed; reload Settings to verify the current value.");
  }
  const row = await response.json();
  if (workspace) assertWorkspaceCurrent(workspace);
  if (expectedCurrency && row?.organization_currency !== expectedCurrency) {
    throw new Error("The currency change response could not be verified. Reload Settings to check the authoritative value.");
  }
  return acceptOrganizationSettings(row);
}

export function loadOrganizationSettings() {
  const workspace = getActiveWorkspace();
  if (!workspace) return Promise.reject(new Error("Choose a workspace to view organization settings."));
  if (pendingRead?.workspace === workspace) return pendingRead.promise;
  const promise = (async () => {
    try {
      const headers = { apikey: SUPABASE_PUBLISHABLE_KEY, ...workspaceHeaders() };
      const token = await getValidAccessToken();
      assertWorkspaceCurrent(workspace);
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await settingsRequest(`${SUPABASE_URL}/rest/v1/organization_settings?id=eq.true&select=id,organization_currency,updated_at`, {
        headers,
      });
      assertWorkspaceCurrent(workspace);
      if (!response.ok) return await readResponse(response, undefined, workspace);
      const rows = await response.json();
      assertWorkspaceCurrent(workspace);
      if (!Array.isArray(rows) || rows.length !== 1) throw new Error("Exactly one organization settings row is required.");
      return acceptOrganizationSettings(rows[0]);
    } catch (error) { if (getActiveWorkspace() === workspace) organizationSettingsUnavailable(error); throw error; }
    finally { if (pendingRead?.workspace === workspace) pendingRead = null; }
  })();
  pendingRead = { workspace, promise };
  return promise;
}

export async function updateOrganizationCurrency(currency, { confirmed = false, expectedCurrency } = {}) {
  const workspace = requireWritableWorkspace();
  validateOrganizationCurrency(currency);
  validateOrganizationCurrency(expectedCurrency);
  if (currency !== expectedCurrency && confirmed !== true) throw new Error("Explicit confirmation is required to change organization currency.");
  const token = await getValidAccessToken();
  assertWorkspaceCurrent(workspace);
  if (!token) throw new Error("Sign in as a Governance Admin to change organization currency.");
  try {
    const response = await settingsRequest(`${SUPABASE_URL}/rest/v1/rpc/set_organization_currency`, {
      method: "POST",
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...workspaceHeaders() },
      body: JSON.stringify({ p_currency: currency, p_expected_currency: expectedCurrency, p_confirm: confirmed === true }),
    });
    assertWorkspaceCurrent(workspace);
    return await readResponse(response, currency, workspace);
  } catch (error) { if (getActiveWorkspace() === workspace) organizationSettingsUnavailable(error); throw error; }
}
