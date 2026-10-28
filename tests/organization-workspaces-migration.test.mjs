import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (name) => readFileSync(new URL(name, root), "utf8").replaceAll("\r\n", "\n");
const sql = read("supabase/migrations/20261028_organization_workspaces.sql");
const withoutReviewedText = (source) => source.replace(/\$reviewed_rls\$[\s\S]*?\$reviewed_rls\$/g, "'reviewed definition text'");
const definitions = (source) => [...withoutReviewedText(source).matchAll(/create (?:or replace )?function public\.(\w+)\([\s\S]*?\n\$\$;/gi)];
const funcs = new Map(definitions(sql).map(([body, name]) => [name, body]));
const body = (name) => {
  assert.ok(funcs.has(name), `Missing replacement: ${name}`);
  return funcs.get(name);
};
const writeRpcs = ["create_change_request", "update_draft_change_request", "delete_draft_change_request",
  "transition_change_request_status", "apply_approved_change_request", "assign_governance_role", "revoke_governance_role",
  "_analyze_project_import", "check_project_import", "commit_project_import", "set_organization_currency", "save_organization_profile"];

test("reviewed RLS infrastructure is an exact fail-closed exception shared with preflight", () => {
  const preflight = read("supabase/validation/organization_workspaces_preflight.sql");
  const guard = (source) => source.slice(source.indexOf("  -- This is one reviewed infrastructure exception"),
    source.indexOf("  if v_rls_problem is not null then"));
  assert.ok(guard(sql).length > 2000);
  assert.equal(guard(sql), guard(preflight));
  for (const source of [sql, preflight]) {
    assert.match(source, /v_rls_oid oid := to_regprocedure\('public\.rls_auto_enable\(\)'\)/);
    assert.match(source, /p\.prorettype = 'event_trigger'::regtype and p\.prosecdef/);
    assert.match(source, /p\.provolatile = 'v' and l\.lanname = 'plpgsql' and r\.rolname = 'postgres'/);
    assert.match(source, /p\.proconfig = array\['search_path=pg_catalog'\]::text\[\]/);
    assert.match(source, /evtfoid = v_rls_oid\) <> 1/);
    assert.match(source, /e\.evtname = 'ensure_rls' and e\.evtfoid = v_rls_oid/);
    assert.match(source, /e\.evtevent = 'ddl_command_end' and e\.evtenabled = 'O'/);
    assert.match(source, /array\['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO'\]::text\[\]/);
    assert.match(source, /v_rls_reviewed_sha256 is null/);
    assert.ok(source.includes("rtrim(replace(pg_catalog.pg_get_functiondef(v_rls_oid), E'\\r\\n', E'\\n'), E'\\r\\n')"));
    assert.match(source, /Unknown public event-trigger binding requires review/);
    assert.doesNotMatch(withoutReviewedText(source), /create (?:or replace )?function public\.rls_auto_enable|alter (?:event trigger ensure_rls|function public\.rls_auto_enable)/i);
  }
  assert.match(sql, /p\.oid <> v_rls_oid/);
  assert.match(preflight, /p\.oid is distinct from v_rls_oid/);
  for (const name of ["generator_implementation_reviewed", "project_and_auth_trigger_paths_reviewed", "external_auth_hooks_reviewed"]) {
    assert.ok(preflight.includes(`${name} boolean := true;`));
  }
  assert.match(preflight, /if cardinality\(stops\) > 0 then/);
  assert.match(preflight, /begin transaction isolation level repeatable read read only;/);
  assert.match(preflight, /rollback;\s*$/i);
});

test("supplied RLS definition is pinned identically and canonicalization never hides body edits", () => {
  const preflight = read("supabase/validation/organization_workspaces_preflight.sql");
  const expected = "62e77d28f3013a8047bb431be5f8b174ad51cdde883dcc3b0d6c6c0a84e954a3";
  const canonical = (text) => text.replaceAll("\r\n", "\n").replace(/[\r\n]+$/, "");
  const fingerprint = (text) => createHash("sha256").update(canonical(text), "utf8").digest("hex");
  const extract = (source) => source.split("$reviewed_rls$")[1];
  const reviewed = extract(sql);
  assert.equal(reviewed, extract(preflight));
  assert.equal(fingerprint(reviewed), expected);
  assert.equal(fingerprint(reviewed.replaceAll("\n", "\r\n") + "\r\n"), expected);
  for (const changed of [
    reviewed.replace("IN ('public')", "IN ('public','auth')"),
    reviewed.replace("enable row level security", "disable row level security"),
    reviewed.replace("END;\n$function$", "DELETE FROM public.projects;\nEND;\n$function$"),
    reviewed.replace("  cmd record;", " cmd record;"),
  ]) assert.notEqual(fingerprint(changed), expected);
  for (const source of [sql, preflight]) {
    assert.ok(source.includes("rtrim(replace(v_rls_reviewed_definition, E'\\r\\n', E'\\n'), E'\\r\\n')"));
    assert.doesNotMatch(source, /v_rls_reviewed_sha256 constant text := null/);
    assert.doesNotMatch(source, /execute\s+v_rls_reviewed_definition/i);
  }
});

test("all previous privileged RPCs are replaced, with personal profiles unchanged", () => {
  const latest = new Map();
  for (const name of readdirSync(new URL("supabase/migrations/", root)).sort()) {
    if (!name.endsWith(".sql") || name >= "20261028") continue;
    for (const [definition, functionName] of definitions(read(`supabase/migrations/${name}`))) latest.set(functionName, definition);
  }
  const exceptions = new Set(["get_my_profile", "save_my_profile"]);
  for (const [name, definition] of latest) {
    if (/security definer/i.test(definition) && !/returns trigger/i.test(definition) && !exceptions.has(name)) {
      assert.ok(funcs.has(name), `Uncovered existing SECURITY DEFINER RPC: ${name}`);
    }
  }
  for (const name of exceptions) assert.equal(funcs.has(name), false);
  assert.doesNotMatch(sql, /(?:alter|update|delete from|insert into)\s+public\.user_profiles/i);
});

test("CREATE OR REPLACE preserves existing argument names, types, defaults and return contracts", () => {
  const latest = new Map();
  for (const name of readdirSync(new URL("supabase/migrations/", root)).sort()) {
    if (!name.endsWith(".sql") || name >= "20261028") continue;
    for (const [definition, functionName] of definitions(read(`supabase/migrations/${name}`))) latest.set(functionName, definition);
  }
  const signature = (definition) => {
    const match = definition.match(/function public\.\w+\(([\s\S]*?)\)\s*returns\s+([\s\S]*?)\blanguage\b/i);
    assert.ok(match, "Expected a complete argument/return declaration");
    return match.slice(1).map((part) => part.replace(/\s+/g, " ").replace(/\s*([(),])\s*/g, "$1").trim());
  };
  let checked = 0;
  for (const [name, definition] of funcs) {
    if (!latest.has(name)) continue;
    assert.deepEqual(signature(definition), signature(latest.get(name)), name);
    checked++;
  }
  assert.equal(checked, 17);
});

test("dropped import constraint and source index exist by their exact prior names", () => {
  const prior = read("supabase/migrations/20261022_safe_project_import_foundation.sql");
  assert.match(prior, /constraint project_imports_actor_key_unique unique \(imported_by, idempotency_key\)/);
  assert.match(sql, /alter table public.project_imports drop constraint project_imports_actor_key_unique;/);
  assert.match(prior, /create unique index project_import_rows_source_unique/);
  assert.match(sql, /drop index public.project_import_rows_source_unique;/);
});

test("known baseline is asserted under locks before backfill and before commit", () => {
  assert.ok(sql.indexOf("set local time zone 'UTC';") < sql.indexOf("-- This rollout targets the verified"));
  assert.match(sql, /set local time zone 'UTC';/);
  const fingerprint = "8ec06c5d60751b598b089aa9d16ad3d7644f1cb3417149410c6e4af88c9f1758";
  assert.equal(sql.split(fingerprint).length - 1, 2);
  const before = sql.indexOf("-- This rollout targets the verified");
  assert.ok(before > sql.indexOf("public.organization_settings, public.user_profiles in share row exclusive mode;"));
  assert.ok(before < sql.indexOf("alter table public.%I add column organization_id"));
  assert.match(sql, /string_agg\(to_jsonb\(p\)::text, '' order by p.project_id\)/);
  assert.match(sql, /string_agg\(\(to_jsonb\(p\) - 'organization_id'\)::text, '' order by p.project_id\)/);
  assert.equal((sql.match(/v_count <> 11 or v_fingerprint/g) ?? []).length, 2);
  for (const [table, count] of [["project_imports", 1], ["project_import_rows", 1], ["change_requests", 2], ["change_request_events", 11]]) {
    assert.equal(sql.split(`(select count(*) from public.${table}) <> ${count}`).length - 1, 2, table);
  }
  assert.match(sql, /organization_name = 'Brisk & Zip' and organization_currency = 'CAD'/);
  assert.match(sql, /o.industry = s.industry and o.updated_at = s.updated_at/);
});

test("original public sequence states and definitions are read without advancing them", () => {
  assert.match(sql, /create temporary table workspace_sequence_snapshot/);
  assert.match(sql, /join pg_catalog.pg_sequence s on s.seqrelid = c.oid/);
  assert.match(sql, /where n.nspname = 'public' and c.relkind = 'S'/);
  assert.equal((sql.match(/select last_value, is_called from %s/g) ?? []).length, 2);
  assert.match(sql, /v_definition is distinct from v_before.definition/);
  assert.match(sql, /v_last is distinct from v_before.last_value or v_called is distinct from v_before.is_called/);
  assert.doesNotMatch(sql.replace(/--[^\n]*/g, ""), /\b(?:nextval|setval)\s*\(|\balter sequence\b|\brestart\s+with\b/i);
});

test("workspace discovery has the exact JSON shape and anonymous Demo restriction", () => {
  const list = body("list_my_workspaces");
  for (const field of ["id", "organization_name", "industry", "organization_currency", "is_demo", "can_write", "membership_role"]) {
    assert.ok(list.includes(`'${field}',`), field);
  }
  assert.match(list, /returns jsonb/);
  assert.match(list, /coalesce\(jsonb_agg/);
  assert.match(list, /and auth\.role\(\) = 'authenticated'/);
  assert.match(list, /where o\.is_demo or m\.user_id is not null/);
  assert.doesNotMatch(list, /active_organization_id/);
  assert.match(sql, /'active_organization_id\(\)', '_workspace_can_write\(uuid\)', 'list_my_workspaces\(\)'[\s\S]*?to anon, authenticated/);
  assert.match(sql, /industry text not null/);
  assert.match(body("_workspace_can_write"), /returns boolean/);
  assert.match(body("_workspace_can_write"), /select coalesce\([\s\S]*false\)/);
});

test("header parsing rejects absent, malformed, non-string and inaccessible IDs", () => {
  const active = body("active_organization_id");
  assert.match(active, /current_setting\('request.headers', true\)/);
  assert.match(active, /jsonb_typeof\(v_headers\) <> 'object'/);
  assert.match(active, /x-steerfold-organization-id/g);
  assert.match(active, /jsonb_typeof\(v_headers->'x-steerfold-organization-id'\) is distinct from 'string'/);
  assert.ok(active.includes("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"));
  assert.match(active, /exception when invalid_text_representation/);
  assert.match(active, /o\.is_demo or \(auth\.role\(\) = 'authenticated'/);
  assert.match(active, /m\.organization_id = o\.id and m\.user_id = auth\.uid\(\)/);
  assert.doesNotMatch(active, /limit 1|order by|coalesce\(v_id/);
});

test("new workspaces require explicit currency and start empty with scoped ownership", () => {
  const create = body("create_workspace");
  assert.match(create, /p_currency is null or p_currency <> all\(array\['CAD','USD','GBP','EUR'\]\)/);
  assert.match(create, /values \(v_org.id, auth.uid\(\), 'owner'\)/);
  assert.match(create, /values \(v_org.id, auth.uid\(\), 'governance_admin', auth.uid\(\)\)/);
  assert.match(create, /'is_demo', false, 'can_write', true, 'membership_role', 'owner'/);
  assert.doesNotMatch(create, /public\.(projects|change_requests|project_imports)|insert[\s\S]*?select/i);
  assert.doesNotMatch(sql, /organization_currency text not null default/);
  assert.doesNotMatch(sql, /create trigger[\s\S]{0,100}on auth\.users/i);
  assert.match(sql, /Remove automatic signup role\/membership hooks/);
});

test("all write entry points gate membership and frozen demo admin eligibility", () => {
  for (const name of writeRpcs) assert.match(body(name), /v_(?:org|id) uuid := public\._require_workspace_write\(\)/, name);
  assert.match(body("_require_workspace_write"), /public\.active_organization_id\(\)/);
  assert.match(body("_require_workspace_write"), /_workspace_can_write\(v_id\) is distinct from true/);
  const canWrite = body("_workspace_can_write");
  assert.match(canWrite, /auth\.role\(\) = 'authenticated' and auth\.uid\(\) is not null/);
  assert.match(canWrite, /not o\.is_demo or \(m\.demo_write_eligible and exists/);
  assert.match(canWrite, /r\.organization_id = o\.id[\s\S]*?r\.role = 'governance_admin'/);
  assert.match(sql, /demo_write_eligible boolean not null default false/);
  assert.match(sql, /bool_or\(role = 'governance_admin'\)/);
  assert.doesNotMatch(body("assign_governance_role"), /demo_write_eligible/);
});

test("every CR and baseline business lookup is explicitly tenant scoped", () => {
  assert.match(body("create_change_request"), /where organization_id = v_org and project_id = p_project_code/);
  for (const name of ["update_draft_change_request", "delete_draft_change_request", "transition_change_request_status", "apply_approved_change_request"]) {
    const source = body(name);
    assert.doesNotMatch(source, /where (?:id|change_request_id) =/i, name);
    assert.match(source, /where organization_id = v_org and id = p_change_request_id/, name);
  }
  const apply = body("apply_approved_change_request");
  assert.match(apply, /where organization_id = v_org and id = v_request.project_id[\s\S]*?for update/);
  assert.match(apply, /where organization_id = v_org and change_request_id = v_request.id/);
});

test("separation of duties and all lifecycle/application checks survive verbatim", () => {
  const prior = read("supabase/migrations/20261011_governance_separation_of_duties.sql");
  for (const [original, name] of definitions(prior)) {
    const normalized = body(name)
      .replace("  v_org uuid := public._require_workspace_write();\n", "")
      .replaceAll("where organization_id = v_org and ", "where ");
    assert.equal(normalized, original, `${name}: only tenant guards/predicates may differ`);
  }
});

test("roles, directory, target membership and last-admin protection are tenant scoped", () => {
  assert.match(body("current_user_has_governance_role"), /r\.organization_id = public\.active_organization_id\(\)/);
  assert.match(body("get_my_governance_roles"), /assignment\.organization_id = v_org and assignment\.user_id = v_user_id/);
  assert.match(body("list_governance_role_assignments"), /where assignment\.organization_id = v_org/);
  assert.match(body("list_governance_users"), /join public\.organization_memberships m[\s\S]*?m\.organization_id = v_org/);
  const assign = body("assign_governance_role");
  assert.match(assign, /from public\.organization_memberships\s+where organization_id = v_org and user_id = p_user_id for key share/);
  assert.match(assign, /on conflict \(organization_id, user_id, role\) do nothing/);
  assert.match(body("revoke_governance_role"), /where assignment\.organization_id = v_org and assignment\.role = 'governance_admin'\s+\) <= 1/);
});

test("SafeImport source identities, both live matches, acknowledgements and replay are scoped", () => {
  const analyze = body("_analyze_project_import");
  assert.match(analyze, /prior\.organization_id = v_org/);
  assert.equal((analyze.match(/project\.organization_id = v_org/g) ?? []).length, 2);
  assert.match(analyze, /jsonb_build_object\('organization_id', v_org, 'payload_hash', v_hash, 'conflict', item\)/);
  const commit = body("commit_project_import");
  assert.match(commit, /v_org::text \|\| ':' \|\| v_actor::text \|\| ':' \|\| p_idempotency_key::text/);
  assert.match(commit, /where organization_id = v_org and imported_by = v_actor and idempotency_key = p_idempotency_key/);
  assert.match(commit, /from public\.organizations\s+where id = v_org for share/);
  assert.ok(commit.indexOf("if found then") < commit.indexOf("where id = v_org for share"), "Historical replays must precede current currency validation");
  assert.match(commit, /v_prior.payload_hash <> v_hash or v_prior.acknowledgements <> v_acknowledgements/);
  assert.match(commit, /lock table public.projects in share row exclusive mode/);
  assert.match(commit, /v_acknowledgements <> v_expected/);
  assert.doesNotMatch(commit.replace(/--[^\n]*/g, ""), /update public\.projects|delete from public\.projects|on conflict/i);
  assert.match(body("get_project_import_result"), /where organization_id = v_org and imported_by = auth.uid\(\) and idempotency_key = p_idempotency_key/);
  assert.match(sql, /unique \(organization_id, imported_by, idempotency_key\)/);
  assert.match(sql, /on public.project_import_rows \(organization_id, source_namespace, source_project_id\)/);
});

test("child references cannot accept cross-workspace UUIDs, including retained provenance", () => {
  for (const relation of [
    /change_requests add foreign key \(organization_id, project_id\)\s+references public.projects\(organization_id, id\)/,
    /change_request_events add foreign key \(organization_id, change_request_id\)\s+references public.change_requests\(organization_id, id\)/,
    /project_import_rows add foreign key \(organization_id, import_id\)\s+references public.project_imports\(organization_id, id\)/,
    /project_import_rows add foreign key \(organization_id, project_uuid\)\s+references public.projects\(organization_id, id\) on delete set null \(project_uuid\)/,
    /governance_user_roles add foreign key \(organization_id, user_id\)\s+references public.organization_memberships\(organization_id, user_id\)/,
  ]) assert.match(sql, relation);
});

test("RLS replaces permissive legacy policies, blocks tenant moves and limits raw writes to projects", () => {
  assert.match(sql, /for v_policy in select policyname from pg_catalog.pg_policies/);
  assert.match(sql, /drop policy %I on public.%I/);
  assert.match(sql, /using \(organization_id = \(select public.active_organization_id\(\)\)\)/);
  assert.match(sql, /with check \(organization_id = \(select public.active_organization_id\(\)\) and public._workspace_can_write\(organization_id\)\)/);
  assert.match(body("_guard_workspace_row"), /old.organization_id is distinct from v_id/);
  assert.match(body("_guard_workspace_row"), /new.organization_id is distinct from v_id/);
  assert.match(sql, /before insert or update or delete on public.%I/);
  assert.match(sql, /grant insert, update, delete on public.projects to authenticated/);
  assert.doesNotMatch(sql, /grant (?:insert|update|delete)[^;]*on public\.(?:organizations|organization_memberships|governance_user_roles|change_requests|project_imports)/);
});

test("history retains authenticated-only and actor-bound import privacy", () => {
  assert.match(sql, /grant select on public.change_requests, public.change_request_events to authenticated/);
  assert.match(sql, /grant select on public.project_imports, public.project_import_rows to authenticated/);
  for (const table of ["change_requests", "change_request_events", "project_imports", "project_import_rows"]) {
    assert.doesNotMatch(sql, new RegExp(`grant select on public\\.${table}[^;]*to anon`));
    assert.doesNotMatch(sql, new RegExp(`on public\\.${table} for select to anon`));
  }
  assert.match(sql, /on public.project_imports for select to authenticated\s+using \(organization_id = \(select public.active_organization_id\(\)\) and imported_by = \(select auth.uid\(\)\) and exists/);
  assert.match(sql, /batch.organization_id = project_import_rows.organization_id and batch.imported_by = \(select auth.uid\(\)\)/);
  for (const table of ["change_requests", "change_request_events", "project_imports", "project_import_rows"]) {
    const policy = sql.match(new RegExp(`create policy \\w+ on public\\.${table} for select to authenticated[\\s\\S]*?;`))?.[0];
    assert.ok(policy, `Missing history policy: ${table}`);
    assert.ok(policy.includes("organization_id = (select public.active_organization_id())"), table);
    assert.ok(policy.includes("select 1 from public.organization_memberships m"), table);
    assert.ok(policy.includes(`m.organization_id = ${table}.organization_id and m.user_id = (select auth.uid())`), table);
  }
  const membershipPolicy = sql.match(/create policy own_membership_read[\s\S]*?;/)?.[0];
  assert.ok(membershipPolicy);
  assert.doesNotMatch(membershipPolicy, /\bexists\b|from public\./);
  assert.match(body("get_project_import_result"), /security invoker/);
});

test("Demo remains CAD even for eligible administrators", () => {
  assert.match(sql, /organizations_demo_currency_cad check \(not is_demo or organization_currency = 'CAD'\)/);
  const currency = body("set_organization_currency");
  assert.match(currency, /if v_org.is_demo and p_currency <> 'CAD' then\s+raise exception 'Demo workspace currency must remain CAD.'/);
  assert.ok(currency.indexOf("if v_org.is_demo") < currency.indexOf("update public.organizations"));
});

test("settings is a read-only invoker view; settings RPCs lock the selected organization", () => {
  assert.match(sql, /rename to _legacy_organization_settings/);
  assert.match(sql, /revoke all on public._legacy_organization_settings from public, anon, authenticated/);
  assert.match(sql, /create view public.organization_settings with \(security_invoker = true, security_barrier = true\)/);
  assert.match(sql, /select true as id,[\s\S]*?o.id as organization_id[\s\S]*?where o.id = public.active_organization_id\(\)/);
  for (const name of ["set_organization_currency", "save_organization_profile"]) {
    assert.match(body(name), /from public.organizations where id = v_id for update/);
    assert.match(body(name), /current_user_has_governance_role\('governance_admin'\)/);
    assert.doesNotMatch(body(name), /update public.organization_settings/);
  }
});

test("backfill preserves audit data and restores original trigger modes", () => {
  assert.match(sql, /create temporary table workspace_preservation_snapshot/);
  assert.match(sql, /public.organization_settings, public.user_profiles in share row exclusive mode/);
  assert.equal((sql.match(/string_agg\(row_hash, '' order by row_hash\)/g) ?? []).length, 2);
  assert.equal((sql.match(/to_jsonb\(t\) - 'organization_id'/g) ?? []).length, 2);
  assert.match(sql, /v_count is distinct from v_before.row_count or v_fingerprint is distinct from v_before.fingerprint/);
  assert.match(sql, /when 'organization_settings' then '_legacy_organization_settings'/);
  assert.match(sql, /t.tgenabled is distinct from s.tgenabled/);
  assert.match(sql, /create temporary table workspace_trigger_state on commit drop/);
  assert.match(sql, /where tgenabled <> 'D'/);
  assert.match(sql, /when 'R' then 'replica ' when 'A' then 'always '/);
  assert.match(sql, /update public.%I set organization_id = %L::uuid/);
  assert.doesNotMatch(sql, /update public\.(?:projects|change_request_events|project_imports|project_import_rows)\s+set (?:result|id|project_id|created_at|updated_at)/);
  assert.match(sql, /'public\.commit_project_import\(uuid,jsonb,jsonb\)'::regprocedure/);
  assert.match(sql, /Unreviewed SECURITY DEFINER functions/);
});

test("every new or replaced function is hardened and covered by the ACL reset", () => {
  const acl = sql.slice(sql.indexOf("-- New functions never retain"));
  for (const [name, source] of funcs) {
    assert.match(source, /set search_path = ''/, name);
    assert.ok(acl.includes(`'${name}(`), `Missing ACL entry: ${name}`);
  }
  assert.match(acl, /revoke all on function public.%s from public, anon, authenticated/);
  const anonSection = acl.slice(acl.indexOf("  foreach v_signature", acl.indexOf("end loop;")), acl.lastIndexOf("  foreach v_signature"));
  assert.doesNotMatch(anonSection, /create_workspace|assign_governance_role|commit_project_import|_require_workspace_write/);
  assert.equal((sql.match(/^begin;$/gm) ?? []).length, 1);
  assert.equal((sql.match(/^commit;$/gm) ?? []).length, 1);
  assert.equal(sql.trim().endsWith("commit;"), true);
  assert.equal(sql.split("\n").some((line) => /\s+$/.test(line)), false);
});
