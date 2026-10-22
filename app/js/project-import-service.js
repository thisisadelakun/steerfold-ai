import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";
import { getValidAccessToken } from "./auth-service.js";
import { normalizeImportAnalysis } from "./import-conflict-review.js";
import { normalizeProjectImportResult } from "./import-commit-state.js";

export class ImportRequestError extends Error {
  constructor(message, { uncertain = false, requiresReview = false, code = null } = {}) {
    super(message);
    this.uncertain = uncertain;
    this.requiresReview = requiresReview;
    this.code = code;
  }
}

async function importRpc(name, args, { write = false } = {}) {
  let token;
  try { token = await getValidAccessToken(); }
  catch { throw new ImportRequestError("Your session could not be refreshed. Sign in again with the same account."); }
  if (!token) throw new ImportRequestError("Sign in with the account that started this import.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args), signal: controller.signal,
    });
    let body;
    try { body = await response.json(); } catch { /* An unreadable write response has an uncertain outcome. */ }
    if (!response.ok) {
      const code = typeof body?.code === "string" ? body.code : null;
      const options = { code };
      if ([401, 403].includes(response.status) || code === "42501") {
        throw new ImportRequestError("Your session is unavailable or not permitted. Sign in again with the same account.", options);
      }
      if (code === "23514") throw new ImportRequestError("Import was blocked by validation or changed conflicts. Run Review Conflicts again; no projects were imported by this request.", { ...options, requiresReview: true });
      if (code === "23505") throw new ImportRequestError("This import key conflicts with an existing result. Recover the original result; do not start another import.", { ...options, uncertain: write });
      if (["55P03", "57014", "40P01", "40001"].includes(code)) throw new ImportRequestError("The database could not acquire a lock or complete the transaction. Review conflicts again before retrying.", { ...options, requiresReview: true });
      if (["22023", "54000", "25000"].includes(code)) throw new ImportRequestError("The server rejected this import request. Review the staged values and current conflicts before retrying.", { ...options, requiresReview: true });
      throw new ImportRequestError(write ? "The import outcome could not be confirmed. Recover the result before starting another import."
        : "The stored import result could not be retrieved. Retry recovery with the same key.", { ...options, uncertain: write });
    }
    if (!body) throw new ImportRequestError("The server returned an unreadable import result. Recover it using the same key.", { uncertain: write });
    return body;
  } catch (error) {
    if (error instanceof ImportRequestError) throw error;
    throw new ImportRequestError(controller.signal.aborted ? "The import service timed out. Recover the result using the same import key."
      : "The connection was interrupted. Recover the import result using the same key.", { uncertain: write });
  } finally { clearTimeout(timeout); }
}

export async function commitProjectImport({ idempotencyKey, payload, acknowledgements }) {
  const value = await importRpc("commit_project_import", {
    p_idempotency_key: idempotencyKey, p_payload: payload, p_acknowledgements: acknowledgements,
  }, { write: true });
  try { return normalizeProjectImportResult(value, { idempotencyKey, payload }); }
  catch (error) { throw new ImportRequestError(error.message, { uncertain: true }); }
}

export async function getProjectImportResult(idempotencyKey) {
  const value = await importRpc("get_project_import_result", { p_idempotency_key: idempotencyKey });
  return normalizeProjectImportResult(value, { idempotencyKey, allowNotFound: true });
}

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
