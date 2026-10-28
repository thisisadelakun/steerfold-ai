import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import test from "node:test";

// Optional local PostgreSQL/WASM integration tests. No network or Supabase client.
// Point this at an independently installed PGlite module; no app dependency added.
const enginePath = process.env.STEERFOLD_PGLITE_PATH;
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const migration = read("supabase/migrations/20261028_organization_workspaces.sql");
const rehearsal = read("supabase/validation/organization_workspaces_rehearsal.sql");
const active = migration.match(/^create function public\.active_organization_id\(\)[\s\S]*?^\$\$;/m)[0];
const view = migration.match(/^create view public\.organization_settings[\s\S]*?^from public\.organizations[^;]+;/m)[0];
const runner = rehearsal.match(/^create function pg_temp\.workspace_rehearsal_probe\([\s\S]*?^\$probe_runner\$;/m)[0];
const admin = "ed1005a0-76e4-4614-8a66-589c055ecff5";
const demo = "00000000-0000-4000-8000-000000000001";
const a = "f1600000-0000-4000-8000-000000000001";
const b = "f1600000-0000-4000-8000-000000000002";
const fixtureSql = `
  insert into public.organizations values('${a}','EUR',false,'A','',now()),('${b}','GBP',false,'B','',now());
  insert into public.organization_memberships values('${a}','${admin}');
`;
const setOwnerContext = `
  select set_config('request.jwt.claim.sub','${admin}',true),
    set_config('request.jwt.claim.role','authenticated',true),
    set_config('request.jwt.claims','{"sub":"${admin}","role":"authenticated"}',true),
    set_config('request.headers','{"x-steerfold-organization-id":"${demo}"}',true);
`;
const stateSql = `select jsonb_build_object('user',current_user,'role',coalesce(current_setting('role',true),''),
  'sub',coalesce(current_setting('request.jwt.claim.sub',true),''),
  'claim_role',coalesce(current_setting('request.jwt.claim.role',true),''),
  'claims',coalesce(current_setting('request.jwt.claims',true),''),
  'headers',coalesce(current_setting('request.headers',true),'')) as state`;

test("isolated PostgreSQL reproduces fixture visibility failure and verifies scoped probe restoration", {
  skip: !enginePath && "Set STEERFOLD_PGLITE_PATH to an existing local PGlite module to run PostgreSQL integration checks.",
}, async (t) => {
  const { PGlite } = await import(pathToFileURL(enginePath).href);
  const db = new PGlite();
  try {
    await db.exec(`
      create role authenticated; create role anon;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.role() returns text language sql stable as $$
        select current_setting('request.jwt.claim.role',true) $$;
      grant usage on schema auth to authenticated,anon;
      grant execute on function auth.uid(),auth.role() to authenticated,anon;
      create table public.organizations(id uuid primary key,organization_currency text,is_demo boolean,
        organization_name text,industry text,updated_at timestamptz);
      create table public.organization_memberships(organization_id uuid,user_id uuid);
      create table public.user_profiles(user_id uuid);
      insert into public.organizations values('${demo}','CAD',true,'Brisk & Zip','',now());
      insert into public.user_profiles values('${admin}'),('00000000-0000-4000-8000-000000000099');
      ${active}
      alter table public.organizations enable row level security;
      alter table public.user_profiles enable row level security;
      grant select on public.organizations to authenticated,anon;
      grant select on public.user_profiles to authenticated;
      create policy workspace_read on public.organizations for select to authenticated,anon
        using(id=(select public.active_organization_id()));
      create policy own_profile on public.user_profiles for select to authenticated using(user_id=auth.uid());
      ${view}
      grant select on public.organization_settings to authenticated,anon;
      create temporary table establish_temp_schema(x integer);
      ${runner}
    `);

    await t.test("original same-DO fixture/IF failure occurs before any negative identity switch", async () => {
      try {
        await assert.rejects(db.exec(`begin; ${setOwnerContext}
          do $old_case$
          declare v_admin uuid := '${admin}';
          begin
            ${fixtureSql}
            perform set_config('request.headers','{"x-steerfold-organization-id":"${a}"}',true);
            execute 'set local role authenticated';
            if auth.uid() is distinct from v_admin or auth.role()<>'authenticated'
              or public.active_organization_id()<>'${a}'::uuid then raise exception 'Wrong identity'; end if;
            if (select count(*) from public.organizations)<>1 then raise exception 'Wrong count'; end if;
            if (select count(*) from public.organization_settings where organization_currency='EUR')<>1
              or exists(select 1 from public.user_profiles where user_id<>v_admin) then
              raise exception 'Wrong settings/profile';
            end if;
          end;
          $old_case$;
        `), (error) => error.code === "42501" && /Organization access denied/.test(error.message)
          && /organization_settings/.test(error.where));
      } finally { await db.exec("rollback;"); }
    });

    await db.exec(`begin; ${setOwnerContext} ${fixtureSql}`);
    const before = (await db.query(stateSql)).rows[0].state;
    const restored = async () => {
      assert.deepEqual((await db.query(stateSql)).rows[0].state, before);
      assert.equal((await db.query("select public.active_organization_id() as id")).rows[0].id, demo);
    };
    const call = (label, actor, role, workspace, sql, expected = null) => db.query(
      "select pg_temp.workspace_rehearsal_probe($1,$2::uuid,$3,$4::uuid,$5,$6)",
      [label, actor, role, workspace, sql, expected],
    );

    await t.test("separate setup statement fixes exact positive settings IF; owner context restored on success", async () => {
      await call("positive A", admin, "authenticated", a, `do $case$
        declare v_admin uuid := '${admin}';
        begin
          if (select count(*) from public.organization_settings where organization_currency='EUR')<>1
            or exists(select 1 from public.user_profiles where user_id<>v_admin) then
            raise exception 'Wrong settings/profile';
          end if;
        end;
        $case$;`);
      await restored();
    });
    await t.test("expected cross-workspace access denial is caught as PASS and original JWT/header restored", async () => {
      await call("closed B", admin, "authenticated", b, "select public.active_organization_id();", "42501");
      await restored();
    });
    await t.test("anonymous denial restores both database role and null/non-null actor claims", async () => {
      await call("anon private A", null, "anon", a, "select public.active_organization_id();", "42501");
      await restored();
    });
    await t.test("nested malformed-header mutation cannot leak out of an expected rejection", async () => {
      await call("bad header", admin, "authenticated", a, `do $case$ begin
        perform set_config('request.headers','{"x-steerfold-organization-id":"bad"}',true);
        perform public.active_organization_id(); end; $case$;`, "22023");
      await restored();
    });
    await t.test("an unexpected positive-path denial still fails closed with the observed simulated context", async () => {
      await db.exec(`do $catch$ begin
        begin
          perform pg_temp.workspace_rehearsal_probe('unexpected denial','${admin}','authenticated','${b}',
            'select public.active_organization_id();');
          raise exception 'Failure was incorrectly swallowed';
        exception when insufficient_privilege then
          if sqlerrm not like '%unexpected denial%' then raise; end if;
        end;
      end; $catch$;`);
      await restored();
    });
    await t.test("post-probe validation reads the intended owner/admin Demo, never the previous negative identity", async () => {
      assert.equal((await db.query("select organization_currency from public.organization_settings")).rows[0].organization_currency, "CAD");
      await restored();
    });
    await db.exec("rollback;");
    assert.equal((await db.query("select count(*)::integer as count from public.organizations")).rows[0].count, 1);
  } finally {
    await db.exec("rollback;");
    await db.close();
  }
});
