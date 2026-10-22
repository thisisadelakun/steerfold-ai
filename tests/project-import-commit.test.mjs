import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createImportAttempt, normalizeProjectImportResult } from "../app/js/import-commit-state.js";
import { normalizeImportAnalysis } from "../app/js/import-conflict-review.js";

const key = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const hash = "a".repeat(64);
const acknowledgement = "b".repeat(64);
const payload = { contract_version: 1, file_name: "fixture.xlsx", worksheet_name: "Valid",
  source_namespace: "Legacy PMO", currency_code: "CAD", rows: [{ source_row: 2, source_project_id: "SOURCE-1",
    project: { project_name: "Fixture", project_manager: "Manager", project_type: "IT", strategic_priority: "High",
      budget_bac: 300000, planned_value_pv: 175000, earned_value_ev: 150000, actual_cost_ac: 190000,
      percent_complete: 0.5, risk_score: 20, start_date: "2026-01-02", end_date: "2026-12-31",
      resource_demand: "High", project_status: "At Risk" } }] };
const result = {
  contract_version: 1, status: "committed", replayed: false,
  import_id: "33333333-3333-4333-8333-333333333333", idempotency_key: key, payload_hash: hash,
  imported_by: actorId, committed_at: "2026-10-22T15:00:00.123456+00:00", source_namespace: "legacy pmo",
  currency_code: "CAD", rows_submitted: 1, rows_imported: 1, rows_skipped: 0, rows_failed: 0,
  rows: [{ source_row: 2, source_project_id: "SOURCE-1", project_uuid: "44444444-4444-4444-8444-444444444444", project_id: "P011", project_name: "Fixture" }],
};
const expected = { idempotencyKey: key, payloadHash: hash, payload, actorId };
const prepared = { payload, payloadHash: hash, acknowledgements: [acknowledgement], actorId };

test("key is generated once on confirmation entry and snapshot cannot be mutated", () => {
  let generated = 0;
  const attempt = createImportAttempt({ generateKey: () => { generated += 1; return key; } });
  attempt.prepare(prepared); attempt.prepare(prepared);
  assert.equal(generated, 1);
  assert.equal(attempt.snapshot.idempotencyKey, key);
  assert.notEqual(attempt.snapshot.payload, payload);
  assert.throws(() => { attempt.snapshot.payload.rows[0].project.project_name = "changed"; }, TypeError);
  assert.throws(() => attempt.begin({ payload, ready: true, actorId }), /explicit final confirmation/);
  attempt.confirm(true);
  assert.throws(() => attempt.begin({ payload, ready: false, actorId }), /current review/);
  assert.throws(() => attempt.begin({ payload: { ...payload, file_name: "changed" }, ready: true, actorId }), /current review/);
  assert.throws(() => attempt.begin({ payload, ready: true, actorId: key }), /current review/);
  attempt.begin({ payload, ready: true, actorId });
  assert.throws(() => attempt.begin({ payload, ready: true, actorId }), /current review/);
});

test("ambiguous outcomes freeze same key/payload/acknowledgements; not_found does not unlock staging", () => {
  const attempt = createImportAttempt({ generateKey: () => key });
  attempt.prepare(prepared); attempt.confirm(true);
  const first = attempt.begin({ payload, ready: true, actorId });
  attempt.fail(true);
  attempt.prepare({ ...prepared, acknowledgements: [] });
  assert.throws(() => attempt.invalidate(), /Resolve the pending/);
  attempt.recover(actorId);
  attempt.fail(true); // not_found or failed reconciliation
  assert.equal(attempt.uncertain, true);
  assert.equal(attempt.begin({ payload, ready: true, actorId }), first);
  assert.deepEqual(first.acknowledgements, [acknowledgement]);
  attempt.complete(normalizeProjectImportResult(result, expected));
  assert.throws(() => attempt.begin({ payload, ready: true, actorId }), /current review/);
});

test("material changes/reset clear key and explicit confirmation; missing secure UUID fails safely", () => {
  let generated = 0;
  const attempt = createImportAttempt({ generateKey: () => ++generated === 1 ? key : actorId });
  attempt.prepare(prepared); attempt.confirm(true); attempt.invalidate();
  assert.equal(attempt.snapshot, null); assert.equal(attempt.confirmed, false);
  attempt.prepare({ ...prepared, payload: { ...payload, file_name: "another.xlsx" } });
  assert.equal(attempt.snapshot.idempotencyKey, actorId);
  const unsupported = createImportAttempt({ generateKey: () => undefined });
  assert.throws(() => unsupported.prepare(prepared), /secure import key/);
});

test("committed/replayed results are validated against exact key, hash, actor and incoming rows", () => {
  assert.deepEqual(normalizeProjectImportResult(result, expected), result);
  assert.equal(normalizeProjectImportResult({ ...result, replayed: true }, expected).replayed, true);
  assert.equal(normalizeProjectImportResult({ ...result, source_namespace: null }, {
    ...expected, payload: { ...payload, source_namespace: null },
  }).source_namespace, null);
  const notFound = { contract_version: 1, status: "not_found", idempotency_key: key };
  assert.deepEqual(normalizeProjectImportResult(notFound, { idempotencyKey: key, allowNotFound: true }), notFound);
  assert.throws(() => normalizeProjectImportResult(notFound, expected), /could not be verified/);
  for (const value of [null, {}, { ...result, contract_version: 9 }, { ...result, status: "partial" },
    { ...result, replayed: "true" }, { ...result, idempotency_key: actorId }, { ...result, payload_hash: acknowledgement },
    { ...result, imported_by: key }, { ...result, rows_imported: 0 }, { ...result, rows_failed: 1 },
    { ...result, currency_code: "USD" }, { ...result, committed_at: "invalid" }, { ...result, source_namespace: null },
    { ...result, rows: [] }, { ...result, rows: [{ ...result.rows[0], source_row: 3 }] },
    { ...result, rows: [{ ...result.rows[0], project_uuid: "invalid" }] },
    { ...result, rows: [{ ...result.rows[0], source_project_id: "CHANGED" }] },
    { ...result, rows: [{ ...result.rows[0], project_name: "CHANGED" }] }]) {
    assert.throws(() => normalizeProjectImportResult(value, expected), /could not be verified/);
  }
});

const source = await readFile(new URL("../app/js/project-import-service.js", import.meta.url), "utf8");
async function fixture({ status = 200, body = result, networkError = false, nonJson = false, token = "fixture-token" } = {}) {
  const requests = [];
  const context = vm.createContext({ AbortController, setTimeout, clearTimeout, TypeError,
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (networkError) throw new TypeError("connection lost");
      return { ok: status >= 200 && status < 300, status, json: async () => { if (nonJson) throw new Error("invalid JSON"); return body; } };
    },
  });
  const module = new vm.SourceTextModule(source, { context });
  await module.link((name) => {
    const dependency = name === "./supabase-config.js"
      ? { SUPABASE_URL: "https://fixture.invalid", SUPABASE_PUBLISHABLE_KEY: "publishable-fixture" }
      : name === "./auth-service.js" ? { getValidAccessToken: async () => token }
        : name === "./import-commit-state.js" ? { normalizeProjectImportResult } : { normalizeImportAnalysis };
    return new vm.SyntheticModule(Object.keys(dependency), function () {
      for (const [key, value] of Object.entries(dependency)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  return { api: module.namespace, requests };
}

test("commit transport sends exact PostgREST arguments with authenticated token and no live/system IDs", async () => {
  const f = await fixture();
  await f.api.commitProjectImport({ idempotencyKey: key, payload, acknowledgements: [acknowledgement] });
  assert.equal(f.requests.length, 1);
  const { url, options } = f.requests[0];
  assert.equal(url, "https://fixture.invalid/rest/v1/rpc/commit_project_import");
  assert.equal(options.method, "POST");
  assert.equal(options.headers.Authorization, "Bearer fixture-token");
  assert.equal(options.headers.apikey, "publishable-fixture");
  assert.equal(options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(options.body), { p_idempotency_key: key, p_payload: payload, p_acknowledgements: [acknowledgement] });
  for (const field of ["id", "project_id", "created_at", "updated_at", "actor_id", "imported_by"]) {
    assert.equal(field in JSON.parse(options.body).p_payload.rows[0].project, false);
  }
});

test("result lookup is read-only transport with same key and supports not_found and stored result", async () => {
  for (const body of [result, { contract_version: 1, status: "not_found", idempotency_key: key }]) {
    const f = await fixture({ body });
    assert.equal((await f.api.getProjectImportResult(key)).status, body.status);
    assert.equal(f.requests[0].url, "https://fixture.invalid/rest/v1/rpc/get_project_import_result");
    assert.deepEqual(JSON.parse(f.requests[0].options.body), { p_idempotency_key: key });
    assert.equal(f.requests.length, 1);
  }
});

test("malformed successes, network errors and ambiguous HTTP errors require same-key recovery", async () => {
  for (const options of [{ body: {} }, { nonJson: true }, { networkError: true }, { status: 502 }, { body: { ...result, status: "not_found" } }]) {
    const f = await fixture(options);
    await assert.rejects(f.api.commitProjectImport({ idempotencyKey: key, payload, acknowledgements: [] }), (error) => error.uncertain === true);
    assert.equal(f.requests.length, 1);
  }
});

test("definite validation, auth and lock failures never report success or expose raw SQL details", async () => {
  for (const [status, code] of [[401, null], [403, "42501"], [400, "23514"], [400, "55P03"], [400, "22023"]]) {
    const f = await fixture({ status, body: { code, message: "private SQL", details: "private SQL", hint: "private SQL" } });
    await assert.rejects(f.api.commitProjectImport({ idempotencyKey: key, payload, acknowledgements: [] }), (error) => {
      assert.equal(error.uncertain, false);
      assert.equal(error.message.includes("private SQL"), false);
      if (status === 400) assert.equal(error.requiresReview, true);
      return true;
    });
  }
  const f = await fixture({ token: null });
  await assert.rejects(f.api.commitProjectImport({ idempotencyKey: key, payload, acknowledgements: [] }), /Sign in/);
  assert.equal(f.requests.length, 0);
});

test("app integration uses strict Supabase refresh, verifies imported IDs and retains SPA Projects navigation", async () => {
  const app = await readFile(new URL("../app/js/app.js", import.meta.url), "utf8");
  const start = app.indexOf('importButton.addEventListener("click"');
  const integration = app.slice(start, app.indexOf("const actions", start));
  assert.match(integration, /await this\.loadDashboard\(\{ allowCsvFallback: false \}\)/);
  assert.match(integration, /result\.rows\.some\(\(row\) => !projectIds\.has\(row\.project_id\)\)/);
  assert.match(integration, /onViewProjects: \(\) => this\.navigateToProjects\(\)/);
});
