import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const migration = read("supabase/migrations/20261028_organization_workspaces.sql");
const rehearsal = read("supabase/validation/organization_workspaces_rehearsal.sql");
const verify = read("supabase/validation/organization_workspaces_rollback_verify.sql");
const capture = read("supabase/validation/organization_workspaces_baseline_capture.sql");
const section = (source, label) => {
  const start = `-- BEGIN REHEARSAL-ONLY ${label}\n`;
  const end = `-- END REHEARSAL-ONLY ${label}\n`;
  assert.ok(source.includes(start) && source.includes(end), label);
  return source.split(start)[1].split(end)[0];
};
const probes = section(rehearsal, "VALIDATION");
const manifest = (source) => source.split("-- MANIFEST CALCULATION BEGIN:")[1].split("-- MANIFEST CALCULATION END")[0];
const baselineInput = (source) => {
  const matches = [...source.matchAll(/v_expected constant jsonb := \$baseline_manifest\$([\s\S]*?)\$baseline_manifest\$::jsonb/g)];
  assert.equal(matches.length, 1);
  const value = JSON.parse(matches[0][1]);
  assert.ok(value === null || typeof value === "object" && !Array.isArray(value));
  return value;
};

test("rehearsal restores the exact reviewed migration when marked insertions and final rollback are reversed", () => {
  let restored = rehearsal;
  for (const label of ["HEADER", "BASELINE", "EVENT CHECK", "VALIDATION", "RESULT"]) {
    const start = `-- BEGIN REHEARSAL-ONLY ${label}\n`;
    const end = `-- END REHEARSAL-ONLY ${label}\n`;
    const block = start + section(rehearsal, label) + end;
    assert.equal(restored.split(block).length, 2, `Exactly one ${label} block`);
    const separator = label === "BASELINE" ? "\n\n" : label === "VALIDATION" ? "\n" : "";
    restored = restored.replace(block + separator, "");
  }
  restored = restored.replace(/rollback;\s*$/i, "commit;\n");
  assert.equal(restored, migration);
});

test("both artifacts have one opening BEGIN, no top-level COMMIT, and mandatory final ROLLBACK", () => {
  for (const source of [rehearsal, verify, capture]) {
    assert.equal((source.match(/^begin(?: transaction[^;]*)?;$/gmi) || []).length, 1);
    assert.equal((source.match(/^commit(?: transaction)?;$/gmi) || []).length, 0);
    assert.equal((source.match(/^rollback;$/gmi) || []).length, 1);
    assert.match(source, /rollback;\s*$/i);
    assert.doesNotMatch(source, /\b(?:prepare transaction|commit prepared|dblink_exec)\b/i);
  }
  assert.match(verify, /begin transaction isolation level repeatable read read only;/);
});

test("fixture setup precedes validation as a separate statement and cleanup precedes final preservation checks", () => {
  assert.ok(probes.indexOf("$tenant_fixture_setup$;") < probes.indexOf("do $tenant_probes$"));
  assert.ok(rehearsal.indexOf("$tenant_probes$;") < rehearsal.indexOf("declare v_before record;"));
  assert.ok(probes.indexOf("$tenant_fixture_cleanup$;") > probes.indexOf("$tenant_probes$;"));
  assert.match(probes, /raise exception using errcode='PZ002'/);
  assert.match(probes, /when sqlstate 'PZ002'/);
  assert.match(probes, /if v_after is distinct from v_before then/);
  assert.match(probes, /Probe fixture cleanup\/context restoration failed/);
  assert.doesNotMatch(rehearsal, /insert into auth\.users|delete from auth\.users|update auth\.users/i);
});

test("no rehearsal statement invokes ID generation, import commit, or sequence advancement", () => {
  const additions = ["BASELINE", "EVENT CHECK", "VALIDATION", "RESULT"].map((label) => section(rehearsal, label)).join("\n");
  assert.doesNotMatch(additions + verify, /\b(?:nextval|setval|generate_project_business_id)\s*\(/i);
  assert.doesNotMatch(additions + verify, /\b(?:perform|select|call)\s+(?:public\.)?commit_project_import\s*\(/i);
  assert.doesNotMatch(additions + verify, /\balter\s+sequence|\brestart\s+with/i);
  assert.equal((probes.match(/insert into public\.projects select \(jsonb_populate_record/g) || []).length, 2);
  assert.match(probes, /'id',v_pa,'project_id','P900000001'/);
  assert.match(probes, /'id',v_pb,'project_id','P900000002'/);
  assert.match(verify, /'project_business_id_seq'->>'last_value' is distinct from '12'/);
  assert.match(verify, /'project_business_id_seq'->>'is_called' is distinct from 'true'/);
});

test("baseline manifest is computed identically before migration and after rollback, without self-baselining", () => {
  assert.equal(manifest(rehearsal), manifest(verify));
  assert.equal(manifest(rehearsal), manifest(capture));
  baselineInput(verify);
  assert.match(verify, /v_manifest is distinct from v_expected/);
  for (const term of ["approved_projects_fingerprint", "catalog_sha256", "organization_settings_row", "sequences",
    "functions", "triggers", "event_triggers", "policies", "indexes", "constraints", "roles", "default_acls"]) {
    assert.ok(verify.includes(`'${term}'`), term);
  }
  assert.ok(verify.includes("8ec06c5d60751b598b089aa9d16ad3d7644f1cb3417149410c6e4af88c9f1758"));
  for (const name of ["public.organizations", "public.organization_memberships", "public._legacy_organization_settings"]) {
    assert.ok(verify.includes(`to_regclass('${name}') is not null`), name);
  }
  assert.doesNotMatch(verify, /\b(?:create|alter|drop)\s+(?:table|function|policy|role|index|trigger)|\b(?:insert into|update public\.|delete from)\b/i);
});

test("separate read-only capture survives rehearsal errors and the rehearsal requires its exact saved baseline", () => {
  assert.match(capture, /begin transaction isolation level repeatable read read only;/);
  baselineInput(rehearsal);
  assert.match(rehearsal, /v_expected is distinct from v_manifest/);
  assert.match(rehearsal, /must match the locked current baseline exactly/);
  assert.doesNotMatch(capture, /\b(?:create|alter|drop)\s+(?:table|function|policy|role|index|trigger)|\b(?:insert into|update public\.|delete from)\b/i);
});

test("baseline exports cannot close inner or outer SQL dollar quotes and retain exact JSON data", () => {
  assert.ok(capture.includes("replace(current_setting('steerfold.workspace_rehearsal_baseline'), chr(36), chr(92) || 'u0024') as baseline_manifest"));
  assert.equal((rehearsal.match(/replace\(manifest::text, chr\(36\), chr\(92\) \|\| 'u0024'\)/g) || []).length, 2);
  const hostile = { organization_settings_row: { industry: "$baseline_manifest$ $capture_baseline$ $rollback_verify$ $$ ; COMMIT; SELECT nextval('x'); --" },
    nested: ["'quoted'", "\\u0024", "\\", "\"", "line\nfeed"] };
  const exported = JSON.stringify(hostile).replaceAll("$", "\\u0024");
  assert.equal(exported.includes("$"), false);
  assert.deepEqual(JSON.parse(exported), hostile);
  for (const source of [rehearsal, verify]) {
    baselineInput(source);
    assert.match(source, /jsonb_typeof\(v_expected\) is distinct from 'object'/);
    assert.ok(source.includes("v_expected is distinct from v_manifest") || source.includes("v_manifest is distinct from v_expected"));
    assert.doesNotMatch(source, /execute\s+v_expected|format\([^\n]*v_expected/i);
  }
});

test("tenant probes use actual anon/authenticated roles and verify expected public Demo versus private history", () => {
  assert.match(probes, /execute format\('set local role %I',p_role\)/);
  assert.match(probes, /'authenticated'/);
  assert.match(probes, /'anon'/);
  for (const reason of ["Workspace discovery leaked", "Cross-workspace project update", "Project tenant ownership",
    "inaccessible workspace rejected", "missing workspace header rejected", "malformed workspace header rejected", "workflow wildcard", "Demo nonmember",
    "anonymous private workspace denied", "anonymous profiles denied", "anonymous governance denied", "anonymous imports denied"]) {
    if (reason === "Project tenant ownership") assert.ok(probes.includes("project tenant move rejected"));
    else assert.ok(probes.includes(reason), reason);
  }
  assert.match(probes, /public\.check_project_import\(%L::jsonb\)/);
  assert.match(probes, /Import review in A leaked matches from B\/Demo/);
  assert.match(probes, /current A currency EUR/);
  assert.match(probes, /public\.get_project_import_result\(%L::uuid\)/);
  assert.match(probes, /public\.apply_approved_change_request\(%L::uuid/);
});

test("every identity-changing validation uses a rollback-scoped invoker probe and verifies full context restoration", () => {
  const runner = probes.split("as $probe_runner$")[1].split("$probe_runner$;")[0];
  const validation = probes.split("do $tenant_probes$")[1].split("$tenant_probes$;")[0];
  assert.equal((validation.match(/perform pg_temp\.workspace_rehearsal_probe\(/g) || []).length, 20);
  const orchestrationOnly = validation.replace(/\$probe_sql\$[\s\S]*?\$probe_sql\$/g, "'reviewed probe literal'");
  assert.doesNotMatch(orchestrationOnly, /execute .*set local role|perform set_config/);
  for (const key of ["role", "request.headers", "request.jwt.claim.sub", "request.jwt.claim.role", "request.jwt.claims"]) {
    assert.equal((runner.match(new RegExp(`current_setting\\('${key.replaceAll(".", "\\.")}'`, "g")) || []).length >= 2, true, key);
  }
  assert.match(runner, /when others then[\s\S]*get stacked diagnostics/);
  assert.match(runner, /p_expected_sqlstate is not null and \(v_finished or v_code is distinct from p_expected_sqlstate\)/);
  assert.match(runner, /expected SQLSTATE %; owner\/admin context restored/);
  assert.match(runner, /Simulated context=%s; original role\/JWT\/header restored/);
  assert.match(validation, /Post-probe validation lost intended owner\/admin\/Demo context/);
  assert.match(probes, /cross-workspace baseline application rejected[\s\S]*?'P0002'/);
  assert.match(probes, /inaccessible workspace rejected[\s\S]*?'42501'/);
  assert.doesNotMatch(runner, /security definer/i);
});

test("RLS event compatibility is checked before explicit migration RLS setup; unknown security still fails closed", () => {
  const event = section(rehearsal, "EVENT CHECK");
  assert.match(event, /relrowsecurity\) <> 2/);
  assert.ok(rehearsal.indexOf("-- BEGIN REHEARSAL-ONLY EVENT CHECK") < rehearsal.indexOf("alter table public.%I enable row level security"));
  assert.match(rehearsal, /Unknown public event-trigger binding requires review/);
  assert.match(rehearsal, /Unreviewed SECURITY DEFINER functions/);
  assert.match(probes, /Unreviewed privileged function or original function\/ACL change/);
  assert.match(probes, /Event-trigger configuration changed/);
  assert.match(probes, /not \(p\.oid = any\(v_reviewed_oids\)\)/);
  assert.doesNotMatch(probes, /p\.proname = any\(v_replaced_names\)/);
});

test("new SQL artifacts have no trailing whitespace", () => {
  for (const source of [rehearsal, verify, capture]) {
    assert.equal(source.split("\n").some((line) => /\s+$/.test(line)), false);
  }
});
