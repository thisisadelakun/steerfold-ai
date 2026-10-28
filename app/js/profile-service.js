import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";
import { getCurrentUser, getValidAccessToken } from "./auth-service.js";
import { getActiveWorkspace, workspaceHeaders, assertWorkspaceCurrent, requireWritableWorkspace } from "./workspace-context.js";

function validateText(value, required) {
  if (typeof value !== "string" || value.trim().length > 120 || (required && !value.trim())) {
    throw new Error("Complete the required name and use at most 120 characters per field.");
  }
  return value.trim();
}

async function request(path, body, authenticated = false, scoped = false) {
  const workspace = scoped ? getActiveWorkspace() : null;
  const headers = { apikey: SUPABASE_PUBLISHABLE_KEY };
  if (scoped) Object.assign(headers, workspaceHeaders());
  if (authenticated || scoped) {
    const actor = getCurrentUser()?.id;
    const token = await getValidAccessToken();
    if (authenticated && !token) throw new Error("Sign in before managing your profile.");
    if (actor !== getCurrentUser()?.id) throw new Error("Your account changed. Reload your profile before saving.");
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  if (scoped) assertWorkspaceCurrent(workspace);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method: body === undefined ? "GET" : "POST", headers, signal: controller.signal,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      if (response.status === 401) throw new Error("Your session could not be verified. Sign in again.");
      if (response.status === 403) throw new Error("You do not have permission to save these details.");
      if (response.status === 409) throw new Error("These details changed elsewhere. Reload before saving.");
      throw new Error("Profile storage is unavailable. Reload to verify before saving again.");
    }
    const result = await response.json();
    if (scoped) assertWorkspaceCurrent(workspace);
    return result;
  } catch (error) {
    if (error.name === "AbortError" || error instanceof TypeError) {
      throw new Error("Profile storage could not be reached. Reload to verify whether any changes were saved.");
    }
    throw error;
  } finally { clearTimeout(timeout); }
}

function organization(row) {
  if (row?.id !== true || typeof row.organization_name !== "string" || !row.organization_name.trim()
    || typeof row.industry !== "string" || !Number.isFinite(Date.parse(row.updated_at))) {
    throw new Error("Organization profile could not be verified. Reload before saving.");
  }
  return { name: row.organization_name, industry: row.industry, updatedAt: row.updated_at };
}

function personal(row, actor) {
  if (row?.user_id !== actor || typeof row.full_name !== "string" || typeof row.job_title !== "string"
    || (row.updated_at !== null && !Number.isFinite(Date.parse(row.updated_at)))
    || (row.created_at !== null && !Number.isFinite(Date.parse(row.created_at)))
    || ((row.created_at === null) !== (row.updated_at === null))) {
    throw new Error("Your profile could not be verified. Reload before saving.");
  }
  return { fullName: row.full_name, jobTitle: row.job_title, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function loadOrganizationProfile() {
  const rows = await request("organization_settings?id=eq.true&select=id,organization_name,industry,updated_at", undefined, false, true);
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error("Organization profile is unavailable.");
  return organization(rows[0]);
}

export async function saveOrganizationProfile({ name, industry, updatedAt }) {
  requireWritableWorkspace();
  const expectedName = validateText(name, true);
  const expectedIndustry = validateText(industry, false);
  const saved = organization(await request("rpc/save_organization_profile", {
    p_name: expectedName, p_industry: expectedIndustry, p_expected_updated_at: updatedAt,
  }, true, true));
  if (saved.name !== expectedName || saved.industry !== expectedIndustry) throw new Error("Saved organization details could not be verified. Reload before saving again.");
  return saved;
}

export async function loadPersonalProfile() {
  const actor = getCurrentUser()?.id;
  if (!actor) throw new Error("Sign in to manage your profile.");
  return personal(await request("rpc/get_my_profile", {}, true), actor);
}

export async function savePersonalProfile({ fullName, jobTitle, updatedAt }) {
  const actor = getCurrentUser()?.id;
  if (!actor) throw new Error("Sign in to manage your profile.");
  const expectedName = validateText(fullName, true);
  const expectedTitle = validateText(jobTitle, false);
  const saved = personal(await request("rpc/save_my_profile", {
    p_full_name: expectedName, p_job_title: expectedTitle, p_expected_updated_at: updatedAt,
  }, true), actor);
  if (saved.fullName !== expectedName || saved.jobTitle !== expectedTitle) throw new Error("Saved personal details could not be verified. Reload before saving again.");
  return saved;
}
