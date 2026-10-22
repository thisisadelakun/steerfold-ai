import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { normalizeProjectImportResult } from "../app/js/import-commit-state.js";
import { buildProjectImportPayload, normalizeImportAnalysis, createConflictReview } from "../app/js/import-conflict-review.js";

const project = {
  projectId: "TEST-001", projectName: "Fixture", projectManager: "Manager", projectType: "IT",
  strategicPriority: "High", budgetBAC: 300000, plannedValuePV: 175000, earnedValueEV: 150000,
  actualCostAC: 190000, percentComplete: 0.5, riskScore: 20, startDate: "2026-01-02",
  endDate: "2026-12-31", resourceDemand: "High", projectStatus: "At Risk",
  id: "must-not-send", created_at: "must-not-send", EAC: 380000, actor_id: "must-not-send",
};
const rows = [2, 3].map((rowNumber) => ({ rowNumber, project: { ...project, projectId: `TEST-00${rowNumber}` }, errors: [], warnings: [], status: "valid" }));
const input = { results: { rows, mappingIssues: [], summary: { error: 0 } }, selectedRows: new Set([2]), fileName: "fixture.xlsx", worksheetName: "Valid Projects", sourceNamespace: "" };
const payload = buildProjectImportPayload(input);
const hash = "a".repeat(64);
const warning = { code: "name_match", source_row: 2, conflict_id: "b".repeat(64), existing_project_id: "P001", existing_project_name: "Fixture" };
function response(warnings = [], blocking = []) {
  return { contract_version: 1, payload_hash: hash, rows_submitted: 1,
    blocking_count: blocking.length, warning_count: warnings.length, ready_for_confirmation: !blocking.length,
    requires_acknowledgement: !!warnings.length, blocking_conflicts: blocking, warnings };
}

test("payload is selected normalized CAD data with only the fourteen allowed project fields", () => {
  assert.equal(payload.rows.length, 1);
  assert.equal(payload.rows[0].source_row, 2);
  assert.equal(payload.rows[0].source_project_id, "TEST-002");
  assert.equal(payload.rows[0].project.percent_complete, 0.5);
  assert.equal(payload.rows[0].project.start_date, "2026-01-02");
  assert.equal(payload.currency_code, "CAD");
  assert.equal(payload.contract_version, 1);
  assert.equal(Object.keys(payload.rows[0].project).length, 14);
  for (const key of ["id", "project_id", "created_at", "updated_at", "actor_id", "EAC", "payload_hash"]) {
    assert.equal(key in payload.rows[0].project, false);
    assert.equal(key in payload, false);
  }
});

test("namespace is optional, never derived from filename, and preserves supplied value", () => {
  assert.equal(payload.source_namespace, null);
  assert.equal(buildProjectImportPayload({ ...input, sourceNamespace: "  Legacy PMO  " }).source_namespace, "Legacy PMO");
  assert.equal(buildProjectImportPayload({ ...input, sourceNamespace: " \t " }).source_namespace, null);
  const noId = structuredClone(input.results);
  delete noId.rows[0].project.projectId;
  assert.equal(buildProjectImportPayload({ ...input, results: noId, worksheetName: "" }).rows[0].source_project_id, null);
  assert.equal(buildProjectImportPayload({ ...input, worksheetName: "" }).worksheet_name, null);
});

test("zero selection, incomplete mappings and client validation errors block checking", () => {
  assert.throws(() => buildProjectImportPayload({ ...input, selectedRows: new Set() }), /Select at least one/);
  assert.throws(() => buildProjectImportPayload({ ...input, results: { ...input.results, mappingIssues: ["Missing name"] } }), /Resolve/);
  assert.throws(() => buildProjectImportPayload({ ...input, results: { ...input.results, summary: { error: 1 } } }), /Resolve/);
});

test("authoritative blockers and warnings are normalized without exposing database internals", () => {
  for (const code of ["invalid_project", "source_id_already_imported"]) {
    const result = normalizeImportAnalysis(response([], [{ code, source_row: 2, details: "private SQL", messages: ["raw SQL"] }]), payload);
    assert.equal(result.ready_for_confirmation, false);
    assert.equal(result.blocking_conflicts[0].details, undefined);
    assert.equal(result.blocking_conflicts[0].messages, undefined);
  }
  const batch = buildProjectImportPayload({ ...input, selectedRows: new Set([2, 3]) });
  assert.equal(normalizeImportAnalysis({ ...response([], [{ code: "duplicate_source_id", source_rows: [2, 3], source_project_id: "TEST" }]), rows_submitted: 2 }, batch).blocking_count, 1);
  for (const code of ["name_match", "name_manager_match", "name_start_date_match", "name_manager_start_date_match", "source_id_matches_live_code"]) {
    assert.equal(normalizeImportAnalysis(response([{ ...warning, code }]), payload).warnings[0].code, code);
  }
  assert.equal(normalizeImportAnalysis({ ...response([{ code: "name_repeated_in_upload", source_rows: [2, 3], conflict_id: hash }]), rows_submitted: 2 }, batch).warning_count, 1);
});

test("malformed, inconsistent, unknown-version and unknown-conflict responses fail closed", () => {
  for (const value of [null, {}, { ...response(), contract_version: 2 }, { ...response(), payload_hash: "client-hash" },
    { ...response(), rows_submitted: 2 }, { ...response(), warning_count: 1 }, { ...response(), ready_for_confirmation: false },
    response([{ ...warning, source_row: 999 }]), response([{ ...warning, code: "unknown" }]), response([warning, warning]),
    response([{ ...warning, conflict_id: "bad" }]), { ...response(), requires_acknowledgement: true }]) {
    assert.throws(() => normalizeImportAnalysis(value, payload), /unsupported or incomplete/);
  }
});

test("acknowledgement uses only current server IDs, including acknowledge-all; blockers never become ready", () => {
  const review = createConflictReview();
  review.accept(normalizeImportAnalysis(response([warning]), payload), review.revision);
  assert.equal(review.ready, false);
  review.acknowledge("invented", true);
  assert.equal(review.acknowledgedCount, 0);
  review.acknowledge(warning.conflict_id, true);
  assert.equal(review.ready, true);
  review.acknowledge(warning.conflict_id, false);
  assert.equal(review.ready, false);
  review.acknowledgeAll();
  assert.equal(review.ready, true);
  review.accept(normalizeImportAnalysis(response([warning], [{ code: "invalid_project", source_row: 2 }]), payload), review.revision);
  review.acknowledgeAll();
  assert.equal(review.ready, false);
});

test("material invalidation clears server hash, results and acknowledgements and rejects delayed responses", () => {
  for (const reason of ["file", "worksheet", "mapping", "selection", "normalized values", "namespace", "validation", "sign-out"]) {
    const review = createConflictReview();
    const revision = review.revision;
    const result = normalizeImportAnalysis(response([warning]), payload);
    review.accept(result, revision);
    review.acknowledgeAll();
    review.invalidate();
    assert.equal(review.analysis, null, reason);
    assert.equal(review.acknowledgedCount, 0, reason);
    assert.equal(review.ready, false, reason);
    assert.equal(review.accept(result, revision), false, reason);
  }
});

const serviceSource = await readFile(new URL("../app/js/project-import-service.js", import.meta.url), "utf8");
async function service({ token = "fixture-token", authError = false, status = 200, body = response(), nonJson = false, networkError = false } = {}) {
  const requests = [];
  const context = vm.createContext({ AbortController, setTimeout, clearTimeout, TypeError, fetch: async (url, options) => {
    requests.push({ url, options });
    if (networkError) throw new TypeError("Failed to fetch");
    return { ok: status >= 200 && status < 300, status, json: async () => { if (nonJson) throw new Error("non JSON"); return body; } };
  } });
  const module = new vm.SourceTextModule(serviceSource, { context });
  await module.link((specifier) => {
    const exports = specifier === "./supabase-config.js"
      ? { SUPABASE_URL: "https://fixture.invalid", SUPABASE_PUBLISHABLE_KEY: "publishable-fixture" }
      : specifier === "./auth-service.js"
        ? { getValidAccessToken: async () => { if (authError) throw new Error("refresh failed"); return token; } }
        : specifier === "./import-commit-state.js" ? { normalizeProjectImportResult }
          : { normalizeImportAnalysis };
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, { context });
  });
  await module.evaluate();
  return { check: module.namespace.checkProjectImport, requests };
}

test("transport calls only the read-only check RPC with authenticated PostgREST argument contract", async () => {
  const fixture = await service();
  const result = await fixture.check(payload);
  assert.equal(result.payload_hash, hash);
  assert.equal(fixture.requests.length, 1);
  const { url, options } = fixture.requests[0];
  assert.equal(url, "https://fixture.invalid/rest/v1/rpc/check_project_import");
  assert.equal(options.method, "POST");
  assert.equal(options.headers.apikey, "publishable-fixture");
  assert.equal(options.headers.Authorization, "Bearer fixture-token");
  assert.equal(options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(options.body), { p_payload: payload });
  assert.ok(fixture.requests.every((request) => request.url.endsWith("/rpc/check_project_import")));
});

test("authentication failures do not send any RPC", async () => {
  for (const options of [{ token: null }, { authError: true }]) {
    const fixture = await service(options);
    await assert.rejects(fixture.check(payload), /Sign in|sign in/);
    assert.equal(fixture.requests.length, 0);
  }
});

test("RPC, network, non-JSON and invalid-contract failures are explicit and never empty reviews", async () => {
  for (const [options, message] of [
    [{ status: 401 }, /Sign in/], [{ status: 403 }, /Sign in/],
    [{ status: 400, body: { code: "54000", message: "raw SQL" } }, /smaller batch/],
    [{ status: 400, body: { code: "23514" } }, /rejected the staged data/],
    [{ status: 500 }, /could not complete/], [{ networkError: true }, /connection/],
    [{ nonJson: true }, /unreadable/], [{ body: { ...response(), contract_version: 9 } }, /unsupported/],
  ]) {
    const fixture = await service(options);
    await assert.rejects(fixture.check(payload), message);
    assert.equal(fixture.requests.length, 1);
  }
});
