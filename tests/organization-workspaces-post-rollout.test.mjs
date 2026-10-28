import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import test from "node:test";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const root = "supabase/validation/";
const migration = read("supabase/migrations/20261028_organization_workspaces.sql");
const verifier = read(root + "organization_workspaces_post_rollout_verify.sql");
const capture = read(root + "organization_workspaces_rollout_capture.sql");
const runbook = read(root + "organization_workspaces_rollout.md");
const hash = (text) => createHash("sha256").update(text).digest("hex");
const definitions = [...migration.matchAll(/^create (?:or replace )?function public\.(\w+)\([\s\S]*?\bas \$\$([\s\S]*?)^\$\$;/gm)];
const pins = [...verifier.matchAll(/\('(\w+)','([a-f0-9]{64})','(sql|plpgsql)','([sv])',(true|false)\)/g)];
const executable = (sql) => sql.replace(/\$rollout_evidence\$[\s\S]*?\$rollout_evidence\$/g, "''")
  .replace(/\$reviewed_rls\$[\s\S]*?\$reviewed_rls\$/g, "''")
  .replace(/--[^\n]*/g, "").replace(/'(?:''|[^'])*'/g, "''");

test("package preserves the exact reviewed migration and coordinated release", () => {
  assert.equal(hash(migration), "6961b74fc9645a404efc012236eafe5881f16fe687af44444e063616359f69f2");
  assert.match(runbook, /ENTIRE EXACT ORIGINAL migration file once/);
  assert.match(runbook, /Old clients without the organization header fail closed/);
});

test("both artifacts are read-only BEGIN/ROLLBACK without writes or sequence calls", () => {
  for (const sql of [capture, verifier]) {
    assert.ok(sql.split("\n").every((line) => line === line.trimEnd()), "No trailing whitespace");
    const code = executable(sql);
    assert.match(code, /begin transaction isolation level repeatable read read only;/i);
    assert.equal([...code.matchAll(/^\s*(?:begin transaction|rollback|commit)\b/gim)].length, 2);
    assert.doesNotMatch(code, /\bcommit\s*;/i);
    assert.match(code.trim(), /rollback;$/i);
    assert.doesNotMatch(code, /\b(?:create|alter|drop|truncate|insert|update|delete|merge)\s+(?:table|function|trigger|policy|index|into|from|public\.)/i);
    assert.doesNotMatch(code, /\b(?:nextval|setval|generate_project_business_id|commit_project_import|create_workspace|save_my_profile|get_my_profile|set_organization_currency)\s*\(/i);
    assert.doesNotMatch(code, /\b(?:dblink|http_post|http_get|pg_background|vacuum|reindex)\b/i);
  }
});

test("fresh complete evidence is mandatory safe JSON data, never interpolated SQL", () => {
  const inputs = [...verifier.matchAll(/\$rollout_evidence\$([\s\S]*?)\$rollout_evidence\$/g)];
  assert.equal(inputs.length, 1);
  const input = JSON.parse(inputs[0][1]);
  assert.ok(input === null || (input.rollout_format === 1 && Array.isArray(input.catalog.triggers)));
  assert.match(capture, /chr\(36\), chr\(92\) \|\| 'u0024'/);
  for (const key of ["rollout_format", "catalog_sha256", "database", "server_version_num", "function_contracts", "project_defaults", "project_default_dependencies"]) {
    assert.ok(verifier.includes(key), key);
    assert.ok(capture.includes(key), key);
  }
  assert.doesNotMatch(verifier, /execute[^;\n]*(?:v_expected|v_item|v_contract)/i);
  assert.match(verifier, /jsonb_typeof\(v_expected\) is distinct from 'object'/);
  assert.match(verifier, /v_expected->>'catalog_sha256' is distinct from/);
});

test("row/history preservation, fingerprints and every public sequence must match", () => {
  for (const text of ["(to_jsonb(t) - 'organization_id')::text",
    "(to_jsonb(p) - 'organization_id')::text, '' order by p.project_id",
    "v_manifest->v_table is distinct from v_expected->v_table",
    "v_sequences is distinct from v_expected->'sequences'",
    "'project_business_id_seq'->>'last_value' is distinct from '12'",
    "'project_business_id_seq'->>'is_called' is distinct from 'true'",
    "'project_imports'->>'count' <> '1'", "'change_requests'->>'count' <> '2'",
    "'change_request_events'->>'count' <> '11'"]) assert.ok(verifier.includes(text), text);
});

test("all 24 function body/security pins track exact reviewed definitions", () => {
  assert.equal(definitions.length, 24);
  assert.equal(pins.length, 24);
  for (const [, name, body] of definitions) {
    const pin = pins.find((row) => row[1] === name);
    assert.ok(pin, name);
    assert.equal(pin[2], hash(body), name);
    assert.ok(verifier.includes("'public." + name + "("), name);
  }
  assert.match(verifier, /'public.get_project_import_result\(uuid\)', false, false, true/);
  assert.match(verifier, /a\.grantee = 0 and a\.privilege_type = 'EXECUTE'/);
  assert.match(verifier, /Existing RPC argument\/default\/return contract changed/);
  assert.match(verifier, /Missing original RPC contract evidence/);
});

test("unknown functions/triggers fail closed; generator, profiles and RLS infrastructure stay pinned", () => {
  for (const text of ["Unknown function or unchanged generator/profile/function/ACL drift",
    "v_catalog->'event_triggers' is distinct from v_expected->'catalog'->'event_triggers'",
    "Original user trigger definition/mode changed", "Project defaults/generator bindings changed",
    "Personal profile RLS changed"]) assert.ok(verifier.includes(text), text);
  const reviewed = verifier.match(/\$reviewed_rls\$([\s\S]*?)\$reviewed_rls\$/)[1].trimEnd();
  assert.equal(hash(reviewed), "62e77d28f3013a8047bb431be5f8b174ad51cdde883dcc3b0d6c6c0a84e954a3");
  assert.equal(reviewed, migration.match(/\$reviewed_rls\$([\s\S]*?)\$reviewed_rls\$/)[1].trimEnd());
});

test("post-schema checks cover exact constraints, guard modes, policies and ACLs", () => {
  for (const item of ["confdelsetcols", "workspace_row_guard", "project_import_rows_source_unique",
    "project_imports_workspace_actor_key_unique", "own_workspace_import_rows", "own_membership_read",
    "demo_write_eligible", "has_any_column_privilege", "security_invoker=true", "security_barrier=true",
    "Exact workspace CHECK/PK/FK constraints differ", "Exact reviewed policy differs",
    "Global business-code uniqueness missing", "and t.tgtype=31", "tgtype=19"]) assert.ok(verifier.includes(item), item);
  const constraints = JSON.parse(verifier.match(/\$constraint_pins\$([\s\S]*?)\$constraint_pins\$/)[1]);
  assert.equal(constraints.length, 9);
  assert.ok(constraints.some((row) => row.conname === "organizations_demo_currency_cad"));
});

test("read probes restore role/JWT/headers and catch exact expected denial only", () => {
  for (const text of ["exception when sqlstate 'PZ002' then null;",
    "exception when others then v_code:=sqlstate;", "v_code is distinct from v_case.expected_code",
    "v_before is distinct from v_after", "v_after is distinct from v_context",
    "Nonmember private data leaked"]) assert.ok(verifier.includes(text), text);
  assert.match(verifier, /v_started:=true;\s*perform public\.active_organization_id\(\)/);
  assert.doesNotMatch(verifier, /create function pg_temp/i);
});

test("runbook gates traffic, backup, browser checks and stop-investigate recovery", () => {
  for (const text of ["maintenance", "PITR", "ROLLOUT_EVIDENCE", "OPTIONS",
    "x-steerfold-organization-id", "staging", "There is NO automatic reverse migration",
    "Before any browser signup/profile/bootstrap or business writes",
    "Only then restore normal traffic", "Brisk & Zip, which is also Demo",
    "No legacy CSV or implicit-tenant fallback"]) assert.ok(runbook.includes(text), text);
});

const block = (name) => {
  const marked = verifier.split("-- " + name + " BEGIN\n")[1];
  if (marked) return marked.split("-- " + name + " END")[0];
  const patterns = {
    "ORIGINAL PROJECT DEFAULT CHECK": /  if \(select jsonb_agg\(jsonb_build_array\(a.attname,pg_get_expr[\s\S]*?raise exception 'STOP: Project defaults\/generator bindings changed.';\s*end if;/,
    "WORKSPACE DEFAULT CHECK": /  foreach v_table in array array\['projects','change_requests','change_request_events','project_imports','project_import_rows'\] loop[\s\S]*?Reviewed public.active_organization_id[\s\S]*?end loop;/,
    "ORIGINAL FUNCTION CHECK": /  if exists \(select 1 from jsonb_array_elements\(v_expected->'catalog'->'functions'\) b[\s\S]*?Unknown function or unchanged generator\/profile\/function\/ACL drift.';\s*end if;/,
  };
  assert.ok(patterns[name], name);
  const matched = verifier.match(patterns[name]);
  assert.ok(matched, name);
  return matched[0];
};
const workspaceTables = ["projects", "change_requests", "change_request_events", "project_imports", "project_import_rows"];

test("archive trigger exception permits only the exact reviewed table-name rendering change", () => {
  const checks = block("ORIGINAL TRIGGER CHECK");
  for (const item of ["organization_settings_update","organization_settings_no_delete","organization_settings_no_truncate",
    "where oid=(v_item->>0)::oid", "v_trigger.tgrelid is distinct from (v_item->>1)::oid",
    "'public._legacy_organization_settings'::regclass", "v_trigger.tgenabled::text is distinct from v_item->>3",
    "v_trigger.tgtype is distinct from v_expected_type", "v_trigger.tgisinternal",
    "to_regprocedure('public._protect_organization_settings()')", "(f->>0)::oid=v_trigger.tgfoid",
    "elsif not (v_catalog->'triggers' @> jsonb_build_array(v_item))"]) assert.ok(checks.includes(item),item);
  assert.match(checks,/replace\(v_original_definition,' ON organization_settings ',' ON _legacy_organization_settings '\)/);
  assert.match(checks,/v_item->>4 is distinct from v_original_definition/);
  assert.match(checks,/Archive protection trigger missing or duplicated/);
  assert.match(verifier,/security_invoker=true/);
  assert.match(verifier,/security_barrier=true/);
  assert.match(verifier,/has_table_privilege\('anon','public._legacy_organization_settings','SELECT'\)/);
  assert.match(verifier,/tgname='organization_updated'/);
});

test("isolated PostgreSQL validates archive rename without allowing trigger drift", {
  skip: !process.env.STEERFOLD_PGLITE_PATH && "Requires an independently installed local PostgreSQL/WASM module.",
}, async (t) => {
  const { PGlite } = await import(pathToFileURL(process.env.STEERFOLD_PGLITE_PATH).href);
  const db = new PGlite();
  const oldMigration = read("supabase/migrations/20261026_organization_currency.sql");
  const catalogQuery = "select jsonb_build_object('triggers',(select jsonb_agg(jsonb_build_array(t.oid,t.tgrelid,t.tgname,t.tgenabled," +
    "pg_get_triggerdef(t.oid,true)) order by t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid " +
    "join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth') and not t.tgisinternal)," +
    "'functions',(select jsonb_agg(jsonb_build_array(p.oid,p.proowner,p.proacl,p.prosecdef,p.provolatile,p.proisstrict,p.proconfig," +
    "pg_get_functiondef(p.oid)) order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace " +
    "where n.nspname in ('public','auth') and p.prokind in ('f','p'))) as catalog";
  try {
    // Local, empty fixtures only: never contacts Supabase or inserts a project.
    await db.exec("create table public.organization_settings(id boolean,updated_at timestamptz);" +
      "create table public.organizations(id uuid);" +
      "create table public.projects(id integer);" +
      "create function public.ordinary_guard() returns trigger language plpgsql as $$ begin return new; end; $$;" +
      "create trigger ordinary_update before update on projects for each row execute function public.ordinary_guard();");
    await db.exec(oldMigration.match(/create function public\._protect_organization_settings\(\)[\s\S]*?^\$\$;/m)[0]);
    for (const match of oldMigration.matchAll(/create trigger organization_settings_\w+[\s\S]*?;/g)) await db.exec(match[0]);
    const before = (await db.query(catalogQuery)).rows[0].catalog;
    await db.query("select set_config('steerfold.test_archive_evidence',$1,false)",[JSON.stringify({catalog:before})]);
    // Only the reviewed rename is performed locally; the replacement is a view.
    await db.exec("alter table public.organization_settings rename to _legacy_organization_settings;" +
      "create view public.organization_settings with(security_invoker=true,security_barrier=true) as select * from public._legacy_organization_settings;");
    const after = (await db.query(catalogQuery)).rows[0].catalog;
    const previous = before.triggers.find((row) => row[2]==="organization_settings_update");
    const current = after.triggers.find((row) => row[2]==="organization_settings_update");
    assert.deepEqual(current.slice(0,4),previous.slice(0,4));
    assert.notEqual(current[4],previous[4],"The old byte-identical definition check reproduces the false positive");
    assert.equal(current[4],previous[4].replace(" ON organization_settings "," ON _legacy_organization_settings "));
    const unknown = verifier.match(/  if exists\(select 1 from pg_trigger t join pg_class c[\s\S]*?raise exception 'STOP: Unexpected user trigger.';\s*end if;/)[0];
    const run = async () => {
      const now = (await db.query(catalogQuery)).rows[0].catalog;
      await db.query("select set_config('steerfold.test_archive_catalog',$1,true)",[JSON.stringify(now)]);
      await db.exec("do $archive_case$ declare v_expected jsonb:=current_setting('steerfold.test_archive_evidence')::jsonb;" +
        "v_catalog jsonb:=current_setting('steerfold.test_archive_catalog')::jsonb;v_item jsonb;v_trigger record;" +
        "v_original_definition text;v_expected_type smallint;v_reviewed_oids oid[]:='{}'; begin " +
        block("ORIGINAL TRIGGER CHECK") + unknown + block("ORIGINAL FUNCTION CHECK") + " end; $archive_case$;");
    };
    await t.test("reviewed rename passes inside a read-only transaction", async () => {
      try { await db.exec("begin read only;"); await run(); } finally { await db.exec("rollback;"); }
    });
    const reject = async (label,sql) => t.test(label,async () => {
      try {
        await db.exec("begin;"); await db.exec(sql);
        await assert.rejects(run(),(error) => error.code==="P0001" && /STOP:/.test(error.message));
      } finally { await db.exec("rollback;"); }
    });
    await reject("changed archive trigger function fails",
      "create or replace trigger organization_settings_update before update on _legacy_organization_settings for each row execute function ordinary_guard();");
    await reject("disabled archive trigger fails","alter table _legacy_organization_settings disable trigger organization_settings_update;");
    await reject("changed timing fails",
      "create or replace trigger organization_settings_update after update on _legacy_organization_settings for each row execute function _protect_organization_settings();");
    await reject("changed event fails",
      "create or replace trigger organization_settings_update before insert on _legacy_organization_settings for each row execute function _protect_organization_settings();");
    await reject("moved trigger fails",
      "drop trigger organization_settings_update on _legacy_organization_settings;" +
      "create trigger organization_settings_update before update on projects for each row execute function _protect_organization_settings();");
    await reject("missing archive trigger fails","drop trigger organization_settings_no_delete on _legacy_organization_settings;");
    await reject("unexpected archive duplicate fails",
      "create trigger extra_update before update on _legacy_organization_settings for each row execute function _protect_organization_settings();");
    await reject("duplicate on another relation fails",
      "create trigger organization_settings_update before update on projects for each row execute function _protect_organization_settings();");
    await reject("ordinary trigger drift remains exact","alter table projects disable trigger ordinary_update;");
    await reject("archive protection function body remains exact",
      "create or replace function public._protect_organization_settings() returns trigger language plpgsql set search_path='' as $$ begin return new; end; $$;");
  } finally { await db.close(); }
});

test("only the new tenant default is excluded; original and reviewed workspace bindings stay exact", () => {
  const original = block("ORIGINAL PROJECT DEFAULT CHECK");
  assert.match(original, /join pg_attribute a on a\.attrelid=d\.adrelid and a\.attnum=d\.adnum/);
  assert.match(original, /d\.adrelid='public\.projects'::regclass and a\.attname <> 'organization_id'/);
  const dependencies = original.match(/or \(select jsonb_agg\(to_jsonb\(dep\)[\s\S]*?'project_default_dependencies'/)[0];
  assert.doesNotMatch(dependencies, /attname in/);
  assert.match(original, /is distinct from v_expected->'project_defaults'/);
  assert.match(original, /to_regprocedure\('public\.generate_project_business_id\(\)'\) is null/);
  const defaults = block("WORKSPACE DEFAULT CHECK");
  const tables = [...defaults.matchAll(/'(\w+)'/g)].map((row) => row[1]).filter((name) => workspaceTables.includes(name));
  assert.deepEqual(tables, workspaceTables);
  assert.match(defaults, /pg_get_expr\(d\.adbin,d\.adrelid\)='active_organization_id\(\)'/);
  assert.match(defaults, /dep\.refobjid=to_regprocedure\('public\.active_organization_id\(\)'\)/);
  const scope = migration.match(/foreach v_table in array array\[([^\]]+)\] loop\s*execute format\('alter table public\.%I alter column organization_id set default/)[1];
  assert.deepEqual([...scope.matchAll(/'(\w+)'/g)].map((row) => row[1]), workspaceTables);
  assert.match(verifier, /foreach v_table in array array\['projects','change_requests','change_request_events','project_imports','project_import_rows'\] loop\s*if not exists\(select 1 from pg_trigger/);
});

test("isolated PostgreSQL accepts added tenant defaults but rejects original-default/generator tampering", {
  skip: !process.env.STEERFOLD_PGLITE_PATH && "Requires an independently installed local PostgreSQL/WASM module.",
}, async (t) => {
  const { PGlite } = await import(pathToFileURL(process.env.STEERFOLD_PGLITE_PATH).href);
  const db = new PGlite();
  try {
    // Empty local fixtures only. No generator invocation, project insert or sequence call.
    await db.exec("create role replacement_owner;" +
      "create function public.generate_project_business_id() returns text language sql as $$ select 'unused'::text $$;" +
      "create table public.projects(id uuid default gen_random_uuid(),project_id text default public.generate_project_business_id()," +
        "created_at timestamptz default now(),updated_at timestamptz default now());" +
      "create table public.governance_user_roles(user_id uuid);");
    for (const table of workspaceTables.slice(1)) await db.exec("create table public." + table + "(id uuid);");
    const evidenceQuery = "select jsonb_build_object(" +
      "'project_defaults',(select jsonb_agg(jsonb_build_array(a.attname,pg_get_expr(d.adbin,d.adrelid)) order by a.attname) " +
        "from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum " +
        "where a.attrelid='public.projects'::regclass and a.attname in ('id','project_id'))," +
      "'project_default_dependencies',(select jsonb_agg(to_jsonb(dep) order by dep.objid,dep.refobjid,dep.refobjsubid) " +
        "from pg_attrdef d join pg_depend dep on dep.classid='pg_attrdef'::regclass and dep.objid=d.oid " +
        "where d.adrelid='public.projects'::regclass)," +
      "'catalog',jsonb_build_object('functions',(select jsonb_agg(jsonb_build_array(p.oid,p.proowner,p.proacl," +
        "p.prosecdef,p.provolatile,p.proisstrict,p.proconfig,pg_get_functiondef(p.oid)) order by p.oid) " +
        "from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','auth') and p.prokind in ('f','p')))) as evidence";
    const evidence = (await db.query(evidenceQuery)).rows[0].evidence;
    assert.equal((await db.query("select count(*)::integer as n from pg_attribute " +
      "where attrelid='public.projects'::regclass and attname='organization_id'")).rows[0].n, 0);
    await db.query("select set_config('steerfold.test_pre_rollout_evidence',$1,false)",[JSON.stringify(evidence)]);
    await db.exec("create function public.active_organization_id() returns uuid language sql stable as $$ select null::uuid $$;");
    for (const table of [...workspaceTables,"governance_user_roles"]) {
      await db.exec("alter table public." + table + " add column organization_id uuid;");
    }
    // Exact reviewed default-installation loop, extracted from the migration.
    const scope = migration.match(/foreach v_table in array array\[[^\]]+\] loop\s*execute format\('alter table public\.%I alter column organization_id set default public\.active_organization_id\(\)', v_table\);/)[0];
    await db.exec("do $$ declare v_table text; begin " + scope + " end loop; end; $$;");
    const after = (await db.query(evidenceQuery)).rows[0].evidence;
    assert.notDeepEqual(after.project_default_dependencies,evidence.project_default_dependencies,
      "The old full dependency comparison reproduces the exact false positive");
    assert.deepEqual(after.project_defaults,evidence.project_defaults,"Original defaults remain unchanged");
    const check = "do $check_defaults$ declare v_expected jsonb:=current_setting('steerfold.test_pre_rollout_evidence')::jsonb;" +
      " v_table text; v_reviewed_oids oid[]:=array[to_regprocedure('public.active_organization_id()')::oid]; begin " +
      block("ORIGINAL PROJECT DEFAULT CHECK") + block("WORKSPACE DEFAULT CHECK") + block("ORIGINAL FUNCTION CHECK") +
      " end; $check_defaults$;";
    await t.test("read-only verifier passes after intentional defaults without consuming IDs",async () => {
      try { await db.exec("begin read only;"); await db.exec(check); }
      finally { await db.exec("rollback;"); }
    });
    const rejects = async (label, mutation, expected) => t.test(label,async () => {
      try {
        await db.exec("begin;");
        await db.exec(mutation);
        await assert.rejects(db.exec(check), (error) => error.code==="P0001" && expected.test(error.message));
      } finally { await db.exec("rollback;"); }
      await db.exec(check);
    });
    await rejects("changed UUID default is rejected","alter table projects alter column id set default null;",/Project defaults/);
    await rejects("changed business-ID default is rejected","alter table projects alter column project_id set default 'tampered';",/Project defaults/);
    await rejects("different generator binding is rejected",
      "create function public.other_generator() returns text language sql as $$ select 'unused'::text $$;" +
      "alter table projects alter column project_id set default public.other_generator();",/Project defaults/);
    await rejects("timestamp default dependencies are still protected",
      "alter table projects alter column updated_at set default clock_timestamp();",/Project defaults/);
    await rejects("unchanged binding with changed generator body is rejected",
      "create or replace function public.generate_project_business_id() returns text language sql as $$ select 'changed'::text $$;",
      /unchanged generator/);
    await rejects("generator owner changes are rejected",
      "alter function public.generate_project_business_id() owner to replacement_owner;",/unchanged generator/);
    await rejects("generator ACL changes are rejected",
      "revoke execute on function public.generate_project_business_id() from public;",/unchanged generator/);
    for (const table of workspaceTables) {
      await rejects(table + " requires its exact tenant default",
        "alter table public." + table + " alter column organization_id drop default;",/Reviewed public.active_organization_id/);
    }
    await rejects("same value through another workspace function binding is rejected",
      "create schema wrong_binding; create function wrong_binding.active_organization_id() returns uuid language sql stable as $$ select null::uuid $$;" +
      "alter table projects alter column organization_id set default wrong_binding.active_organization_id();",
      /Reviewed public.active_organization_id/);
  } finally { await db.close(); }
});

test("isolated PostgreSQL compiles exact policy/constraint/view and function body pins", {
  skip: !process.env.STEERFOLD_PGLITE_PATH && "Requires an independently installed local PostgreSQL/WASM module.",
}, async () => {
  const { PGlite } = await import(pathToFileURL(process.env.STEERFOLD_PGLITE_PATH).href);
  const db = new PGlite();
  try {
    await db.exec("create role authenticated; create role anon; create schema auth; " +
      "create table auth.users(id uuid primary key);" +
      "create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;" +
      "create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role',true) $$;");
    for (const name of ["organizations", "organization_memberships"]) {
      await db.exec(migration.match(new RegExp("create table public\\." + name + " \\([\\s\\S]*?\\n\\);"))[0]);
    }
    const constraintPins = JSON.parse(verifier.match(/\$constraint_pins\$([\s\S]*?)\$constraint_pins\$/)[1]);
    const actual = (await db.query("select c.conrelid::regclass::text as table_name,c.conname,c.contype," +
      "regexp_replace(pg_get_constraintdef(c.oid,true),'[[:space:]]','','g') as definition " +
      "from pg_constraint c where c.conrelid in ('public.organizations'::regclass,'public.organization_memberships'::regclass) " +
      "and c.contype<>'n' order by table_name,conname")).rows;
    assert.deepEqual(actual, constraintPins);
    await db.exec("create table projects(id uuid,organization_id uuid);" +
      "create table change_requests(id uuid,organization_id uuid);" +
      "create table change_request_events(id uuid,organization_id uuid);" +
      "create table project_imports(id uuid,organization_id uuid,imported_by uuid);" +
      "create table project_import_rows(id uuid,organization_id uuid,import_id uuid);" +
      "create table governance_user_roles(user_id uuid,role text,organization_id uuid);");
    for (const name of ["active_organization_id", "_workspace_can_write", "_require_workspace_write", "current_user_has_governance_role", "list_my_workspaces"]) {
      await db.exec(definitions.find((row) => row[1] === name)[0]);
    }
    for (const policy of migration.matchAll(/^create policy[\s\S]*?;/gm)) await db.exec(policy[0]);
    const policies = (await db.query("select tablename,policyname,cmd,roles::text[] as roles," +
      "regexp_replace(coalesce(qual,''),'[[:space:]]','','g') as qual," +
      "regexp_replace(coalesce(with_check,''),'[[:space:]]','','g') as with_check " +
      "from pg_policies where schemaname='public' order by tablename,policyname")).rows;
    for (const row of policies) {
      assert.ok(verifier.includes("'" + row.qual + "'"), row.tablename + " qual");
      assert.ok(verifier.includes("'" + row.with_check + "'"), row.tablename + " check");
    }
    assert.equal(policies.length, 10);
    await db.exec(migration.match(/^create view public\.organization_settings[\s\S]*?^from public\.organizations[^;]+;/m)[0]);
    const view = (await db.query("select regexp_replace(pg_get_viewdef('public.organization_settings'::regclass,true),'[[:space:]]','','g') as def")).rows[0].def;
    assert.ok(verifier.includes("'" + view + "'"));
    for (const row of (await db.query("select proname,encode(sha256(convert_to(prosrc,'UTF8')),'hex') as hash " +
      "from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'")).rows) {
      assert.equal(pins.find((pin) => pin[1] === row.proname)[2], row.hash, row.proname);
    }
    // Execute the EXACT read-only probe block, not a reimplementation. All rows
    // here are isolated in-memory fixtures; no production backend is contacted.
    await db.exec("grant usage on schema auth to anon,authenticated;" +
      "grant execute on all functions in schema auth to anon,authenticated;" +
      "create table user_profiles(user_id uuid);" +
      "alter table user_profiles enable row level security;" +
      "create policy own_profile on user_profiles for select to authenticated using(user_id=auth.uid());" +
      "grant select on user_profiles to authenticated;" +
      "grant select on projects,organizations to anon,authenticated;" +
      "grant select on organization_memberships,project_imports,project_import_rows,change_requests,change_request_events to authenticated;" +
      "insert into organizations(id,organization_name,industry,organization_currency,is_demo) " +
        "values('00000000-0000-4000-8000-000000000001','Brisk & Zip','','CAD',true);" +
      "insert into projects(id,organization_id) select gen_random_uuid(),'00000000-0000-4000-8000-000000000001'::uuid from generate_series(1,11);");
    for (const name of ["projects","organizations","organization_memberships","project_imports","project_import_rows","change_requests","change_request_events"]) {
      await db.exec("alter table public." + name + " enable row level security;");
    }
    await db.exec("begin read only;");
    await db.exec(verifier.match(/do \$negative_reads\$[\s\S]*?\$negative_reads\$;/)[0]);
    assert.equal((await db.query("select current_user as who")).rows[0].who,"postgres");
    await assert.rejects(db.exec("insert into projects values(gen_random_uuid(),null)"), (error) => error.code==="25006");
    await db.exec("rollback;");
  } finally { await db.close(); }
});
