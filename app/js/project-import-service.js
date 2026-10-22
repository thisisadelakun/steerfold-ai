import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";
import { getValidAccessToken } from "./auth-service.js";
import { normalizeImportAnalysis } from "./import-conflict-review.js";

export async function checkProjectImport(payload) {
  let token;
  try { token = await getValidAccessToken(); }
  catch { throw new Error("Your session could not be refreshed. Sign in again to review conflicts."); }
  if (!token) throw new Error("Sign in to review import conflicts.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_project_import`, {
      method: "POST",
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_payload: payload }),
      signal: controller.signal,
    });
    let body;
    try { body = await response.json(); }
    catch { throw new Error("The conflict service returned an unreadable response. No review was completed."); }
    if (!response.ok) {
      if ([401, 403].includes(response.status) || body?.code === "42501") {
        throw new Error("Your session is unavailable or not permitted to review imports. Sign in again.");
      }
      if (body?.code === "54000") throw new Error("Too many duplicate warnings. Select a smaller batch and review again.");
      if (["22023", "23514"].includes(body?.code)) throw new Error("The server rejected the staged data. Review the mappings, required fields and values before checking again.");
      throw new Error("The server could not complete conflict review. Your staged data has not been imported.");
    }
    return normalizeImportAnalysis(body, payload);
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Conflict review timed out. Run Review Conflicts again.");
    if (error instanceof TypeError) throw new Error("Unable to reach the conflict service. Check your connection and review again.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
