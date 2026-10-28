import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

class Node {
  constructor(tag = "div") { this.tag = tag; this.children = []; this.listeners = {}; this.disabled = false; this.checked = false; this.value = ""; this.textContent = ""; this.isConnected = true; }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  querySelectorAll(selector) { return this.children.flatMap((child) => [...(selector.split(",").map((s) => s.trim()).includes(child.tag) ? [child] : []), ...child.querySelectorAll(selector)]); }
  focus() {}
  async fire(type) {
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    if (type === "click" && this.disabled) return event;
    for (const handler of this.listeners[type] || []) await handler(event);
    return event;
  }
  close() { this.open = false; this.fire("close"); }
}

async function fixture({ admin = true, writable = true, demo = false, deferred = false, failure = false } = {}) {
  let user = { id: "actor-a" };
  let state = { currency: "CAD", status: "ready" };
  const subscribers = [];
  const select = new Node("select");
  const save = new Node("button");
  const status = new Node("p");
  const reload = new Node("button");
  const nodes = { "[data-organization-currency-select]": select, "[data-organization-currency-save]": save,
    "[data-organization-currency-status]": status, "[data-organization-currency-reload]": reload };
  const dialogs = [];
  const requests = [];
  const window = new EventTarget();
  let release;
  const gate = deferred ? new Promise((resolve) => { release = resolve; }) : null;
  function publish(next) { state = next; subscribers.forEach((listener) => listener(state)); }
  const context = vm.createContext({ window, document: { querySelector: (key) => nodes[key], createElement: (tag) => new Node(tag), body: new Node(), activeElement: null } });
  const mocks = {
    "./organization-currency.js": { getOrganizationCurrencyState: () => state, subscribeOrganizationCurrency: (listener) => subscribers.push(listener) },
    "./organization-settings-service.js": {
      loadOrganizationSettings: async () => state,
      updateOrganizationCurrency: async (currency, options) => {
        requests.push({ currency, ...options });
        if (gate) await gate;
        if (failure) { publish({ ...state, status: "unavailable" }); throw new Error("Save could not be confirmed. Reload Settings."); }
        publish({ currency, status: "ready" }); return state;
      },
    },
    "./auth-service.js": { getCurrentUser: () => user, isAuthenticated: () => Boolean(user) },
    "./workspace-context.js": { canWriteWorkspace: () => writable, isDemoWorkspace: () => demo },
    "./governance-role-service.js": { getMyGovernanceRoles: async () => admin ? [{ role: "governance_admin" }] : [] },
    "./utility-dialog.js": { createUtilityDialog: () => {
      const dialog = new Node("dialog");
      dialog.append(new Node("button"));
      const modal = { dialog, open() { dialog.open = true; } };
      dialogs.push(modal); return modal;
    } },
  };
  const module = new vm.SourceTextModule(await readFile(new URL("../app/js/organization-settings-ui.js", import.meta.url), "utf8"), { context });
  await module.link((name) => {
    const exports = mocks[name];
    return new vm.SyntheticModule(Object.keys(exports), function () { Object.entries(exports).forEach(([key, value]) => this.setExport(key, value)); }, { context });
  });
  await module.evaluate();
  await module.namespace.initOrganizationCurrencySettings().ready;
  await new Promise(setImmediate);
  return { select, save, status, requests, dialogs, state: () => state, release,
    async choose(currency) { select.value = currency; await select.fire("change"); },
    setAuthority(currency) { publish({ currency, status: "ready" }); },
    signOut() { user = null; window.dispatchEvent(new Event("auth:changed")); },
  };
}

test("a governance role cannot enable settings writes in a read-only Demo workspace", async () => {
  const f = await fixture({ admin: true, writable: false });
  assert.equal(f.select.disabled, true);
  assert.equal(f.save.disabled, true);
  await f.save.fire("click");
  assert.equal(f.requests.length, 0);
});

test("Demo currency stays fixed even for an eligible administrator", async () => {
  const f = await fixture({ admin: true, writable: true, demo: true });
  assert.equal(f.select.disabled, true);
  assert.equal(f.save.disabled, false);
  await f.choose("USD");
  await f.save.fire("click");
  assert.equal(f.requests.length, 0);
  assert.match(f.status.textContent, /fixed to CAD/);
});

function controls(f) {
  const dialog = f.dialogs.at(-1).dialog;
  return { dialog, checkbox: dialog.querySelectorAll("input")[0],
    confirm: dialog.querySelectorAll("button").find((button) => button.textContent === "Confirm Currency Change"),
    cancel: dialog.querySelectorAll("button").find((button) => button.textContent === "Cancel") };
}

test("different currency requires exact warning and a fresh explicit acknowledgement; Cancel never writes", async () => {
  const f = await fixture();
  assert.equal(f.select.disabled, false);
  await f.choose("USD"); await f.save.fire("click");
  let c = controls(f);
  assert.ok(c.dialog.children.some((node) => node.textContent === "Changing organization currency does not convert existing project financial amounts. Existing numeric values will be interpreted using the newly selected currency."));
  assert.equal(c.confirm.disabled, true);
  await c.confirm.fire("click"); assert.equal(f.requests.length, 0);
  await c.cancel.fire("click"); assert.equal(c.dialog.open, false);
  assert.equal(f.state().currency, "CAD");
  await f.save.fire("click"); c = controls(f);
  assert.equal(c.checkbox.checked, false);
  assert.equal(c.confirm.disabled, true);
});

test("acknowledged change is single-flight, blocks Escape/cancel while saving, and sends expected current currency", async () => {
  const f = await fixture({ deferred: true });
  await f.choose("USD"); await f.save.fire("click");
  const c = controls(f);
  c.checkbox.checked = true; await c.checkbox.fire("change");
  const saving = c.confirm.fire("click");
  assert.equal(c.confirm.disabled, true); assert.equal(c.cancel.disabled, true);
  assert.equal(c.checkbox.disabled, true); assert.equal(f.save.disabled, true);
  assert.equal((await c.dialog.fire("cancel")).defaultPrevented, true);
  await c.confirm.fire("click"); await f.save.fire("click");
  assert.deepEqual(f.requests, [{ currency: "USD", expectedCurrency: "CAD", confirmed: true }]);
  f.release(); await saving;
  assert.equal(c.dialog.open, false); assert.equal(f.state().currency, "USD");
});

test("unchanged currency does not open a modal or require acknowledgement", async () => {
  const f = await fixture();
  await f.save.fire("click");
  assert.equal(f.dialogs.length, 0);
  assert.deepEqual(f.requests, [{ currency: "CAD", expectedCurrency: "CAD", confirmed: false }]);
});

test("unavailable save stays open without false success or an automatic retry", async () => {
  const f = await fixture({ failure: true });
  await f.choose("GBP"); await f.save.fire("click");
  const c = controls(f);
  c.checkbox.checked = true; await c.checkbox.fire("change"); await c.confirm.fire("click");
  assert.equal(c.dialog.open, true); assert.equal(c.confirm.disabled, true); assert.equal(c.cancel.disabled, false);
  assert.equal(f.state().currency, "CAD"); assert.equal(f.requests.length, 1);
  assert.match(f.status.textContent, /could not be confirmed/);
});

test("authority changes, sign-out and missing admin roles fail closed before mutation", async () => {
  const ordinary = await fixture({ admin: false });
  assert.equal(ordinary.select.disabled, true); assert.equal(ordinary.save.disabled, true);
  for (const action of [(f) => f.setAuthority("EUR"), (f) => f.signOut()]) {
    const f = await fixture(); await f.choose("USD"); await f.save.fire("click");
    const c = controls(f); c.checkbox.checked = true; await c.checkbox.fire("change");
    action(f); await c.confirm.fire("click");
    assert.equal(c.dialog.open, false); assert.equal(f.requests.length, 0);
  }
});
