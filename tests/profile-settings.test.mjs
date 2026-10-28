import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { profileInitials, profileDisplayName, setProfileIdentity } from "../app/js/profile-identity.js";

const timestamp = "2026-10-26T12:00:00.123456+00:00";
const workspace = { id: "11111111-1111-4111-8111-111111111111", name: "Brisk & Zip", currency: "CAD", industry: "", isDemo: false, canWrite: true };
async function fixture({ signedIn = true, status = 200, changeActor = false, wrongSaveResponse = false, beforeResponse, metadata = new Map(), store = { company: null, profiles: new Map(), clock: 0 } } = {}) {
  const requests = [];
  let actor = signedIn ? "user-a" : null;
  const context = vm.createContext({ AbortController, setTimeout, clearTimeout, Date,
    fetch: async (url, options) => {
      requests.push({ url, options });
      const body = options.body && JSON.parse(options.body);
      if (status === 200 && !wrongSaveResponse && url.includes("save_organization_profile")) store.company = { id: true, organization_name: body.p_name, industry: body.p_industry, updated_at: timestamp };
      if (status === 200 && url.includes("get_my_profile") && !store.profiles.has(actor)) {
        const name = metadata.get(actor)?.full_name;
        if (typeof name === "string" && name.trim().length > 0 && name.trim().length <= 120) {
          store.profiles.set(actor, { user_id: actor, full_name: name.trim(), job_title: "", created_at: timestamp, updated_at: timestamp });
        }
      }
      if (status === 200 && !wrongSaveResponse && url.includes("save_my_profile")) {
        const previous = store.profiles.get(actor);
        store.profiles.set(actor, { user_id: actor, full_name: body.p_full_name, job_title: body.p_job_title,
          created_at: previous?.created_at ?? timestamp, updated_at: new Date(Date.UTC(2026, 9, 26, 12, 0, ++store.clock)).toISOString() });
      }
      const company = store.company || { id: true, organization_name: "Brisk & Zip", industry: "", updated_at: timestamp };
      const personal = store.profiles.get(actor) || { user_id: actor, full_name: "", job_title: "", created_at: null, updated_at: null };
      await beforeResponse?.();
      return { ok: status === 200, status, json: async () => url.includes("get_my_profile") || url.includes("save_my_profile")
        ? personal : url.includes("rpc/") ? company : [company] };
    },
  });
  const code = await readFile(new URL("../app/js/profile-service.js", import.meta.url), "utf8");
  const workspaceModule = new vm.SourceTextModule(await readFile(new URL("../app/js/workspace-context.js", import.meta.url), "utf8"), { context });
  await workspaceModule.link(() => { throw new Error("Unexpected workspace dependency"); });
  await workspaceModule.evaluate();
  workspaceModule.namespace.setActiveWorkspace(workspace);
  const module = new vm.SourceTextModule(code, { context });
  await module.link((name) => {
    if (name.includes("workspace-context")) return workspaceModule;
    const exports = name.includes("auth-service") ? {
      getCurrentUser: () => actor ? { id: actor, user_metadata: { full_name: "Untrusted cached name" } } : null,
      getValidAccessToken: async () => { if (changeActor) actor = "user-b"; return actor ? "fixture-token" : null; },
    } : { SUPABASE_URL: "https://fixture.invalid", SUPABASE_PUBLISHABLE_KEY: "fixture-publishable" };
    return new vm.SyntheticModule(Object.keys(exports), function () {
      Object.entries(exports).forEach(([key, value]) => this.setExport(key, value));
    }, { context });
  });
  await module.evaluate();
  return { api: module.namespace, requests, store, workspace: workspaceModule.namespace, setActor(value) { actor = value; } };
}

test("mocked persistent profiles survive fresh client sessions without exposing another actor's details", async () => {
  const first = await fixture();
  await first.api.savePersonalProfile({ fullName: "Taylor Shah", jobTitle: "Delivery Manager", updatedAt: null });
  await first.api.saveOrganizationProfile({ name: "Brisk & Zip", industry: "Technology", updatedAt: timestamp });
  first.setActor(null);
  const fresh = await fixture({ store: first.store });
  assert.equal((await fresh.api.loadPersonalProfile()).fullName, "Taylor Shah");
  assert.equal((await fresh.api.loadPersonalProfile()).jobTitle, "Delivery Manager");
  assert.equal((await fresh.api.loadOrganizationProfile()).industry, "Technology");
  fresh.setActor("user-b");
  assert.equal((await fresh.api.loadPersonalProfile()).fullName, "");
});

test("signup name is loaded from server metadata on first authenticated profile read, never client cache", async () => {
  const metadata = new Map([["user-a", { full_name: " Taylor Shah " }]]);
  const f = await fixture({ metadata });
  const first = await f.api.loadPersonalProfile();
  assert.equal(first.fullName, "Taylor Shah");
  assert.equal(first.createdAt, timestamp);
  assert.equal(first.updatedAt, timestamp);
  assert.deepEqual(JSON.parse(f.requests[0].options.body), {});
  metadata.set("user-a", { full_name: "Changed Auth metadata" });
  const fresh = await fixture({ metadata, store: f.store });
  assert.equal((await fresh.api.loadPersonalProfile()).fullName, "Taylor Shah");
});

test("missing or malformed signup names retain profile completion without deriving a name from email", async () => {
  for (const full_name of [undefined, null, "", "   ", "\t\n", 123, {}, [], "X".repeat(121)]) {
    const f = await fixture({ metadata: new Map([["user-a", { full_name }]]) });
    const profile = await f.api.loadPersonalProfile();
    assert.equal(profile.fullName, "");
    assert.equal(profile.createdAt, null);
    assert.equal(profile.updatedAt, null);
    assert.equal(f.store.profiles.size, 0);
  }
});

test("profile edits advance updated_at but retain original created_at and send neither timestamp as editable data", async () => {
  const f = await fixture();
  const first = await f.api.savePersonalProfile({ fullName: "Taylor Shah", jobTitle: "", updatedAt: null });
  const edited = await f.api.savePersonalProfile({ fullName: "Taylor Shah", jobTitle: "Manager", updatedAt: first.updatedAt });
  assert.equal(edited.createdAt, first.createdAt);
  assert.notEqual(edited.updatedAt, first.updatedAt);
  assert.deepEqual(Object.keys(JSON.parse(f.requests[1].options.body)).sort(), ["p_expected_updated_at", "p_full_name", "p_job_title"]);
});

test("company and personal reads remain separate; email never enters profile storage", async () => {
  const f = await fixture();
  assert.equal((await f.api.loadOrganizationProfile()).name, "Brisk & Zip");
  assert.equal(f.requests[0].options.headers.Authorization, "Bearer fixture-token");
  assert.equal(f.requests[0].options.headers["x-steerfold-organization-id"], workspace.id);
  assert.equal((await f.api.loadPersonalProfile()).fullName, "");
  assert.equal(f.requests[1].options.headers.Authorization, "Bearer fixture-token");
  assert.equal(f.requests[1].options.headers["x-steerfold-organization-id"], undefined);
  assert.deepEqual(JSON.parse(f.requests[1].options.body), {});
});

test("saves trim text, preserve exact concurrency timestamp, and never send currency or a target user ID", async () => {
  const f = await fixture();
  await f.api.saveOrganizationProfile({ name: " Brisk & Zip ", industry: " Technology ", updatedAt: timestamp });
  await f.api.savePersonalProfile({ fullName: " Taylor Shah ", jobTitle: " Manager ", updatedAt: null });
  assert.deepEqual(JSON.parse(f.requests[0].options.body), { p_name: "Brisk & Zip", p_industry: "Technology", p_expected_updated_at: timestamp });
  assert.deepEqual(JSON.parse(f.requests[1].options.body), { p_full_name: "Taylor Shah", p_job_title: "Manager", p_expected_updated_at: null });
  assert.equal(f.requests[0].options.headers["x-steerfold-organization-id"], workspace.id);
  assert.equal(f.requests[0].options.headers.Authorization, "Bearer fixture-token");
  assert.equal(f.requests[1].options.headers["x-steerfold-organization-id"], undefined);
});

test("personal profile stays global without a workspace while organization reads and writes fail closed", async () => {
  const f = await fixture();
  f.workspace.setActiveWorkspace(null);
  await f.api.loadPersonalProfile();
  await f.api.savePersonalProfile({ fullName: "Taylor Shah", jobTitle: "Manager", updatedAt: null });
  for (const { options } of f.requests) {
    assert.equal(options.headers["x-steerfold-organization-id"], undefined);
    assert.equal(options.headers.Authorization, "Bearer fixture-token");
  }
  await assert.rejects(f.api.loadOrganizationProfile());
  await assert.rejects(f.api.saveOrganizationProfile({ name: "Company", industry: "", updatedAt: timestamp }));
  assert.equal(f.requests.length, 2);
});

test("organization profile rejects late responses after same-ID workspace replacement", async () => {
  let f;
  f = await fixture({ beforeResponse: () => f.workspace.setActiveWorkspace(workspace) });
  await assert.rejects(f.api.loadOrganizationProfile(), /Workspace changed/);
  assert.equal(f.requests.length, 1);
});

test("read-only workspaces cannot send organization profile writes", async () => {
  const f = await fixture();
  f.workspace.setActiveWorkspace({ ...workspace, canWrite: false });
  await assert.rejects(f.api.saveOrganizationProfile({ name: "Company", industry: "", updatedAt: timestamp }), /read-only|unavailable/);
  assert.equal(f.requests.length, 0);
});

test("invalid names, signed-out users, and account switches cannot send profile writes", async () => {
  const f = await fixture();
  await assert.rejects(f.api.savePersonalProfile({ fullName: " ", jobTitle: "" }));
  await assert.rejects(f.api.saveOrganizationProfile({ name: "X".repeat(121), industry: "" }));
  assert.equal(f.requests.length, 0);
  for (const options of [{ signedIn: false }, { changeActor: true }]) {
    const blocked = await fixture(options);
    await assert.rejects(blocked.api.savePersonalProfile({ fullName: "Name", jobTitle: "", updatedAt: null }));
    assert.equal(blocked.requests.length, 0);
  }
});

test("unavailable backend and stale-save errors do not retry writes or report success", async () => {
  for (const status of [403, 404, 409, 500]) {
    const f = await fixture({ status });
    await assert.rejects(f.api.savePersonalProfile({ fullName: "Name", jobTitle: "", updatedAt: null }));
    assert.equal(f.requests.length, 1);
  }
});

test("HTTP success cannot claim profile values were saved if returned fields do not match", async () => {
  const f = await fixture({ wrongSaveResponse: true });
  await assert.rejects(f.api.savePersonalProfile({ fullName: "Taylor Shah", jobTitle: "Manager", updatedAt: null }), /could not be verified/);
  await assert.rejects(f.api.saveOrganizationProfile({ name: "New Company", industry: "Technology", updatedAt: timestamp }), /could not be verified/);
});

test("profile identity belongs only to its user and never falls back to email", () => {
  setProfileIdentity("user-a", "Taylor Shah");
  assert.equal(profileInitials({ id: "user-a", email: "other@example.invalid" }), "TS");
  assert.equal(profileDisplayName({ id: "user-a" }), "Taylor");
  assert.equal(profileInitials({ id: "user-b", email: "other@example.invalid" }), "?");
  assert.equal(profileDisplayName({ id: "user-b", email: "other@example.invalid" }), "Account");
  setProfileIdentity(null);
  assert.equal(profileInitials({ id: "user-a", email: "taylor@example.invalid" }), "?");
  assert.equal(profileInitials(null), "?");
});

for (const [fullName, initials] of [["Abayomi", "A"], ["Abayomi Adelakun", "AA"],
  ["Abayomi Samuel Adelakun", "AA"], ["  Abayomi \t Samuel  \n Adelakun  ", "AA"]]) {
  test(`saved name ${JSON.stringify(fullName)} uses first-name display and ${initials} initials`, () => {
    const user = { id: "user-a", email: "not-a-name@example.invalid", job_title: "AI Trainer" };
    setProfileIdentity(user.id, fullName);
    assert.equal(profileDisplayName(user), "Abayomi");
    assert.equal(profileInitials(user), initials);
    setProfileIdentity(null);
  });
}

async function identityUIFixture(service) {
  class Element {
    constructor() { this.listeners = new Map(); this.nodes = new Map(); this.dataset = {}; this.hidden = true; this.value = ""; }
    addEventListener(type, callback) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(callback);
    }
    dispatchEvent(event) { for (const callback of this.listeners.get(event.type) || []) callback(event); }
    async emit(type) { for (const callback of this.listeners.get(type) || []) await callback({ preventDefault() {} }); }
    querySelector(selector) { return this.nodes.get(selector) || null; }
    querySelectorAll() { return [...Object.values(this.elements || {}), this.submit].filter(Boolean); }
    setAttribute() {}
    removeAttribute() {}
    toggleAttribute() {}
    prepend(child) { this.nodes.set(`.${child.className}`, child); }
    reportValidity() { return true; }
  }
  const form = (names) => {
    const node = new Element();
    node.elements = Object.fromEntries(names.map((name) => [name, new Element()]));
    node.submit = new Element();
    for (const selector of ["[data-profile-reload]", "[data-profile-status]"]) node.nodes.set(selector, new Element());
    return node;
  };
  const personal = form(["fullName", "jobTitle"]);
  const company = form(["organizationName", "industry"]);
  const launcher = new Element();
  launcher.nodes.set(".sf-sidebar-account-label", new Element());
  launcher.nodes.set(".sf-button-icon", new Element());
  const panel = new Element();
  panel.nodes.set(".sf-account-avatar", new Element());
  panel.nodes.set(".sf-auth-panel-title", new Element());
  const document = new Element();
  document.getElementById = () => panel;
  document.createElement = () => new Element();
  for (const selector of ["[data-profile-avatar]", "[data-profile-identity]", "[data-profile-email]",
    "[data-account-content]", "[data-account-guest]"]) document.nodes.set(selector, new Element());
  document.nodes.set("[data-personal-profile]", personal);
  document.nodes.set("[data-company-profile]", company);
  document.nodes.set("[data-auth-launcher]", launcher);
  const window = new Element();
  const user = { id: "user-a", email: "not-the-profile@example.invalid" };
  const context = vm.createContext({ document, window, CustomEvent: class { constructor(type) { this.type = type; } } });
  const dependencies = {
    "./auth-service.js": { getCurrentUser: () => user, isAuthenticated: () => true, signIn() {}, signOut() {} },
    "./organization-config.js": { ORGANIZATION_CONFIG: { name: "Brisk & Zip" }, acceptOrganizationName() {} },
    "./profile-service.js": Object.fromEntries(["loadOrganizationProfile", "saveOrganizationProfile", "loadPersonalProfile", "savePersonalProfile"].map((key) => [key, service.api[key]])),
    "./profile-identity.js": { setProfileIdentity, profileInitials, profileDisplayName },
  };
  for (const file of ["auth-ui.js", "profile-settings-ui.js"]) {
    const module = new vm.SourceTextModule(await readFile(new URL(`../app/js/${file}`, import.meta.url), "utf8"), { context });
    await module.link((specifier) => {
      const values = dependencies[specifier];
      assert.ok(values, `Unexpected dependency: ${specifier}`);
      return new vm.SyntheticModule(Object.keys(values), function () {
        for (const [key, value] of Object.entries(values)) this.setExport(key, value);
      }, { context });
    });
    await module.evaluate();
    if (file === "auth-ui.js") module.namespace.initAuthUI({ onOpenAccount() {} });
    else module.namespace.initProfileSettings();
  }
  await new Promise(setImmediate);
  return { document, personal, launcher, panel };
}

test("successful profile save immediately updates Account/sidebar identity and fresh reload reads persisted names", async () => {
  const service = await fixture();
  const ui = await identityUIFixture(service);
  assert.equal(ui.document.querySelector("[data-profile-identity]").textContent, "Account");
  assert.equal(ui.launcher.querySelector(".sf-account-avatar").textContent, "?");
  ui.personal.elements.fullName.value = "Abayomi Samuel Adelakun";
  ui.personal.elements.jobTitle.value = "AI Trainer";
  // Unsaved input is not an authoritative identity.
  assert.equal(ui.launcher.querySelector(".sf-sidebar-account-label").textContent, "Account");
  await ui.personal.emit("submit");
  const assertIdentity = (view) => {
    assert.equal(view.document.querySelector("[data-profile-identity]").textContent, "Abayomi");
    assert.equal(view.document.querySelector("[data-profile-avatar]").textContent, "AA");
    assert.equal(view.launcher.querySelector(".sf-sidebar-account-label").textContent, "Abayomi");
    assert.equal(view.launcher.querySelector(".sf-account-avatar").textContent, "AA");
    assert.equal(view.panel.querySelector(".sf-auth-panel-title").textContent, "Abayomi");
    assert.equal(view.panel.querySelector(".sf-account-avatar").textContent, "AA");
    assert.equal(view.personal.elements.fullName.value, "Abayomi Samuel Adelakun");
    assert.equal(view.personal.elements.jobTitle.value, "AI Trainer");
    assert.equal(view.document.querySelector("[data-profile-email]").value, "not-the-profile@example.invalid");
  };
  assertIdentity(ui);
  assert.equal(service.requests.filter(({ url }) => url.includes("save_my_profile")).length, 1);
  setProfileIdentity(null);
  const reloaded = await identityUIFixture(await fixture({ store: service.store }));
  assertIdentity(reloaded);
  setProfileIdentity(null);
});

test("settings section order and local migration privacy/security contract", async () => {
  const html = await readFile(new URL("../app/index.html", import.meta.url), "utf8");
  const markers = ["sf-company-title", "data-settings-financial", "data-settings-appearance", "data-settings-display", "data-account-view", "sf-person-title"];
  const positions = markers.map((marker) => html.indexOf(marker));
  assert.ok(positions.every((position, index) => position >= 0 && (!index || position > positions[index - 1])));
  const sql = await readFile(new URL("../supabase/migrations/20261027_company_user_profiles.sql", import.meta.url), "utf8");
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /using \(user_id = \(select auth.uid\(\)\)\)/);
  assert.match(sql, /governance_admin/);
  assert.match(sql, /p_expected_updated_at/);
  assert.equal((sql.match(/security definer set search_path = ''/g) || []).length, 3);
  assert.doesNotMatch(sql, /grant\s+(?:insert|update|delete)/i);
  assert.doesNotMatch(sql, /update\s+public\.(?:projects|change_requests)/i);
  assert.match(sql, /created_at timestamptz not null default now\(\)/);
  assert.match(sql, /updated_at timestamptz not null default now\(\)/);
  assert.doesNotMatch(sql, /created_at\s*=/i);
  assert.match(sql, /language plpgsql volatile security definer/);
  assert.match(sql, /raw_user_meta_data->'full_name'[\s\S]*from auth.users where id = auth.uid\(\)/);
  assert.match(sql, /jsonb_typeof\(v_signup_name\) = 'string'/);
  assert.match(sql, /char_length\(v_full_name\) between 1 and 120/);
  assert.match(sql, /on conflict \(user_id\) do nothing/);
  assert.doesNotMatch(sql, /raw_user_meta_data.*(?:role|permission)|split_part.*email/);
});
