import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const js = new URL("../app/js/", import.meta.url);
const privateId = "11111111-1111-4111-8111-111111111111";
const demoId = "22222222-2222-4222-8222-222222222222";
const privateRow = { id: privateId, organization_name: "Private Company", industry: "Technology",
  organization_currency: "EUR", is_demo: false, can_write: true };
const demoRow = { ...privateRow, id: demoId, organization_name: "Demo", organization_currency: "CAD", is_demo: true, can_write: false };
const tick = () => new Promise(setImmediate);
function deferred() { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

class Element {
  constructor(tag = "div") {
    this.tag = tag; this.children = []; this.listeners = new Map(); this.dataset = {};
    this.attributes = new Map(); this.hidden = false; this.disabled = false; this.value = "";
    this.textContent = ""; this.className = "";
    this.classList = {
      contains: (name) => this.className.split(/\s+/).includes(name),
      add: (name) => { if (!this.classList.contains(name)) this.className += ` ${name}`; },
      remove: (name) => { this.className = this.className.split(/\s+/).filter((item) => item !== name).join(" "); },
      toggle: (name) => { const active = !this.classList.contains(name); this.classList[active ? "add" : "remove"](name); return active; },
    };
    this.style = {};
  }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  prepend(node) { node.parent = this; this.children.unshift(node); }
  before(node) { node.parent = this.parent; this.parent.children.splice(this.parent.children.indexOf(this), 0, node); }
  replaceChildren(...nodes) { for (const child of this.children) child.parent = null; this.children = []; this.append(...nodes); }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  toggleAttribute(key, force) { if (force) this.setAttribute(key, ""); else this.removeAttribute(key); }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  get isConnected() { return this.tag === "document" || Boolean(this.parent?.isConnected); }
  get offsetHeight() { return 650; }
  get validity() { return { valid: (!this.required || Boolean(this.value)) && (this.type !== "email" || /^[^\s@]+@[^\s@]+$/.test(this.value.trim())) }; }
  focus() { if (this.owner) this.owner.activeElement = this; }
  getBoundingClientRect() { return { left: 20, right: 80, top: 700 }; }
  removeAttribute(key) { this.attributes.delete(key); }
  matches(selector) {
    if (selector.startsWith(".")) return this.className.split(/\s+/).includes(selector.slice(1));
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    if (selector === "[data-auth-launcher]") return this.launcher === true;
    if (selector === 'input[type="email"]') return this.tag === "input" && this.type === "email";
    if (selector === "dialog[open]") return this.tag === "dialog" && this.open;
    return this.tag === selector;
  }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [
      ...(selector.split(",").some((value) => child.matches(value.trim())) ? [child] : []), ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  reportValidity() { return this.querySelectorAll("input, select").every((control) => control.disabled || !control.required || Boolean(control.value.trim())); }
  addEventListener(type, callback) { const list = this.listeners.get(type) || []; list.push(callback); this.listeners.set(type, list); }
  dispatchEvent(event) { for (const handler of this.listeners.get(event.type) || []) handler(event); return true; }
  async fire(type) {
    if (this.disabled) return;
    const event = { type, target: this, preventDefault() {}, stopPropagation() { this.stopped = true; } };
    const pending = [];
    let current = this;
    do {
      for (const handler of current.listeners.get(type) || []) pending.push(handler(event));
      current = event.stopped ? null : current.parent;
    } while (current);
    await Promise.all(pending);
    await tick();
  }
  click() { return this.fire("click"); }
}

async function fixture({ rows = [demoRow], actor = "actor-a", listWait, activation, failList = false, failCreate = false, missingRpc = false, authUI = false, onReady, storage = new Map(), immediateSignup = false } = {}) {
  const document = new Element("document");
  document.createElement = (tag) => { const element = new Element(tag); element.owner = document; return element; };
  document.createElementNS = (_ns, tag) => document.createElement(tag);
  document.getElementById = (id) => document.querySelectorAll("div").find((node) => node.id === id) ?? null;
  document.documentElement = new Element("html");
  const shell = new Element(); shell.className = "sf-app-shell";
  const sidebar = new Element(); sidebar.className = "sf-sidebar";
  const nav = new Element("nav"); nav.className = "sf-nav";
  const launcher = new Element("button"); launcher.launcher = true;
  const sidebarToggle = new Element("button"); sidebarToggle.className = "sf-sidebar-toggle";
  sidebar.append(sidebarToggle, nav, launcher);
  const main = new Element("main"); main.className = "sf-main-content";
  document.body = new Element("body"); document.append(document.body); document.body.append(shell); shell.append(sidebar, main);
  for (const className of ["sf-sidebar-account-label", "sf-button-icon"]) {
    const span = new Element("span"); span.className = className; launcher.append(span);
  }
  const window = new Element("window");
  window.innerWidth = 1200; window.innerHeight = 900;
  const calls = { requests: [], activated: [], prepare: 0, portfolio: 0, createProject: 0, import: 0, launcher: 0 };
  launcher.addEventListener("click", () => calls.launcher++);
  const backend = { rows: [...rows], failList, failCreate, listWait, missingRpc };
  const context = vm.createContext({ document, window, URL, AbortController, setTimeout, clearTimeout,
    CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    fetch: async (url, options) => {
      calls.requests.push({ url, options });
      const create = url.endsWith("/create_workspace");
      if (!create && backend.listWait) await backend.listWait;
      if (!create && backend.missingRpc) return { ok: false, status: 404, json: async () => ({ code: "PGRST202" }) };
      if (create ? backend.failCreate : backend.failList) return { ok: false, status: 503 };
      if (!create) return { ok: true, json: async () => backend.rows };
      const body = JSON.parse(options.body);
      const row = { ...privateRow, organization_name: body.p_name, industry: body.p_industry, organization_currency: body.p_currency };
      backend.rows.push(row);
      return { ok: true, json: async () => row };
    },
  });
  const cache = new Map();
  const pending = new Map();
  function load(name) {
    if (pending.has(name)) return pending.get(name);
    const operation = (async () => {
      const values = name === "auth-service.js" ? { getCurrentUser: () => actor ? { id: actor, email: "fixture@example.invalid" } : null,
        isAuthenticated: () => Boolean(actor), getValidAccessToken: async () => actor ? "mock-token" : null,
        signIn: async () => { actor = "actor-a"; }, signOut: async () => { actor = null; },
        signUp: async () => { if (immediateSignup) { actor = "actor-a"; return { session: { user: { id: actor } } }; } return { needsEmailVerification: true }; } }
        : name === "profile-identity.js" ? { profileDisplayName: () => "Account", profileInitials: () => "?" }
        : name === "supabase-config.js" ? { SUPABASE_URL: "https://fixture.invalid", SUPABASE_PUBLISHABLE_KEY: "mock-key" } : null;
      const module = values ? new vm.SyntheticModule(Object.keys(values), function () {
        for (const [key, value] of Object.entries(values)) this.setExport(key, value);
      }, { context }) : new vm.SourceTextModule(await readFile(new URL(name, js), "utf8"), { context, identifier: name });
      cache.set(name, module);
      await module.link((specifier) => load(specifier.replace(/^\.\//, "")));
      return module;
    })();
    pending.set(name, operation);
    return operation;
  }
  const module = await load("workspace-ui.js"); await module.evaluate();
  if (authUI) { const auth = await load("auth-ui.js"); await auth.evaluate(); auth.namespace.initAuthUI(); }
  const workspace = cache.get("workspace-context.js").namespace;
  let ui;
  sidebarToggle.addEventListener("click", () => { shell.classList.toggle("sf-sidebar-collapsed"); ui.syncSidebar(); });
  ui = module.namespace.initWorkspaceUI({
    onPrepare() { calls.prepare++; },
    async onWorkspace(value) { calls.activated.push(value); await activation?.(value); ui?.render("portfolio", value.isDemo ? 2 : 0); },
    onPortfolio() { calls.portfolio++; }, onCreateProject() { calls.createProject++; }, onImport() { calls.import++; },
    onReady,
  });
  const gate = main.querySelector(".sf-workspace-gate");
  const empty = main.querySelector(".sf-workspace-empty");
  return { ui, workspace, calls, document, window, main, sidebar, shell, sidebarToggle, backend, gate, empty, storage,
    get select() { return sidebar.querySelector("select"); }, form: gate.querySelector("form"), badge: sidebar.querySelector(".sf-workspace-demo"),
    button: (text, root = gate) => root.querySelectorAll("button").find((button) => button.textContent === text),
    field: (name) => gate.querySelectorAll("input, select").find((input) => input.name === name),
    async actor(value) { actor = value; await window.fire("auth:changed"); },
    async choose(id) { this.select.value = id; await this.select.fire("change"); await new Promise((resolve) => setTimeout(resolve, 10)); },
  };
}

test("signed-out Create Workspace uses existing auth and resumes only the explicit form after sign-in", async () => {
  const f = await fixture({ actor: null, rows: [privateRow, demoRow], authUI: true });
  await f.ui.ready;
  assert.equal(f.sidebar.querySelector(".sf-workspace-create"), null);
  assert.equal(f.select.children.at(-1).textContent, "+ Create Workspace");
  await f.choose("__create");
  assert.equal(f.select.value, demoId);
  const panel = f.document.querySelector(".sf-auth-panel");
  assert.equal(panel.hidden, false);
  assert.equal(f.storage.get("steerfold-auth-intent"), "create-workspace");
  await f.choose("__create");
  assert.equal(panel.hidden, false, "A repeated CTA does not toggle auth closed");
  panel.querySelectorAll("input").find((input) => input.name === "email").value = "fixture@example.invalid";
  panel.querySelectorAll("input").find((input) => input.name === "password").value = "synthetic-password";
  await panel.querySelector("form").fire("submit");
  await tick(); await tick();
  assert.equal(f.gate.hidden, false);
  assert.equal(f.form.hidden, false);
  assert.equal(f.sidebar.querySelector(".sf-workspace-create"), null);
  assert.equal(f.select.value, privateId, "Creation does not replace the active workspace with a placeholder");
  assert.equal(f.document.activeElement, f.field("name"));
  assert.equal(f.storage.has("steerfold-auth-intent"), false);
  assert.equal(f.calls.requests.filter(({url}) => url.endsWith("/create_workspace")).length, 0);
  f.field("name").value = "Explicit Company"; f.field("currency").value = "GBP";
  await f.form.fire("submit");
  const writes = f.calls.requests.filter(({url}) => url.endsWith("/create_workspace"));
  assert.equal(writes.length, 1);
  assert.equal(JSON.parse(writes[0].options.body).p_currency, "GBP");
});

test("native select change followed by click keeps Create Workspace authentication open", async () => {
  const f = await fixture({ actor: null, rows: [privateRow, demoRow], authUI: true });
  await f.ui.ready;
  f.select.value = "__create";
  // Native pointer selection can deliver click after input/change, unlike selectOption().
  f.select.dispatchEvent({ type: "input", target: f.select, stopPropagation() {} });
  f.select.dispatchEvent({ type: "change", target: f.select, stopPropagation() {} });
  f.document.dispatchEvent({ type: "click", target: f.select });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(f.document.querySelector(".sf-auth-panel").hidden, false);
  assert.equal(f.storage.get("steerfold-auth-intent"), "create-workspace");
  assert.equal(f.select.value, demoId);
  f.document.dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(f.document.querySelector(".sf-auth-panel").hidden, true);
  f.ui.render("portfolio", 11);
  await f.choose("__create");
  assert.equal(f.document.querySelector(".sf-auth-panel").hidden, false);
  assert.equal(f.select.value, demoId);
});

test("authenticated native action survives re-render and can reopen after leaving creation without auth", async () => {
  const f = await fixture({ rows: [privateRow, demoRow], authUI: true });
  await f.ui.ready;
  for (let attempt = 0; attempt < 2; attempt++) {
    f.ui.render("portfolio", 11);
    await f.choose("__create");
    assert.equal(f.form.hidden, false);
    assert.equal(f.gate.hidden, false);
    assert.equal(f.select.value, privateId);
    assert.equal(f.calls.launcher, 0);
    assert.equal(f.document.querySelector(".sf-auth-panel").hidden, true);
    await f.choose(demoId);
    assert.equal(f.gate.hidden, true);
    await f.choose(privateId);
  }
  assert.equal(f.calls.requests.some(({ url }) => url.endsWith("/create_workspace")), false);
});

test("a queued native action cannot open UI after the actor changes", async () => {
  const f = await fixture({ actor: null, rows: [demoRow], authUI: true });
  await f.ui.ready;
  f.select.value = "__create";
  f.select.dispatchEvent({ type: "change" });
  await f.actor("actor-a");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(f.document.querySelector(".sf-auth-panel").hidden, true);
  assert.equal(f.form.hidden, false, "The new session resumes its existing intent once");
  assert.equal(f.calls.launcher, 0);
});

for (const immediateSignup of [false, true]) {
  test(`Create Workspace intent survives ${immediateSignup ? "immediate signup" : "email verification and a fresh authenticated page"}`, async () => {
    const storage = new Map();
    const f = await fixture({ actor: null, rows: [demoRow], authUI: true, immediateSignup, storage });
    await f.ui.ready; await f.choose("__create");
    const panel = f.document.querySelector(".sf-auth-panel");
    await f.button("Sign Up",panel).click();
    for (const [name,value] of Object.entries({fullName:"Taylor Shah",email:"fixture@example.invalid",password:"synthetic-password",confirmPassword:"synthetic-password"})) {
      panel.querySelectorAll("input").find((input) => input.name === name).value = value;
    }
    await panel.querySelector("form").fire("submit"); await tick(); await tick();
    if (immediateSignup) {
      assert.equal(f.form.hidden,false); assert.equal(f.gate.hidden,false);
      assert.equal(storage.has("steerfold-auth-intent"),false);
    } else {
      assert.equal(storage.get("steerfold-auth-intent"),"create-workspace");
      assert.equal(f.workspace.getActiveWorkspace().isDemo,true);
      const next = await fixture({ actor:"actor-a",rows:[privateRow,demoRow],storage });
      await next.ui.ready;
      assert.equal(next.gate.hidden,false); assert.equal(next.form.hidden,false);
      assert.equal(next.document.activeElement,next.field("name"));
      assert.equal(storage.has("steerfold-auth-intent"),false);
      assert.equal(next.calls.requests.filter(({url}) => url.endsWith("/create_workspace")).length,0);
    }
    assert.equal(f.calls.requests.filter(({url}) => url.endsWith("/create_workspace")).length,0);
  });
}

test("Create Workspace auth intent remains available through a discovery failure and retry", async () => {
  const f = await fixture({ actor:null,authUI:true });
  await f.ui.ready; await f.choose("__create");
  assert.equal(f.document.querySelector(".sf-auth-panel").hidden,false);
  f.backend.missingRpc=true;
  await f.actor("actor-a");
  assert.equal(f.storage.get("steerfold-auth-intent"),"create-workspace");
  assert.equal(f.form.hidden,true);
  f.backend.missingRpc=false; await f.ui.reload();
  assert.equal(f.form.hidden,false);
  assert.equal(f.storage.has("steerfold-auth-intent"),false);
  assert.equal(f.calls.requests.filter(({url}) => url.endsWith("/create_workspace")).length,0);
});

test("authenticated Create Workspace selector opens the form even from Account", async () => {
  const f=await fixture({rows:[privateRow,demoRow]}); await f.ui.ready;
  f.ui.render("account"); await f.choose("__create");
  assert.equal(f.gate.hidden,false); assert.equal(f.form.hidden,false);
  assert.equal(f.select.value,privateId);
  assert.equal(f.select.children.at(-1).textContent,"+ Create Workspace");
  assert.equal(f.calls.portfolio,1);
  assert.equal(f.calls.requests.filter(({url}) => url.endsWith("/create_workspace")).length,0);
});

test("signed-out selector renders the discovered Brisk & Zip Demo exactly once without private choices", async () => {
  const demo = { ...demoRow, organization_name: "Brisk & Zip" };
  const f = await fixture({ actor: null, rows: [privateRow, demo] });
  await f.ui.ready;
  assert.deepEqual(f.select.children.map((option) => [option.value, option.textContent]), [[demoId, "Brisk & Zip"], ["__create", "+ Create Workspace"]]);
  assert.equal(f.badge.textContent, "Demo Workspace · Read-only");
  assert.equal(f.badge.hidden, false);
  assert.equal(f.select.value, demoId);
});

test("signed-in discovery has one option per real workspace and sign-out removes private choices", async () => {
  const f = await fixture({ rows: [{ ...privateRow, organization_name: "Duro Logistic" }, { ...demoRow, organization_name: "Brisk & Zip" }] });
  await f.ui.ready;
  assert.deepEqual(f.select.children.filter((option) => option.value !== "__create").map((option) => option.value), [privateId, demoId]);
  assert.equal(f.select.children[0].textContent, "Duro Logistic");
  assert.equal(f.select.children.at(-1).textContent, "+ Create Workspace");
  await f.choose(demoId);
  assert.equal(f.select.value, demoId);
  assert.equal(f.select.children.filter((option) => option.textContent === "Brisk & Zip").length, 1);
  await f.actor(null);
  assert.deepEqual(f.select.children.map((option) => option.value), [demoId, "__create"]);
  assert.equal(f.select.children.some((option) => option.textContent === "Duro Logistic"), false);
  assert.equal(f.workspace.getActiveWorkspace().id, demoId);
});

test("collapsed workspace uses an accessible square icon, expands to the picker, and preserves mobile selection", async () => {
  const f = await fixture({ rows: [privateRow, demoRow] });
  await f.ui.ready;
  await f.sidebarToggle.click();
  const compact = f.sidebar.querySelector(".sf-workspace-compact");
  assert.equal(f.select, null, "No native select control remains in the collapsed sidebar DOM");
  assert.equal(compact.getAttribute("aria-label"), "Choose workspace: Private Company");
  assert.equal(compact.title, "Private Company");
  assert.equal(compact.querySelector("svg").getAttribute("aria-hidden"), "true");
  await compact.click();
  assert.equal(f.shell.classList.contains("sf-sidebar-collapsed"), false);
  assert.equal(f.select.value, privateId);
  assert.equal(f.document.activeElement, f.select);
  await f.choose(demoId);
  await f.sidebarToggle.click();
  assert.equal(compact.getAttribute("aria-label"), "Choose workspace: Demo");
  f.window.innerWidth = 390;
  await f.window.fire("resize");
  assert.equal(f.sidebar.querySelector(".sf-workspace-compact"), null);
  assert.equal(f.select.value, demoId, "Mobile drawer retains the full real picker");
});

test("collapsed unavailable workspace stays disabled and reload recovery activates its icon", async () => {
  const f = await fixture({ actor: null, missingRpc: true });
  await f.ui.ready;
  await f.sidebarToggle.click();
  const compact = f.sidebar.querySelector(".sf-workspace-compact");
  assert.equal(compact.disabled, true);
  assert.equal(compact.getAttribute("aria-label"), "Workspace unavailable");
  f.backend.missingRpc = false;
  await f.ui.reload();
  assert.equal(compact.disabled, false);
  assert.equal(f.select, null);
  await compact.click();
  assert.equal(f.select.value, demoId);
});

test("mobile CSS overrides the collapsed desktop grid without changing print styling", async () => {
  const css = await readFile(new URL("../app/styles.css", import.meta.url), "utf8");
  assert.match(css, /@media \(max-width: 820px\) \{\s*\.sf-app-shell,\s*\.sf-app-shell\.sf-sidebar-collapsed \{\s*grid-template-columns: 1fr;/);
  assert.match(css, /@media print/);
  assert.match(css, /\.sf-workspace-compact[^}]*width: 40px;[^}]*height: 40px;/);
});

test("initial loading gates portfolio and disables workspace actions until list resolves", async () => {
  const wait = deferred();
  const f = await fixture({ listWait: wait.promise });
  assert.equal(f.document.documentElement.dataset.workspaceBlocked, "true");
  assert.equal(f.gate.hidden, false);
  assert.equal(f.gate.querySelector("h2").textContent, "Loading workspaces...");
  assert.equal(f.form.hidden, true);
  assert.equal(f.select.disabled, true);
  assert.equal(f.button("Reloading...").disabled, true);
  assert.equal(f.button("Explore Demo Workspace").disabled, true);
  assert.equal(f.calls.activated.length, 0);
  wait.resolve(); await f.ui.ready;
  assert.equal(f.gate.querySelector("h2").textContent, "Create your workspace");
  assert.equal(f.form.hidden, false);
  assert.equal(f.workspace.getActiveWorkspace(), null);
  assert.equal(f.badge.hidden, true);
  assert.equal(f.empty.hidden, true);
  assert.equal(f.calls.activated.length, 0);
});

test("membership-free Account access bypasses workspace gate and returning to portfolio restores it", async () => {
  const f = await fixture(); await f.ui.ready;
  assert.equal(f.ui.render("account", 0), false);
  assert.equal(f.document.documentElement.dataset.workspaceBlocked, "false");
  assert.equal(f.gate.hidden, true);
  assert.equal(f.empty.hidden, true);
  assert.equal(f.workspace.getActiveWorkspace(), null);
  assert.equal(f.ui.render("portfolio", 0), true);
  assert.equal(f.gate.hidden, false);
  assert.equal(f.document.documentElement.dataset.workspaceBlocked, "true");
});

test("creation requires an explicit currency then activates a private empty workspace once", async () => {
  const f = await fixture(); await f.ui.ready;
  f.field("name").value = " New Company "; f.field("industry").value = " Technology ";
  assert.equal(f.field("currency").value, "");
  await f.form.fire("submit");
  assert.equal(f.calls.requests.length, 1);
  f.field("currency").value = "EUR";
  await f.form.fire("submit");
  assert.equal(f.calls.requests.length, 2);
  assert.deepEqual(JSON.parse(f.calls.requests[1].options.body), { p_name: "New Company", p_industry: "Technology", p_currency: "EUR" });
  assert.equal(f.workspace.getActiveWorkspace().currency, "EUR");
  assert.equal(f.workspace.getActiveWorkspace().isDemo, false);
  assert.equal(f.calls.activated.length, 1);
  assert.equal(f.calls.portfolio, 1);
  assert.equal(f.gate.hidden, true);
  assert.equal(f.empty.hidden, false);
  assert.equal(f.document.documentElement.dataset.workspaceEmpty, "true");
  await f.button("Create Project", f.empty).click();
  await f.button("Import Projects", f.empty).click();
  assert.equal(f.calls.createProject, 1); assert.equal(f.calls.import, 1);
});

test("workspace list failure stays visibly gated and Reload recovers without selecting demo for a new user", async () => {
  const f = await fixture({ failList: true }); await f.ui.ready;
  assert.equal(f.gate.querySelector("h2").textContent, "Workspace unavailable");
  assert.ok(f.gate.querySelectorAll("p").some((element) => /not available yet/.test(element.textContent)));
  assert.equal(f.form.hidden, true);
  assert.equal(f.document.documentElement.dataset.workspaceBlocked, "true");
  assert.equal(f.empty.hidden, true);
  assert.equal(f.calls.activated.length, 0);
  f.backend.failList = false;
  await f.button("Reload Workspaces").click();
  assert.equal(f.form.hidden, false);
  assert.equal(f.workspace.getActiveWorkspace(), null);
  assert.equal(f.gate.hidden, false);
});

test("missing workspace RPC disables selector and Demo with explicit setup feedback", async () => {
  const f = await fixture({ actor: null, missingRpc: true }); await f.ui.ready;
  assert.equal(f.select.disabled, true);
  assert.equal(f.select.getAttribute("aria-disabled"), "true");
  assert.equal(f.select.children[0].textContent, "Workspace unavailable");
  assert.equal(f.select.getAttribute("aria-label"), "Workspace unavailable");
  assert.match(f.gate.querySelectorAll("p").map((row) => row.textContent).join("\n"), /Workspace setup is not enabled on this environment yet/);
  assert.equal(f.button("Explore Demo Workspace").disabled, true);
  assert.match(f.gate.querySelector("#sf-workspace-demo-status").textContent, /after workspace setup is enabled/);
  await f.button("Explore Demo Workspace").click();
  assert.equal(f.calls.activated.length, 0);
  assert.equal(f.calls.requests.length, 1);
  assert.ok(f.calls.requests.every(({ url }) => url.endsWith("/list_my_workspaces")), "no legacy reads or CSV fallback");
});

test("retry is single-flight, visibly loading, fails visibly and enables real discovery on recovery", async () => {
  const f = await fixture({ actor: null, missingRpc: true }); await f.ui.ready;
  const wait = deferred(); f.backend.listWait = wait.promise;
  const retry = f.button("Reload Workspaces");
  const pending = retry.click(); await tick();
  assert.equal(retry.textContent, "Reloading..."); assert.equal(retry.disabled, true);
  await retry.click(); await f.ui.reload();
  assert.equal(f.calls.requests.length, 2);
  wait.resolve(); await pending;
  assert.equal(retry.disabled, false);
  assert.match(f.gate.querySelectorAll("p").map((row) => row.textContent).join("\n"), /not enabled/);
  f.backend.listWait = null; f.backend.missingRpc = false;
  await retry.click();
  assert.equal(f.calls.requests.length, 3);
  assert.equal(f.select.disabled, false);
  assert.equal(f.select.getAttribute("aria-disabled"), "false");
  assert.equal(f.workspace.getActiveWorkspace().id, demoId);
  assert.equal(f.select.value, demoId);
  assert.equal(f.gate.hidden, true);
  assert.equal(f.button("Explore Demo Workspace").disabled, false);
  assert.equal(f.calls.activated.length, 1);
});

test("real auth panel and Sign Up remain open despite missing workspace RPC and bubbling clicks", async () => {
  const f = await fixture({ actor: null, missingRpc: true, authUI: true }); await f.ui.ready;
  const panel = f.document.getElementById("sf-auth-panel");
  assert.equal(panel.hidden, true);
  await f.button("Sign In / Sign Up").click();
  assert.equal(panel.hidden, false, "outside-click handler must not immediately close auth");
  assert.equal(panel.querySelector("h2").textContent, "Sign In");
  await f.button("Sign Up", panel).click();
  assert.equal(panel.hidden, false);
  assert.equal(panel.querySelector("h2").textContent, "Sign Up");
  assert.ok(panel.querySelectorAll("input").some((input) => input.name === "fullName"));
  await f.button("Return to Sign In", panel).click();
  assert.equal(panel.hidden, false);
  assert.equal(panel.querySelector("h2").textContent, "Sign In");
  await f.document.fire("click");
  assert.equal(panel.hidden, true);
  await f.document.querySelector("[data-auth-launcher]").click();
  assert.equal(panel.hidden, false, "sidebar launcher works without workspace discovery");
  assert.equal(f.calls.requests.length, 1, "opening auth must not depend on or repeat workspace discovery");
});

test("successful selection resumes a pending route instead of forcing Portfolio", async () => {
  let resumes = 0;
  const f = await fixture({ onReady: () => { resumes++; return true; } }); await f.ui.ready;
  await f.button("Explore Demo Workspace").click();
  assert.equal(f.workspace.getActiveWorkspace().id, demoId);
  assert.equal(resumes, 1);
  assert.equal(f.calls.portfolio, 0);
});

test("uncertain creation exposes error, prevents duplicate writes and requires reload before retry", async () => {
  const f = await fixture({ failCreate: true }); await f.ui.ready;
  f.field("name").value = "Company"; f.field("currency").value = "USD";
  await f.form.fire("submit");
  assert.equal(f.gate.hidden, false);
  assert.equal(f.form.hidden, true);
  assert.ok(f.gate.querySelectorAll("p").some((element) => /Reload workspaces to check whether creation succeeded/.test(element.textContent)));
  assert.equal(f.calls.activated.length, 0);
  await f.form.fire("submit");
  assert.equal(f.calls.requests.filter(({ url }) => url.endsWith("create_workspace")).length, 1);
  f.backend.failCreate = false;
  await f.button("Reload Workspaces").click();
  assert.equal(f.form.querySelector("button").disabled, false);
  await f.form.fire("submit");
  assert.equal(f.calls.requests.filter(({ url }) => url.endsWith("create_workspace")).length, 2);
  assert.equal(f.empty.hidden, false);
});

test("switching private empty to demo and back preserves empty state and demo badge", async () => {
  const f = await fixture({ rows: [demoRow, privateRow] }); await f.ui.ready;
  assert.equal(f.workspace.getActiveWorkspace().id, privateId);
  assert.equal(f.empty.hidden, false);
  await f.button("Explore Demo Workspace", f.empty).click();
  assert.equal(f.workspace.getActiveWorkspace().id, demoId);
  assert.equal(f.badge.hidden, false); assert.equal(f.empty.hidden, true);
  await f.choose(privateId);
  assert.equal(f.workspace.getActiveWorkspace().id, privateId);
  assert.equal(f.badge.hidden, true); assert.equal(f.empty.hidden, false);
  assert.deepEqual(f.calls.activated.map((value) => value.id), [privateId, demoId, privateId]);
  assert.equal(f.calls.portfolio, 2);
});

test("portfolio refresh updates empty gate for zero, populated and zero project counts", async () => {
  const f = await fixture({ rows: [privateRow, demoRow] }); await f.ui.ready;
  assert.equal(f.empty.hidden, false);
  assert.equal(f.ui.render("portfolio", 1), false);
  assert.equal(f.empty.hidden, true);
  assert.equal(f.document.documentElement.dataset.workspaceEmpty, "false");
  f.ui.render("portfolio", 0);
  assert.equal(f.empty.hidden, false);
  f.ui.render("projects", 0);
  assert.equal(f.empty.hidden, true);
});

test("activation failure leaves portfolio gated despite a selected workspace", async () => {
  const f = await fixture({ rows: [privateRow, demoRow], activation: async () => { throw new Error("Portfolio could not be verified"); } });
  await f.ui.ready;
  assert.equal(f.workspace.getActiveWorkspace().id, privateId);
  assert.equal(f.gate.hidden, false); assert.equal(f.empty.hidden, true);
  assert.equal(f.gate.querySelector("h2").textContent, "Workspace unavailable");
  assert.ok(f.gate.querySelectorAll("p").some((element) => element.textContent === "Portfolio could not be verified"));
  assert.equal(f.ui.render("portfolio", 0), true);
  assert.equal(f.ui.render("account", 0), false);
});

test("late activation failure from an old session cannot replace a new actor's setup gate", async () => {
  const wait = deferred();
  const f = await fixture({ rows: [privateRow, demoRow], activation: () => wait.promise });
  await tick();
  assert.equal(f.calls.activated.length, 1);
  f.backend.rows = [demoRow];
  await f.actor("actor-b");
  assert.equal(f.workspace.getActiveWorkspace(), null);
  wait.reject(new Error("Old actor failure"));
  await f.ui.ready;
  assert.equal(f.gate.querySelector("h2").textContent, "Create your workspace");
  assert.equal(f.form.hidden, false);
  assert.equal(f.document.documentElement.dataset.workspaceBlocked, "true");
  assert.equal(f.calls.portfolio, 0);
});

test("open project dialogs block switching and signed-out gates can open real auth launcher", async () => {
  const f = await fixture({ rows: [privateRow, demoRow] }); await f.ui.ready;
  const dialog = new Element("dialog"); dialog.open = true; f.document.append(dialog);
  await f.choose(demoId);
  assert.equal(f.workspace.getActiveWorkspace().id, privateId);
  assert.match(f.sidebar.querySelector(".sf-workspace-switch-status").textContent, /Close or resolve/);
  assert.equal(f.calls.activated.length, 1);
  f.backend.rows = []; await f.actor(null);
  await f.button("Sign In / Sign Up").click();
  assert.equal(f.calls.launcher, 1);
  assert.equal(f.form.hidden, true);
});

test("a late switch failure cannot override a newer successful reload", async () => {
  const wait = deferred();
  const f = await fixture({ rows: [privateRow, demoRow], activation: (workspace) => workspace.isDemo ? wait.promise : undefined });
  await f.ui.ready;
  await f.choose(demoId);
  assert.equal(f.select.disabled, true);
  assert.equal(f.document.documentElement.dataset.workspaceBlocked, "true");
  f.backend.rows = [privateRow];
  await f.ui.reload();
  assert.equal(f.workspace.getActiveWorkspace().id, privateId);
  assert.equal(f.empty.hidden, false);
  wait.reject(new Error("Stale demo load failed"));
  await tick();
  assert.equal(f.gate.hidden, true);
  assert.equal(f.empty.hidden, false);
  assert.equal(f.select.disabled, false);
  assert.equal(f.document.documentElement.dataset.workspaceBlocked, "false");
  assert.equal(f.calls.portfolio, 0);
  assert.deepEqual(f.calls.activated.map((workspace) => workspace.id), [privateId, demoId, privateId]);
});

async function application(f, { projects = [] } = {}) {
  const source = await readFile(new URL("app.js", js), "utf8");
  const route = { view: "portfolio" };
  const overrides = {
    loadPortfolioData: async () => projects,
    getLastPortfolioDataSource: () => "supabase",
    getWorkspaceRevision: f.workspace.getWorkspaceRevision,
    getCurrentRoute: () => route,
    renderScenarioAnalysis() {}, renderGovernanceView() {}, initGovernanceWorkflow() {},
  };
  const context = vm.createContext({ document: f.document });
  // Expose the app only inside this test VM; production source remains intact.
  const module = new vm.SourceTextModule(`${source}\nexport { SteerfoldApp };`, { context });
  const imports = new Map();
  for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)) {
    imports.set(match[2], match[1].split(",").map((name) => name.trim()).filter(Boolean));
  }
  await module.link((specifier) => {
    const names = imports.get(specifier);
    assert.ok(names, `Unsupported app dependency: ${specifier}`);
    return new vm.SyntheticModule(names, function () {
      for (const name of names) this.setExport(name, overrides[name] ?? (() => { throw new Error(`Unexpected app dependency call: ${name}`); }));
    }, { context });
  });
  await module.evaluate();
  const app = module.namespace.SteerfoldApp;
  app.workspaceUI = f.ui;
  app.exportControl = new Element(); app.helpButton = new Element(); app.calculatorButton = new Element();
  return { app, route };
}

test("actual app sidebar toggle synchronizes the workspace control without changing its active ID", async () => {
  const f = await fixture({ rows: [privateRow, demoRow] }); await f.ui.ready;
  const { app } = await application(f);
  app.appShell = f.shell;
  app.sidebarToggle = f.sidebarToggle;
  app.toggleSidebar();
  assert.equal(f.select, null);
  assert.ok(f.sidebar.querySelector(".sf-workspace-compact"));
  app.toggleSidebar();
  assert.equal(f.select.value, privateId);
  assert.equal(f.workspace.getActiveWorkspace().id, privateId);
});

test("actual app header actions refresh workspace visibility using current project count", async () => {
  const f = await fixture({ rows: [privateRow] }); await f.ui.ready;
  const { app } = await application(f);
  app.state.projects = [{ projectId: "P001" }];
  app.updateHeaderActionsForView("portfolio");
  assert.equal(f.empty.hidden, true);
  assert.equal(f.document.documentElement.dataset.workspaceEmpty, "false");
  app.state.projects = [];
  app.updateHeaderActionsForView("portfolio");
  assert.equal(f.empty.hidden, false);
  app.updateHeaderActionsForView("account");
  assert.equal(f.empty.hidden, true);
  assert.equal(f.document.documentElement.dataset.workspaceBlocked, "false");
});

test("actual app dashboard refresh removes stale private empty-state visibility", async () => {
  const f = await fixture({ rows: [privateRow] }); await f.ui.ready;
  assert.equal(f.empty.hidden, false, "private empty state before app evaluation");
  const { app } = await application(f, { projects: [{ projectId: "P001" }] });
  const calls = [];
  for (const name of ["renderTableMessage", "refreshExplorerOptions", "setDataSourceNoticeVisibility", "renderKpis", "renderFinancialPerformance",
    "renderPortfolioAnalysis", "renderPortfolioIntelligence", "renderBudgetKpis", "renderEvmPerformance", "renderProjectVariance",
    "renderForecastingKpis", "renderPortfolioForecast", "renderProjectForecastAnalysis", "renderDecisionSupportKpis",
    "renderPriorityRecommendations", "renderDecisionFactors", "applyFilters"]) app[name] = () => {};
  app.createDelayedLoader = () => ({ hide: async () => calls.push("hide") });
  app.showPortfolioView = () => app.updateHeaderActionsForView("portfolio");
  assert.equal(f.empty.hidden, false, "app setup preserves private empty state");
  await app.loadDashboard({ allowCsvFallback: false });
  assert.equal(app.state.projects.length, 1);
  assert.equal(f.empty.hidden, true);
  assert.equal(f.document.documentElement.dataset.workspaceEmpty, "false");
  assert.deepEqual(calls, ["hide"]);
});

test("actual app Account route remains accessible to an actor without workspace membership", async () => {
  const f = await fixture(); await f.ui.ready;
  const { app, route } = await application(f);
  route.view = "account";
  app.pageTitle = new Element(); app.pageSubtitle = new Element();
  app.portfolioOverviewViews = []; app.projectsViews = []; app.navLinks = [];
  app.mainArea = new Element(); app.accountView = new Element(); app.settingsView = new Element();
  app.setDefaultPageHeaderContext = () => {};
  app.setPortfolioContextVisibility = () => {};
  app.renderProjectsPageActions = () => {};
  app.renderRouteFromUrl();
  assert.equal(app.pageTitle.textContent, "Account");
  assert.equal(app.accountView.hidden, false);
  assert.equal(app.settingsView.hidden, true);
  assert.equal(f.gate.hidden, true);
  assert.equal(f.document.documentElement.dataset.workspaceBlocked, "false");
  assert.equal(f.workspace.getActiveWorkspace(), null);
});
