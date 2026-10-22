import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import * as validation from "../app/js/import-validation.js";
import * as conflict from "../app/js/import-conflict-review.js";

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
async function fixture() {
  const document = { createElement(tag) { return new Node(tag, document); }, getElementById(id) { return this.body.querySelector(`#${id}`); } };
  document.body = new Node("body", document);
  document.activeElement = document.body;
  const events = new Map();
  const window = { addEventListener: (name, handler) => events.set(name, handler), removeEventListener: (name) => events.delete(name) };
  let authenticated = true;
  const requests = [];
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
    "./auth-service.js": { isAuthenticated: () => authenticated },
    "./project-import-service.js": { checkProjectImport: (payload) => {
      requests.push(payload);
      return new Promise((resolve) => { resolveCheck = resolve; });
    } },
    "./import-conflict-review.js": conflict,
  };
  const context = vm.createContext({ document, window });
  const module = new vm.SourceTextModule(source, { context });
  await module.link((name) => {
    const dependency = dependencies[name];
    assert.ok(dependency, `Unexpected dependency: ${name}`);
    return new vm.SyntheticModule(Object.keys(dependency), function () {
      Object.entries(dependency).forEach(([key, value]) => this.setExport(key, value));
    }, { context });
  });
  await module.evaluate();
  module.namespace.openProjectImport();
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
  return { document, byText, click, requests,
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
