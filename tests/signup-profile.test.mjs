import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function fixture({ confirmed = false, status = 200, error = null } = {}) {
  const storage = new Map();
  const requests = [];
  const context = vm.createContext({ URL, atob, Date,
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    fetch: async (url, options) => {
      requests.push({ url: String(url), options });
      const input = JSON.parse(options.body);
      const user = { id: "fixture-user", email: input.email, user_metadata: input.data };
      return { ok: status === 200, status, json: async () => error ?? (confirmed ? { access_token: "fixture-access", refresh_token: "fixture-refresh", user } : user) };
    },
  });
  const module = new vm.SourceTextModule(await readFile(new URL("../app/js/auth-service.js", import.meta.url), "utf8"), { context });
  await module.link(() => new vm.SyntheticModule(["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"], function () {
    this.setExport("SUPABASE_URL", "https://fixture.invalid"); this.setExport("SUPABASE_PUBLISHABLE_KEY", "fixture-key");
  }, { context }));
  await module.evaluate();
  return { api: module.namespace, requests, storage };
}

test("signup sends supplied full name as Supabase Auth metadata without fabricating an email-verification session", async () => {
  const f = await fixture();
  const result = await f.api.signUp("taylor@example.invalid", "synthetic-password", " Taylor Shah ");
  assert.deepEqual(JSON.parse(f.requests[0].options.body), { email: "taylor@example.invalid", password: "synthetic-password", data: { full_name: "Taylor Shah" } });
  assert.match(f.requests[0].url, /auth\/v1\/signup$/);
  assert.equal(f.requests.length, 1);
  assert.equal(result.needsEmailVerification, true);
  assert.equal(result.session, null);
  assert.equal(f.storage.size, 0);
});

test("immediately authenticated signup retains the full session and supplied name", async () => {
  const f = await fixture({ confirmed: true });
  const result = await f.api.signUp("taylor@example.invalid", "synthetic-password", "Taylor Shah");
  assert.equal(result.needsEmailVerification, false);
  assert.equal(f.api.getCurrentUser().user_metadata.full_name, "Taylor Shah");
  assert.equal(JSON.parse(f.storage.get("steerfold_auth_session")).refresh_token, "fixture-refresh");
});

test("missing/invalid supplied names never fall back to email or send signup requests", async () => {
  for (const name of [undefined, null, "", " ", 123, "X".repeat(121)]) {
    const f = await fixture();
    await assert.rejects(f.api.signUp("taylor@example.invalid", "synthetic-password", name), /full name/);
    assert.equal(f.requests.length, 0);
    assert.equal(f.storage.size, 0);
  }
  const f = await fixture({ status: 400 });
  await assert.rejects(f.api.signUp("taylor@example.invalid", "synthetic-password", "Taylor Shah"));
  assert.equal(f.storage.size, 0);
});

test("auth errors map known provider codes without echoing technical payloads", async () => {
  for (const [code,message] of [
    ["signup_disabled","New account registration is currently disabled."],
    ["weak_password","Choose a stronger password and try again."],
    ["email_exists","An account already exists for this email. Try signing in."],
    ["unknown_provider_code","Sign up could not be completed. Check your details and try again."],
  ]) {
    const f=await fixture({status:400,error:{code,msg:"INTERNAL SQL secret detail"}});
    await assert.rejects(f.api.signUp("fixture@example.invalid","synthetic-password","Taylor Shah"),{message});
    assert.equal(f.storage.size,0);
  }
  const login=await fixture({status:400,error:{error_code:"invalid_credentials",error_description:"technical trace"}});
  await assert.rejects(login.api.signIn("fixture@example.invalid","synthetic-password"),{message:"Email or password is incorrect."});
  const limited=await fixture({status:429,error:{}});
  await assert.rejects(limited.api.signUp("fixture@example.invalid","synthetic-password","Taylor Shah"),{message:"Too many requests. Wait before trying again."});
});

test("Governance Admin preflight requires an explicit existing assigned actor and read-only recognition probe", async () => {
  const sql = await readFile(new URL("../supabase/validation/account_settings_preflight.sql", import.meta.url), "utf8");
  assert.match(sql, /begin transaction read only/i);
  assert.match(sql, /v_admin_user_id uuid := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'::uuid/i);
  assert.match(sql, /to_regprocedure\('public.current_user_has_governance_role\(text\)'\)/);
  assert.match(sql, /governance_user_roles_role_allowed|pg_catalog.pg_constraint/);
  assert.match(sql, /from auth.users where id = v_admin_user_id/);
  assert.match(sql, /from public.governance_user_roles where user_id = v_admin_user_id and role = 'governance_admin'/);
  assert.match(sql, /current_user_has_governance_role\('governance_admin'\) is distinct from true/);
  assert.match(sql, /NOT Governance Admin/);
  assert.match(sql, /status is UNVERIFIED/);
  assert.match(sql, /rollback;\s*$/i);
  assert.doesNotMatch(sql, /(?:^|\n)\s*(?:insert into|update\s|delete from|grant\s|commit;)/im);
});
