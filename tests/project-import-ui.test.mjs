import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import * as validation from "../app/js/import-validation.js";
import * as conflict from "../app/js/import-conflict-review.js";
import * as commitState from "../app/js/import-commit-state.js";

// Small DOM fixture for the dialog's event wiring; no browser, auth or network is used.
class Node {
  constructor(tag, document) {
    this.tag = tag; this.document = document; this.children = []; this.dataset = {};
    this.attributes = {}; this.listeners = {}; this.disabled = false; this.parent = null; this.value = "";
  }
  set textContent(value) { this.text = value; this.children = []; }
  get textContent() { return (this.text || "") + this.children.map((child) => child.textContent).join(" "); }
  append(...children) {
    for (const child of children) { child.remove(); child.parent = this; this.children.push(child); }
  }
  replaceChildren(...children) { this.children.forEach((child) => { child.parent = null; }); this.children = []; this.text = ""; this.append(...children); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = null; }
  get isConnected() { return this === this.document.body || !!this.parent?.isConnected; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
  async fire(name) { for (const handler of this.listeners[name] || []) await handler({ preventDefault() {} }); }
  focus() { if (!this.disabled) this.document.activeElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  querySelectorAll(selector) {
    const matches = (node) => selector.split(",").some((part) => {
      part = part.trim();
      if (part.startsWith("#")) return node.id === part.slice(1);
      if (part.startsWith(".")) return node.className?.split(" ").includes(part.slice(1));
      if (part === "[data-import-readiness]") return "importReadiness" in node.dataset;
      return node.tag === part;
    });
    return this.children.flatMap((child) => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

const source = await readFile(new URL("../app/js/project-import.js", import.meta.url), "utf8");
const flush = () => new Promise((resolve) => setImmediate(resolve));
const actorId = "11111111-1111-4111-8111-111111111111";
let nextKey = 0;
async function fixture({ commit, recover, onImported = async () => {} } = {}) {
  const document = { createElement(tag) { return new Node(tag, document); }, getElementById(id) { return this.body.querySelector(`#${id}`); } };
  document.body = new Node("body", document);
  document.activeElement = document.body;
  const events = new Map();
  const window = { addEventListener: (name, handler) => events.set(name, handler), removeEventListener: (name) => events.delete(name) };
  let authenticated = true;
  const requests = [];
  const commits = [];
  const recoveries = [];
  let resolveCheck;
  const staged = {
    headers: validation.IMPORT_FIELDS.map((field) => field.key),
    rows: [2, 3].map((rowNumber) => ({ rowNumber,
      values: [`TEST-${rowNumber}`, `Fixture ${rowNumber}`, "Manager", "IT", "High", 300000, 175000, 150000, 190000, 50, 20, "2026-01-02", "2026-12-31", "High", "At Risk"],
      dates: {}, percentages: [], formulas: [], cellErrors: [],
    })),
  };
  const dependencies = {
    "./app-config.js": { APP_CONFIG: { portfolio: { currencyCode: "CAD" } } },
    "./import-parser.js": { parseImportFile: async (file) => ({ name: file.name, type: "XLSX", sheetNames: ["Valid Projects", "Other"], readSheet: () => staged }) },
    "./import-validation.js": validation,
    "./auth-service.js": { isAuthenticated: () => authenticated, getCurrentUser: () => authenticated ? { id: actorId } : null },
    "./project-import-service.js": { checkProjectImport: (payload) => {
      requests.push(payload);
      return new Promise((resolve) => { resolveCheck = resolve; });
    }, commitProjectImport: async (args) => { commits.push(args); return commit(args); },
    getProjectImportResult: async (key) => { recoveries.push(key); return recover(key); } },
    "./import-conflict-review.js": conflict,
    "./import-commit-state.js": commitState,
  };
  const context = vm.createContext({ document, window, crypto: { randomUUID: () => `99999999-9999-4999-8999-${String(++nextKey).padStart(12, "0")}` } });
  const module = new vm.SourceTextModule(source, { context });
  await module.link((name) => {
    const dependency = dependencies[name];
    assert.ok(dependency, `Unexpected dependency: ${name}`);
    return new vm.SyntheticModule(Object.keys(dependency), function () {
      Object.entries(dependency).forEach(([key, value]) => this.setExport(key, value));
    }, { context });
  });
  await module.evaluate();
  module.namespace.openProjectImport({ onImported });
  module.namespace.openProjectImport();
  assert.equal(document.body.querySelectorAll("dialog").length, 1);
  const buttons = () => document.body.querySelectorAll("button");
  const byText = (text) => buttons().find((node) => node.textContent === text);
  const click = async (text) => { const node = byText(text); assert.ok(node, text); assert.equal(node.disabled, false, text); await node.fire("click"); await flush(); };
  const input = document.getElementById("sf-import-file");
  input.files = [{ name: "fixture.xlsx" }];
  await input.fire("change");
  await flush();
  await click("Continue to Validate");
  await click("Continue to Preview");
  return { document, byText, click, requests, commits, recoveries,
    reopen() { module.namespace.openProjectImport({ onImported }); },
    async confirm() { const field = document.getElementById("sf-import-confirm-create"); assert.ok(field); field.checked = true; await field.fire("change"); },
    async namespace(value) { const field = document.getElementById("sf-import-namespace"); field.value = value; await field.fire("input"); },
    async complete(blocking = false) {
      resolveCheck({ contract_version: 1, payload_hash: "a".repeat(64), rows_submitted: requests.at(-1).rows.length,
        blocking_count: blocking ? 1 : 0, warning_count: 1, ready_for_confirmation: !blocking, requires_acknowledgement: true,
        blocking_conflicts: blocking ? [{ code: "source_id_already_imported", source_row: 2, source_project_id: "TEST-2" }] : [],
        warnings: [{ code: "name_match", source_row: 2, conflict_id: "b".repeat(64), existing_project_id: "P001", existing_project_name: "Fixture" }],
      });
      await flush();
    },
    async signOut() { authenticated = false; events.get("auth:changed")(); await flush(); },
    async signIn() { authenticated = true; events.get("auth:changed")(); await flush(); },
  };
}

test("dialog wiring preserves staging and selection, enforces single-flight review and invalidates namespace/selection", async () => {
  const ui = await fixture();
  assert.equal(ui.byText("Review Conflicts").disabled, false);
  await ui.click("Clear selection");
  assert.equal(ui.byText("Review Conflicts").disabled, true);
  await ui.click("Select all eligible rows");
  await ui.namespace("Legacy PMO");
  const action = ui.byText("Review Conflicts");
  const pending = action.fire("click");
  await action.fire("click");
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.document.getElementById("sf-import-namespace").disabled, true);
  assert.equal(ui.byText("Cancel").disabled, true);
  assert.equal(ui.requests[0].source_namespace, "Legacy PMO");
  await ui.complete(); await pending;
  assert.match(ui.document.body.textContent, /existing Steerfold project/);
  await ui.click("Acknowledge all warnings");
  assert.match(ui.document.body.textContent, /Ready for final confirmation/);
  await ui.namespace("Jira");
  assert.doesNotMatch(ui.document.body.textContent, /Ready for final confirmation|Acknowledged/);
  assert.match(ui.document.body.textContent, /successful server check is required/);
  await ui.click("Back");
  assert.equal(ui.document.getElementById("sf-import-namespace").value, "Jira");
  const selected = ui.document.getElementById("sf-import-select-3");
  selected.checked = false; await selected.fire("change");
  const second = ui.byText("Review Conflicts").fire("click");
  assert.equal(ui.requests.length, 2);
  assert.equal(ui.requests[1].rows.length, 1);
  await ui.complete(true); await second;
  await ui.click("Acknowledge all warnings");
  assert.match(ui.document.body.textContent, /Blocking conflicts cannot be overridden/);
  assert.doesNotMatch(ui.document.body.textContent, /Ready for final confirmation/);
});

test("sign-out during a pending review discards its response and disables checking", async () => {
  const ui = await fixture();
  const pending = ui.byText("Review Conflicts").fire("click");
  await ui.signOut();
  await ui.complete(); await pending;
  assert.equal(ui.byText("Review Conflicts").disabled, true);
  assert.doesNotMatch(ui.document.body.textContent, /Ready for final confirmation|Duplicate warnings/);
  assert.match(ui.document.body.textContent, /Sign in again/);
});

function committed(snapshot, replayed = false) {
  return {
    contract_version: 1, status: "committed", replayed,
    import_id: "33333333-3333-4333-8333-333333333333", idempotency_key: snapshot.idempotencyKey,
    payload_hash: snapshot.payloadHash, imported_by: actorId, committed_at: "2026-10-22T15:00:00+00:00",
    source_namespace: snapshot.payload.source_namespace?.trim().toLowerCase() || null, currency_code: "CAD",
    rows_submitted: snapshot.payload.rows.length, rows_imported: snapshot.payload.rows.length, rows_skipped: 0, rows_failed: 0,
    rows: snapshot.payload.rows.map((row, index) => ({ source_row: row.source_row, source_project_id: row.source_project_id,
      project_uuid: `44444444-4444-4444-8444-${String(index + 1).padStart(12, "0")}`,
      project_id: `P${11 + index}`, project_name: row.project.project_name })),
  };
}

async function ready(ui) {
  const pending = ui.byText("Review Conflicts").fire("click");
  await ui.complete(); await pending;
  assert.equal(ui.document.getElementById("sf-import-confirm-create"), null);
  await ui.click("Acknowledge all warnings");
  assert.equal(ui.byText("Import Projects").disabled, true);
  await ui.confirm();
  assert.equal(ui.byText("Import Projects").disabled, false);
}

test("final checkbox gates a single commit, exact reviewed payload is sent and completed state cannot commit twice", async () => {
  let resolveCommit;
  let refreshed = 0;
  const ui = await fixture({ commit: () => new Promise((resolve) => { resolveCommit = resolve; }), onImported: async () => { refreshed += 1; } });
  await ready(ui);
  const action = ui.byText("Import Projects");
  const pending = action.fire("click");
  await action.fire("click");
  assert.equal(ui.commits.length, 1);
  assert.equal(ui.byText("Cancel").disabled, true);
  assert.equal(JSON.stringify(ui.commits[0].payload), JSON.stringify(ui.requests[0]));
  assert.deepEqual([...ui.commits[0].acknowledgements], ["b".repeat(64)]);
  resolveCommit(committed(ui.commits[0])); await pending;
  assert.equal(refreshed, 1);
  assert.match(ui.document.body.textContent, /Import Complete/);
  assert.match(ui.document.body.textContent, /P11/);
  assert.equal(ui.byText("Import Projects"), undefined);
  await action.fire("click");
  assert.equal(ui.commits.length, 1);
  await ui.click("Start Another Import");
  assert.equal(ui.document.getElementById("sf-import-final-confirmation"), null);
  assert.match(ui.document.body.textContent, /No file selected/);
});

test("ambiguous commit is reconciled successfully without a second write", async () => {
  let ui;
  ui = await fixture({ commit: async () => { throw Object.assign(new Error("network interrupted"), { uncertain: true }); },
    recover: async () => committed(ui.commits[0], true) });
  await ready(ui);
  await ui.click("Import Projects");
  assert.equal(ui.commits.length, 1);
  assert.deepEqual(ui.recoveries, [ui.commits[0].idempotencyKey]);
  assert.match(ui.document.body.textContent, /restored the original result/);
  assert.match(ui.document.body.textContent, /Import Complete/);
});

test("not_found leaves an uncertain attempt locked; Retry Import uses identical key, payload and acknowledgements", async () => {
  let sent = 0;
  const ui = await fixture({ commit: async (args) => {
    if (++sent === 1) throw Object.assign(new Error("timeout"), { uncertain: true });
    return committed(args, true);
  }, recover: async (key) => ({ contract_version: 1, status: "not_found", idempotency_key: key }) });
  await ready(ui);
  await ui.click("Import Projects");
  assert.match(ui.document.body.textContent, /original request may still be running/);
  assert.equal(ui.byText("Start Another Import"), undefined);
  assert.equal(ui.document.getElementById("sf-import-namespace"), null);
  await ui.click("Retry Import");
  assert.equal(ui.commits.length, 2);
  assert.equal(ui.commits[0], ui.commits[1]);
  assert.match(ui.document.body.textContent, /Import Complete/);
});

test("commit success plus refresh failure stays complete and refresh retry never repeats the import", async () => {
  let refreshed = 0;
  const ui = await fixture({ commit: async (args) => committed(args), onImported: async () => {
    if (++refreshed === 1) throw new Error("Supabase read unavailable");
  } });
  await ready(ui);
  await ui.click("Import Projects");
  assert.match(ui.document.body.textContent, /Import Complete/);
  assert.match(ui.document.body.textContent, /Import completed, but Steerfold could not refresh/);
  await ui.click("Retry Portfolio Refresh");
  assert.equal(refreshed, 2);
  assert.equal(ui.commits.length, 1);
  assert.doesNotMatch(ui.document.body.textContent, /could not refresh/);
});

test("changing namespace after final confirmation clears confirmation and disables committing until a new review", async () => {
  const ui = await fixture();
  await ready(ui);
  await ui.namespace("changed");
  assert.equal(ui.byText("Import Projects"), undefined);
  assert.equal(ui.document.getElementById("sf-import-confirm-create"), null);
  assert.equal(ui.commits.length, 0);
});

test("definite conflict failure requires another review and never reports success", async () => {
  const ui = await fixture({ commit: async () => { throw Object.assign(new Error("Conflicts changed. Run Review Conflicts again."), { requiresReview: true }); } });
  await ready(ui);
  await ui.click("Import Projects");
  assert.equal(ui.commits.length, 1);
  assert.equal(ui.recoveries.length, 0);
  assert.match(ui.document.body.textContent, /Conflicts changed/);
  assert.equal(ui.byText("Import Projects"), undefined);
  assert.doesNotMatch(ui.document.body.textContent, /Import Complete/);
});

test("uncertain recovery survives closing for sign-in and cannot be retried while signed out", async () => {
  let ui;
  let found = false;
  ui = await fixture({ commit: async () => { throw Object.assign(new Error("connection interrupted"), { uncertain: true }); },
    recover: async (key) => found ? committed(ui.commits[0]) : { contract_version: 1, status: "not_found", idempotency_key: key } });
  await ready(ui);
  await ui.click("Import Projects");
  await ui.signOut();
  assert.equal(ui.byText("Retry Import").disabled, true);
  assert.equal(ui.byText("Check Import Result").disabled, true);
  await ui.click("Close (keep recovery)");
  assert.equal(ui.document.getElementById("sf-project-import").open, false);
  await ui.signIn(); ui.reopen();
  assert.equal(ui.document.getElementById("sf-project-import").open, true);
  found = true;
  await ui.click("Check Import Result");
  assert.equal(ui.commits.length, 1);
  assert.match(ui.document.body.textContent, /Import Complete/);
});
