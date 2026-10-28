import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

async function securityFixture({ token = "fixture-token", status = 200, code, networkError = false, actorChanges = false } = {}) {
  let actor = "actor-a";
  const requests = [];
  const context = vm.createContext({ AbortController, setTimeout, clearTimeout, TypeError,
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (networkError) throw new TypeError("Offline");
      return { ok: status === 200, status, json: async () => status === 200 ? { id: "actor-a" } : { code } };
    },
  });
  const module = new vm.SourceTextModule(await readFile(new URL("../app/js/account-security-service.js", import.meta.url), "utf8"), { context });
  await module.link((specifier) => {
    const exports = specifier.includes("auth-service") ? {
      getCurrentUser: () => ({ id: actor }),
      getValidAccessToken: async () => { if (actorChanges) actor = "actor-b"; return token; },
    } : { SUPABASE_URL: "https://fixture.invalid", SUPABASE_PUBLISHABLE_KEY: "fixture-key" };
    return new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context });
  });
  await module.evaluate();
  return { api: module.namespace, requests };
}

test("security uses Supabase authenticated verification and password-only update contract", async () => {
  const f = await securityFixture();
  await f.api.requestPasswordVerification();
  await f.api.updateAccountPassword("synthetic-password", "synthetic-password", "123456");
  assert.match(f.requests[0].url, /auth\/v1\/reauthenticate$/);
  assert.equal(f.requests[0].options.method, "GET");
  assert.equal(f.requests[0].options.body, undefined);
  assert.equal(f.requests[1].options.method, "PUT");
  assert.match(f.requests[1].url, /auth\/v1\/user$/);
  assert.deepEqual(JSON.parse(f.requests[1].options.body), { password: "synthetic-password", nonce: "123456" });
  assert.equal(f.requests[1].options.headers.Authorization, "Bearer fixture-token");
});

test("invalid, signed-out, or switched-account security operations cannot send a request", async () => {
  const f = await securityFixture();
  assert.throws(() => f.api.updateAccountPassword("short", "short"));
  assert.throws(() => f.api.updateAccountPassword("synthetic-password", "mismatch"));
  assert.equal(f.requests.length, 0);
  for (const options of [{ token: null }, { actorChanges: true }]) {
    const blocked = await securityFixture(options);
    await assert.rejects(blocked.api.updateAccountPassword("synthetic-password", "synthetic-password"));
    assert.equal(blocked.requests.length, 0);
  }
});

test("reauthentication and uncertain password failures are explicit with no automatic retries", async () => {
  const verify = await securityFixture({ status: 422, code: "reauthentication_needed" });
  await assert.rejects(verify.api.updateAccountPassword("synthetic-password", "synthetic-password"), /verification code/);
  assert.equal(verify.requests.length, 1);
  for (const options of [{ status: 500 }, { networkError: true }]) {
    const f = await securityFixture(options);
    await assert.rejects(f.api.updateAccountPassword("synthetic-password", "synthetic-password"), (error) => error.uncertain === true);
    assert.equal(f.requests.length, 1);
  }
});

test("Account navigation removes stale project query and respects browser Back/Forward route state", async () => {
  const context = vm.createContext({ URL, window: { location: { href: "https://fixture.invalid/app/?project=P001#settings" } },
    history: { pushState(state, unused, url) { context.window.location.href = new URL(url, context.window.location.href).href; } },
  });
  const module = new vm.SourceTextModule(await readFile(new URL("../app/js/router.js", import.meta.url), "utf8"), { context });
  await module.link(() => { throw new Error("Router should have no dependencies"); });
  await module.evaluate();
  module.namespace.pushAccountRoute();
  assert.equal(module.namespace.getCurrentRoute().view, "account");
  assert.equal(new URL(context.window.location.href).searchParams.has("project"), false);
  module.namespace.pushSettingsRoute();
  assert.equal(module.namespace.getCurrentRoute().view, "settings");
  context.window.location.href = "https://fixture.invalid/app/#account";
  assert.equal(module.namespace.getCurrentRoute().view, "account");
});

test("personal fields are exclusively in Account and Account access is not role-gated", async () => {
  const html = await readFile(new URL("../app/index.html", import.meta.url), "utf8");
  const settings = html.slice(html.indexOf("<section data-settings-view"), html.indexOf("<section data-account-view"));
  assert.doesNotMatch(settings, /sf-profile-name|sf-profile-job|Your Profile/);
  assert.match(html, /type="email"[^>]*readonly data-profile-email/);
  const auth = await readFile(new URL("../app/js/auth-ui.js", import.meta.url), "utf8");
  assert.match(auth, /isAuthenticated\(\) && typeof onOpenAccount === "function"/);
  assert.doesNotMatch(auth, /governance_admin|getMyGovernanceRoles/);
  const ui = await readFile(new URL("../app/js/account-security-ui.js", import.meta.url), "utf8");
  assert.match(ui, /if \(busy \|\| uncertain \|\| !isAuthenticated\(\)\) return/);
  assert.match(ui, /form.reset\(\)/);
  assert.match(ui, /await signOut\(\)/);
  assert.match(ui, /event.stopPropagation\(\)/);
});
