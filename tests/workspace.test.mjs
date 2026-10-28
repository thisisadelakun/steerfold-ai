import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const js = new URL("../app/js/", import.meta.url);
const id = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const demoId = "33333333-3333-4333-8333-333333333333";
const row = (value = {}) => ({ id, organization_name: "New Company", industry: "Technology",
  organization_currency: "EUR", is_demo: false, can_write: true, ...value });
const demo = row({ id: demoId, organization_name: "Demo", is_demo: true, can_write: false });

async function fixture({ actor = "actor-a", rows = [], storage = new Map(), respond, tokenHook } = {}) {
  const requests = [];
  const context = vm.createContext({ URL, AbortController, setTimeout, clearTimeout, console,
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    fetch: async (url, options = {}) => {
      const request = { url: String(url), options };
      requests.push(request);
      if (respond) { const response = await respond(request); if (response) return response; }
      if (request.url.endsWith("/list_my_workspaces")) return { ok: true, json: async () => rows };
      if (request.url.endsWith("/create_workspace")) {
        const body = JSON.parse(options.body);
        return { ok: true, json: async () => row({ organization_name: body.p_name, industry: body.p_industry, organization_currency: body.p_currency }) };
      }
      if (new URL(url).pathname === "/rest/v1/projects") return { ok: true, json: async () => [] };
      throw new Error(`Unexpected request (live network forbidden): ${url}`);
    },
  });
  const modules = new Map();
  async function load(name) {
    if (modules.has(name)) return modules.get(name);
    const values = name === "auth-service.js" ? {
      getCurrentUser: () => actor ? { id: actor } : null,
      getValidAccessToken: async () => { await tokenHook?.(); return actor ? "mock-token" : null; },
    } : name === "supabase-config.js" ? { SUPABASE_URL: "https://fixture.invalid", SUPABASE_PUBLISHABLE_KEY: "mock-key" } : null;
    const module = values ? new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context }) : new vm.SourceTextModule(await readFile(new URL(name, js), "utf8"), { context, identifier: name });
    modules.set(name, module);
    await module.link((specifier) => load(specifier.replace(/^\.\//, "")));
    return module;
  }
  async function api(name) { const module = await load(name); if (module.status !== "evaluated") await module.evaluate(); return module.namespace; }
  return { service: await api("workspace-service.js"), workspace: await api("workspace-context.js"), api,
    requests, storage, setActor(value) { actor = value; } };
}

test("authenticated actors without membership remain null rather than inheriting demo", async () => {
  for (const rows of [[], [demo]]) {
    const f = await fixture({ rows, storage: new Map([["steerfold-workspace:public", demoId]]) });
    const result = await f.service.loadWorkspaces();
    assert.equal(result.workspace, null);
    assert.equal(result.needsSetup, true);
    assert.equal(f.workspace.getActiveWorkspace(), null);
    assert.equal(f.workspace.isDemoWorkspace(), false);
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].options.headers.Authorization, "Bearer mock-token");
    assert.deepEqual(JSON.parse(f.requests[0].options.body), {});
  }
});

test("public visitors explicitly receive only the listed demo default", async () => {
  const f = await fixture({ actor: null, rows: [demo] });
  const result = await f.service.loadWorkspaces();
  assert.equal(result.workspace.id, demoId);
  assert.equal(result.needsSetup, false);
  assert.equal(f.workspace.isDemoWorkspace(), true);
  assert.equal(f.workspace.canWriteWorkspace(), false);
  assert.throws(() => f.workspace.requireWritableWorkspace(), /read-only|unavailable/);
  assert.equal(f.requests[0].options.headers.Authorization, undefined);
});

test("signed-out discovery never exposes private rows or synthesizes a Demo workspace", async () => {
  const f = await fixture({ actor: null, rows: [row(), { ...demo, organization_name: "Brisk & Zip" }] });
  await f.service.loadWorkspaces();
  assert.deepEqual(Array.from(f.service.getWorkspaceChoices(), (workspace) => [workspace.id, workspace.name]), [[demoId, "Brisk & Zip"]]);
  assert.throws(() => f.service.selectWorkspace(id), /not available/);
  const unavailable = await fixture({ actor: null, rows: [] });
  await unavailable.service.loadWorkspaces();
  assert.equal(unavailable.service.getWorkspaceChoices().length, 0);
  assert.equal(unavailable.workspace.getActiveWorkspace(), null);
});

test("signup/new organization requires explicit supported currency and sends exact creation RPC", async () => {
  for (const currency of [undefined, null, "", "usd", "JPY"]) {
    const f = await fixture();
    await assert.rejects(f.service.createWorkspace({ name: "New Company", currency }), /explicitly choose/);
    assert.equal(f.requests.length, 0);
  }
  for (const currency of ["CAD", "USD", "GBP", "EUR"]) {
    const f = await fixture();
    await f.service.loadWorkspaces();
    const created = await f.service.createWorkspace({ name: " New Company ", industry: " Technology ", currency });
    assert.equal(created.currency, currency);
    assert.equal(created.isDemo, false);
    assert.equal(created.canWrite, true);
    assert.equal(f.workspace.getActiveWorkspace(), created);
    assert.equal(f.requests.length, 2);
    assert.match(f.requests[1].url, /\/rpc\/create_workspace$/);
    assert.equal(f.requests[1].options.headers.Authorization, "Bearer mock-token");
    assert.deepEqual(JSON.parse(f.requests[1].options.body), { p_name: "New Company", p_industry: "Technology", p_currency: currency });
    assert.equal(f.storage.get("steerfold-workspace:actor-a"), id);
  }
});

test("signed-out creation and invalid organization fields send no requests", async () => {
  const signedOut = await fixture({ actor: null });
  await assert.rejects(signedOut.service.createWorkspace({ name: "Company", currency: "CAD" }), /Sign in/);
  assert.equal(signedOut.requests.length, 0);
  for (const fields of [{ name: " " }, { name: "x".repeat(121) }, { name: "Company", industry: 3 }]) {
    const f = await fixture();
    await assert.rejects(f.service.createWorkspace({ ...fields, currency: "CAD" }));
    assert.equal(f.requests.length, 0);
  }
});

test("workspace selection persists per actor and signout clears the same context and choices", async () => {
  const rows = [row(), row({ id: otherId }), demo];
  const f = await fixture({ rows });
  await f.service.loadWorkspaces();
  f.service.selectWorkspace(otherId);
  assert.equal(f.storage.get("steerfold-workspace:actor-a"), otherId);
  f.service.resetWorkspaceSession();
  assert.equal(f.workspace.getActiveWorkspace(), null);
  assert.equal(f.service.getWorkspaceChoices().length, 0);
  assert.throws(() => f.workspace.workspaceHeaders());
  f.setActor(null);
  assert.equal((await f.service.loadWorkspaces()).workspace.id, demoId);
  f.service.resetWorkspaceSession();
  f.setActor("actor-b");
  assert.equal((await f.service.loadWorkspaces()).workspace.id, id);
  f.service.selectWorkspace(id);
  f.service.resetWorkspaceSession();
  f.setActor("actor-a");
  assert.equal((await f.service.loadWorkspaces()).workspace.id, otherId);
  assert.equal(f.storage.get("steerfold-workspace:actor-b"), id);
  const fresh = await fixture({ rows, storage: f.storage });
  assert.equal((await fresh.service.loadWorkspaces()).workspace.id, otherId);
});

test("malicious unlisted selections and persisted IDs never grant workspace access", async () => {
  const f = await fixture({ rows: [row()], storage: new Map([["steerfold-workspace:actor-a", otherId]]) });
  await f.service.loadWorkspaces();
  const before = f.workspace.getActiveWorkspace();
  for (const choice of [otherId, "__proto__", "' OR true --", null, { id }]) {
    assert.throws(() => f.service.selectWorkspace(choice), /not available/);
    assert.equal(f.workspace.getActiveWorkspace(), before);
  }
  assert.equal(f.requests.length, 1);
  assert.equal(f.storage.get("steerfold-workspace:actor-a"), otherId);
});

test("no active workspace blocks project reads before fetching anything", async () => {
  const f = await fixture();
  await f.service.loadWorkspaces();
  const data = await f.api("data-service.js");
  await assert.rejects(data.loadPortfolioData({ allowCsvFallback: true }));
  await assert.rejects(data.getProject("P001"));
  assert.equal(f.requests.length, 1);
  assert.equal(data.getLastPortfolioDataSource(), null);
});

test("new empty workspace returns zero projects and missing detail without reading demo CSV", async () => {
  const f = await fixture();
  await f.service.createWorkspace({ name: "Empty Company", currency: "GBP" });
  const data = await f.api("data-service.js");
  assert.equal((await data.loadPortfolioData({ allowCsvFallback: true })).length, 0);
  assert.equal(await data.getProject("P001"), null);
  assert.equal(data.getLastPortfolioDataSource(), "supabase");
  assert.equal(f.requests.length, 3);
  for (const request of f.requests.slice(1)) {
    const url = new URL(request.url);
    assert.equal(url.pathname, "/rest/v1/projects");
    assert.equal(url.searchParams.get("organization_id"), `eq.${id}`);
    assert.equal(request.options.headers["x-steerfold-organization-id"], id);
    assert.equal(request.options.headers.Authorization, "Bearer mock-token");
  }
});

test("non-demo read failures never invoke demo fallback even when explicitly allowed", async () => {
  const f = await fixture({ rows: [row()], respond: ({ url }) => new URL(url).pathname === "/rest/v1/projects" ? { ok: false, status: 503 } : null });
  await f.service.loadWorkspaces();
  const data = await f.api("data-service.js");
  await assert.rejects(data.loadPortfolioData({ allowCsvFallback: true }), /503/);
  await assert.rejects(data.getProject("P001"), /503/);
  assert.equal(f.requests.length, 3);
  assert.ok(f.requests.every(({ url }) => url.startsWith("https://fixture.invalid/rest/v1/")));
  assert.equal(data.getLastPortfolioDataSource(), null);
});

test("late list responses cannot repopulate a reset session or another actor", async () => {
  for (const switchActor of [false, true]) {
    let release;
    let entered;
    const started = new Promise((resolve) => { entered = resolve; });
    const pending = new Promise((resolve) => { release = resolve; });
    const f = await fixture({ respond: async () => { entered(); await pending; return { ok: true, json: async () => [row()] }; } });
    const operation = f.service.loadWorkspaces();
    await started;
    f.service.resetWorkspaceSession();
    if (switchActor) f.setActor("actor-b");
    release();
    await assert.rejects(operation, /changed/);
    assert.equal(f.workspace.getActiveWorkspace(), null);
    assert.equal(f.service.getWorkspaceChoices().length, 0);
  }
});

test("invalid and duplicate workspace responses fail closed", async () => {
  for (const rows of [null, {}, [row({ id: "invalid" })], [row({ organization_currency: "JPY" })], [row({ can_write: "true" })], [row(), row()]]) {
    const f = await fixture({ rows });
    await assert.rejects(f.service.loadWorkspaces(), /verified|Duplicate/);
    assert.equal(f.workspace.getActiveWorkspace(), null);
  }
});

test("demo or read-only creation responses cannot activate a new workspace", async () => {
  for (const saved of [row({ is_demo: true }), row({ can_write: false })]) {
    const f = await fixture({ respond: () => ({ ok: true, json: async () => saved }) });
    await assert.rejects(f.service.createWorkspace({ name: "Company", currency: "EUR" }), /verified/);
    assert.equal(f.workspace.getActiveWorkspace(), null);
    assert.equal(f.storage.size, 0);
    assert.equal(f.requests.length, 1);
  }
});

test("context revisions advance and stale same-ID references are rejected after signout/reset", async () => {
  const f = await fixture({ rows: [row()] });
  await f.service.loadWorkspaces();
  const previous = f.workspace.getActiveWorkspace();
  const revision = f.workspace.getWorkspaceRevision();
  assert.equal(Object.isFrozen(previous), true);
  assert.equal(f.workspace.workspaceHeaders()["x-steerfold-organization-id"], id);
  f.workspace.assertWorkspaceCurrent(previous);
  f.service.resetWorkspaceSession();
  assert.ok(f.workspace.getWorkspaceRevision() > revision);
  await f.service.loadWorkspaces();
  assert.equal(f.workspace.getActiveWorkspace().id, previous.id);
  assert.notEqual(f.workspace.getActiveWorkspace(), previous);
  assert.throws(() => f.workspace.assertWorkspaceCurrent(previous), /Workspace changed/);
});

test("late creation after signout never activates or persists a workspace", async () => {
  let release;
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const pending = new Promise((resolve) => { release = resolve; });
  const f = await fixture({ respond: async () => { entered(); await pending; return { ok: true, json: async () => row() }; } });
  const operation = f.service.createWorkspace({ name: "Company", currency: "EUR" });
  await started;
  f.service.resetWorkspaceSession();
  f.setActor(null);
  release();
  await assert.rejects(operation, /changed/);
  assert.equal(f.workspace.getActiveWorkspace(), null);
  assert.equal(f.service.getWorkspaceChoices().length, 0);
  assert.equal(f.storage.size, 0);
  assert.equal(f.requests.length, 1);
});

test("failed workspace RPCs never retry, activate a workspace, or persist a choice", async () => {
  for (const status of [401, 403, 409, 500]) {
    const f = await fixture({ respond: () => ({ ok: false, status }) });
    const message = status === 401 ? /authentication session/ : /not available yet/;
    await assert.rejects(f.service.loadWorkspaces(), message);
    await assert.rejects(f.service.createWorkspace({ name: "Company", currency: "USD" }), message);
    assert.equal(f.workspace.getActiveWorkspace(), null);
    assert.equal(f.storage.size, 0);
    assert.equal(f.requests.length, 2);
  }
});

test("discovery distinguishes undeployed setup, failed RPC, auth rejection and unreachable Supabase", async () => {
  for (const [status, code, kind] of [[404, "PGRST202", "setup-disabled"], [503, "unavailable", "request-failed"],
    [401, "PGRST301", "auth-unavailable"], [404, "other", "request-failed"]]) {
    const f = await fixture({ respond: () => ({ ok: false, status, json: async () => ({ code }) }) });
    await assert.rejects(f.service.loadWorkspaces(), (error) => error.kind === kind);
    assert.equal(f.workspace.getActiveWorkspace(), null);
    assert.equal(f.requests.length, 1);
  }
  // Throw in the service's own realm, like fetch does in a browser.
  const f = await fixture({ respond: () => Promise.reject(Object.assign(new Error("Offline"), { name: "AbortError" })) });
  await assert.rejects(f.service.loadWorkspaces(), (error) => error.kind === "supabase-unavailable" && /could not be verified/.test(error.message));
  assert.equal(f.requests.length, 1);
});

test("failed session refresh is identified separately without attempting workspace discovery", async () => {
  const f = await fixture({ tokenHook: () => { throw new Error("Session refresh failed"); } });
  await assert.rejects(f.service.loadWorkspaces(), (error) =>
    error.kind === "auth-unavailable" && /authentication session could not be verified/.test(error.message));
  assert.equal(f.requests.length, 0);
  assert.equal(f.workspace.getActiveWorkspace(), null);
  assert.equal(f.service.getWorkspaceChoices().length, 0);
});

test("offline browser backend keeps signup pending, creates empty organizations and blocks all real fetches", async () => {
  const window = new EventTarget();
  const context = vm.createContext({ window, location: { href: "http://127.0.0.1:8772/tests/fixtures/workspace-browser.html" },
    URL, Response, DOMException, CustomEvent, EventTarget });
  const mock = new vm.SourceTextModule(await readFile(new URL("fixtures/workspace-browser-mock.js", import.meta.url), "utf8"), { context });
  await mock.link(() => { throw new Error("Offline backend must have no dependencies"); });
  await mock.evaluate();
  const api = mock.namespace;
  assert.equal(api.getCurrentUser(), null);
  const signup = await api.signUp("fixture@example.invalid", "synthetic-password", "Fixture User");
  assert.equal(signup.needsEmailVerification, true);
  assert.equal(signup.session, null);
  assert.equal(api.isAuthenticated(), false);
  assert.equal(api.state.pendingEmail, "fixture@example.invalid");
  await api.signIn("fixture@example.invalid", "synthetic-password");
  assert.equal(api.isAuthenticated(), true);
  const rpc = (name, body = {}) => window.fetch(`https://fixture.invalid/rest/v1/rpc/${name}`, {
    method: "POST", headers: { Authorization: "Bearer offline-workspace-token" }, body: JSON.stringify(body),
  });
  assert.equal((await (await rpc("list_my_workspaces")).json()).length, 1);
  const saved = await (await rpc("create_workspace", { p_name: "Empty Company", p_industry: "Technology", p_currency: "EUR" })).json();
  assert.equal(saved.is_demo, false);
  assert.equal(saved.organization_currency, "EUR");
  assert.equal((await (await rpc("list_my_workspaces")).json()).length, 2);
  assert.equal(api.state.requests.some(({ path }) => path.includes("projects")), false);
  for (const url of ["https://example.com/", "https://fixture.invalid/rest/v1/projects", "https://fixture.invalid/rest/v1/rpc/unlisted", "/app/js/auth-service.js"]) {
    await assert.rejects(window.fetch(url, { method: "POST" }), /blocked fetch/);
  }
  assert.equal(api.state.calls.blocked, 4);
  window.localStorage.setItem("identity", "fixture-only");
  api.resetFixture();
  assert.equal(window.localStorage.length, 0);
  assert.equal(api.getCurrentUser(), null);
  assert.equal(api.state.rows.length, 1);
});
