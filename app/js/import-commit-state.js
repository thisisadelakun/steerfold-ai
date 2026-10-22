const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const validText = (value) => typeof value === "string" && value.trim().length > 0 && value.length <= 1000;

export function normalizeProjectImportResult(value, {
  idempotencyKey, payloadHash, payload, actorId, allowNotFound = false,
}) {
  const invalid = () => { throw new Error("The import result could not be verified. Recover the result using the same import key; do not start another import."); };
  if (!value || value.contract_version !== 1 || !UUID.test(value.idempotency_key)
    || value.idempotency_key !== idempotencyKey) invalid();
  if (value.status === "not_found" && allowNotFound) {
    return { contract_version: 1, status: "not_found", idempotency_key: value.idempotency_key };
  }
  if (value.status !== "committed" || typeof value.replayed !== "boolean"
    || !UUID.test(value.import_id) || !UUID.test(value.imported_by) || !HASH.test(value.payload_hash)
    || (payloadHash && value.payload_hash !== payloadHash) || (actorId && value.imported_by !== actorId)
    || typeof value.committed_at !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value.committed_at)
    || !Number.isFinite(Date.parse(value.committed_at)) || value.currency_code !== "CAD"
    || !(value.source_namespace === null || validText(value.source_namespace))
    || !Number.isSafeInteger(value.rows_submitted) || value.rows_submitted < 1 || value.rows_submitted > 5000
    || value.rows_imported !== value.rows_submitted || value.rows_skipped !== 0 || value.rows_failed !== 0
    || !Array.isArray(value.rows) || value.rows.length !== value.rows_imported) invalid();
  if (payload && (value.rows_submitted !== payload.rows.length
    || value.source_namespace !== (payload.source_namespace?.trim().toLowerCase() || null))) invalid();
  const incoming = payload && new Map(payload.rows.map((row) => [row.source_row, row]));
  const sourceRows = new Set();
  const projectIds = new Set();
  const projectUuids = new Set();
  const rows = value.rows.map((row) => {
    if (!row || !Number.isSafeInteger(row.source_row) || row.source_row < 1 || sourceRows.has(row.source_row)
      || !(row.source_project_id === null || validText(row.source_project_id)) || !UUID.test(row.project_uuid)
      || projectUuids.has(row.project_uuid) || !validText(row.project_id) || projectIds.has(row.project_id)
      || !validText(row.project_name)) invalid();
    const original = incoming?.get(row.source_row);
    if (incoming && (!original || original.source_project_id !== row.source_project_id
      || original.project.project_name.trim() !== row.project_name)) invalid();
    sourceRows.add(row.source_row); projectIds.add(row.project_id); projectUuids.add(row.project_uuid);
    return { source_row: row.source_row, source_project_id: row.source_project_id,
      project_uuid: row.project_uuid, project_id: row.project_id, project_name: row.project_name };
  });
  return {
    contract_version: 1, status: "committed", replayed: value.replayed, import_id: value.import_id,
    idempotency_key: value.idempotency_key, payload_hash: value.payload_hash, imported_by: value.imported_by,
    committed_at: value.committed_at, source_namespace: value.source_namespace, currency_code: "CAD",
    rows_submitted: value.rows_submitted, rows_imported: value.rows_imported, rows_skipped: 0, rows_failed: 0, rows,
  };
}

function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

export function createImportAttempt({ generateKey = () => globalThis.crypto?.randomUUID?.() } = {}) {
  let snapshot = null;
  let signature = null;
  let confirmed = false;
  let busy = false;
  let uncertain = false;
  let result = null;
  return {
    get snapshot() { return snapshot; },
    get confirmed() { return confirmed; },
    get busy() { return busy; },
    get uncertain() { return uncertain; },
    get result() { return result; },
    prepare({ payload, payloadHash, acknowledgements, actorId }) {
      if (busy || uncertain || result) return;
      if (!UUID.test(actorId)) throw new Error("Sign in again before confirming this import.");
      const nextSignature = JSON.stringify(payload);
      if (snapshot && (signature !== nextSignature || snapshot.actorId !== actorId)) {
        throw new Error("Staging changed. Run Review Conflicts again before confirming.");
      }
      const key = snapshot?.idempotencyKey ?? generateKey();
      if (!UUID.test(key)) throw new Error("A secure import key could not be generated. Use a secure, supported browser.");
      const ids = [...acknowledgements].sort();
      if (!HASH.test(payloadHash) || ids.some((id) => !HASH.test(id)) || new Set(ids).size !== ids.length) {
        throw new Error("Run Review Conflicts again before confirming.");
      }
      if (snapshot && (snapshot.payloadHash !== payloadHash || JSON.stringify(snapshot.acknowledgements) !== JSON.stringify(ids))) confirmed = false;
      snapshot = freeze({ idempotencyKey: key, actorId, payloadHash,
        payload: JSON.parse(nextSignature), acknowledgements: ids });
      signature = nextSignature;
    },
    confirm(value) { if (!busy && !uncertain && !result) confirmed = value === true; },
    begin({ payload, ready, actorId }) {
      if (!snapshot || !ready || !confirmed || busy || result || snapshot.actorId !== actorId
        || signature !== JSON.stringify(payload)) throw new Error("A current review and explicit final confirmation are required.");
      busy = true;
      return snapshot;
    },
    recover(actorId) {
      if (!snapshot || busy || result || snapshot.actorId !== actorId) throw new Error("Sign in with the account that started this import to recover its result.");
      busy = true;
      return snapshot;
    },
    fail(ambiguous = false) { busy = false; uncertain ||= ambiguous; if (!uncertain) confirmed = false; },
    complete(value) { result = value; busy = false; uncertain = false; confirmed = false; },
    invalidate() {
      if (busy || uncertain) throw new Error("Resolve the pending import outcome before changing staging or starting another import.");
      snapshot = null; signature = null; confirmed = false; result = null;
    },
  };
}
