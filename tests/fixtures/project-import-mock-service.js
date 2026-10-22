// Browser-only offline fixture. This module never imports the real auth or RPC transport.
const actor = "11111111-1111-4111-8111-111111111111";
const hash = "a".repeat(64);
const stored = new Map();
const attempts = new Map();
let commits = 0;
let recoveries = 0;
let refreshes = 0;
const mode = () => document.getElementById("mock-outcome").value;
const delay = () => new Promise((resolve) => setTimeout(resolve, 400));

export function renderCounters() {
  document.getElementById("mock-counters").textContent = `Mock commits: ${commits}; recoveries: ${recoveries}; refreshes: ${refreshes}`;
}

export async function checkProjectImport(payload) {
  await delay();
  const blocking = mode() === "blocking" ? [{ code: "source_id_already_imported", source_row: payload.rows[0].source_row }] : [];
  const warnings = mode() === "no-warnings" ? [] : payload.rows.map((row, index) => ({
    code: "name_match", source_row: row.source_row, conflict_id: (index + 1).toString(16).padStart(64, "0"),
    existing_project_id: `MOCK-EXISTING-${index + 1}`, existing_project_name: row.project.project_name,
    existing_project_manager: row.project.project_manager, existing_start_date: row.project.start_date,
  }));
  return { contract_version: 1, payload_hash: hash, rows_submitted: payload.rows.length,
    blocking_count: blocking.length, warning_count: warnings.length, blocking_conflicts: blocking, warnings,
    ready_for_confirmation: !blocking.length, requires_acknowledgement: !!warnings.length };
}

export async function commitProjectImport(snapshot) {
  commits += 1; renderCounters(); await delay();
  const count = (attempts.get(snapshot.idempotencyKey) || 0) + 1;
  attempts.set(snapshot.idempotencyKey, count);
  if (mode() === "validation") throw Object.assign(new Error("Mock conflict changed. Run Review Conflicts again."), { requiresReview: true });
  if (mode() === "uncertain-not-found" && count === 1) throw Object.assign(new Error("Mock connection interrupted."), { uncertain: true });
  if (stored.has(snapshot.idempotencyKey)) return { ...stored.get(snapshot.idempotencyKey), replayed: true };
  const result = {
    contract_version: 1, status: "committed", replayed: false, import_id: crypto.randomUUID(),
    idempotency_key: snapshot.idempotencyKey, payload_hash: hash, imported_by: actor,
    committed_at: new Date().toISOString(), source_namespace: snapshot.payload.source_namespace?.trim().toLowerCase() || null,
    currency_code: "CAD", rows_submitted: snapshot.payload.rows.length, rows_imported: snapshot.payload.rows.length,
    rows_skipped: 0, rows_failed: 0,
    rows: snapshot.payload.rows.map((row, index) => ({ source_row: row.source_row, source_project_id: row.source_project_id,
      project_uuid: crypto.randomUUID(), project_id: `MOCK-NEW-${index + 1}`, project_name: row.project.project_name })),
  };
  stored.set(snapshot.idempotencyKey, result);
  if (mode() === "uncertain-committed") throw Object.assign(new Error("Mock response lost."), { uncertain: true });
  return result;
}

export async function getProjectImportResult(key) {
  recoveries += 1; renderCounters(); await delay();
  return stored.has(key) ? { ...stored.get(key), replayed: true }
    : { contract_version: 1, status: "not_found", idempotency_key: key };
}

export async function refresh() {
  refreshes += 1; renderCounters(); await delay();
  if (mode() === "refresh-failure") throw new Error("Mock Supabase refresh failed.");
}
