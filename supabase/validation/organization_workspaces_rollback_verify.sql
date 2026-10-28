-- OWNER-RUN, SEPARATE SECOND STEP. No objects are created/modified here.
-- After rehearsal ends (or after issuing ROLLBACK on ANY error), paste the exact
-- BASELINE_MANIFEST JSON into the marked constant below, then run ENTIRE file.
-- Never substitute newly observed state for the saved pre-rehearsal baseline.
-- A missing manifest fails closed. PASS is not migration/rollout authorization.
begin transaction isolation level repeatable read read only;
set local time zone 'UTC';
set local search_path = pg_catalog, public;
set local statement_timeout = '60s';
do $rollback_verify$
declare
  -- REPLACE JSON null ONLY with the verbatim safe-text BASELINE_MANIFEST cell.
  -- Preserve JSON \u0024 escapes. Never paste reformatted/unescaped JSON or edit delimiters.
  v_expected constant jsonb := $baseline_manifest$null$baseline_manifest$::jsonb;
  v_manifest jsonb; v_catalog jsonb; v_sequences jsonb;
  v_table text; v_count bigint; v_hash text; v_seq record; v_last bigint; v_called boolean;
begin
  if current_user <> 'postgres' then raise exception 'STOP: Run as the reviewed postgres SQL Editor owner.'; end if;
  if v_expected is null or jsonb_typeof(v_expected) is distinct from 'object'
    or v_expected->>'manifest_version' is distinct from '1' then
    raise exception 'STOP: Paste the original saved BASELINE_MANIFEST JSON; no post-rollback substitute is acceptable.';
  end if;
  if to_regclass('public.organizations') is not null or to_regclass('public.organization_memberships') is not null
    or to_regclass('public._legacy_organization_settings') is not null
    or exists(select 1 from pg_attribute where attrelid='public.projects'::regclass
      and attname='organization_id' and not attisdropped)
    or not exists(select 1 from pg_class where oid='public.organization_settings'::regclass and relkind='r') then
    raise exception 'STOP: Workspace schema remains or original settings table was not restored.';
  end if;
  -- MANIFEST CALCULATION BEGIN: identical in rehearsal and rollback verifier.
  v_manifest := jsonb_build_object('manifest_version', 1, 'database', current_database(),
    'server_version_num', current_setting('server_version_num'));
  foreach v_table in array array['projects','project_imports','project_import_rows',
    'change_requests','change_request_events','organization_settings','governance_user_roles','user_profiles'] loop
    execute format($query$
      select count(*), encode(sha256(convert_to(coalesce(string_agg(row_hash, '' order by row_hash), ''), 'UTF8')), 'hex')
      from (select encode(sha256(convert_to(to_jsonb(t)::text, 'UTF8')), 'hex') as row_hash
        from public.%I t) rows
    $query$, v_table) into v_count, v_hash;
    v_manifest := jsonb_set(v_manifest, array[v_table], jsonb_build_object('count', v_count, 'sha256', v_hash));
  end loop;
  select encode(sha256(convert_to(coalesce(string_agg(to_jsonb(p)::text, '' order by p.project_id), ''), 'UTF8')), 'hex')
    into v_hash from public.projects p;
  v_manifest := v_manifest || jsonb_build_object('approved_projects_fingerprint', v_hash,
    'organization_settings_row', (select to_jsonb(s) from public.organization_settings s));
  -- Semantic catalogs only: exclude planner statistics/physical file changes.
  select jsonb_build_object(
    'relations', (select jsonb_agg(jsonb_build_array(c.oid, n.nspname, c.relname, c.relkind,
      c.relowner, c.relacl, c.relrowsecurity, c.relforcerowsecurity, c.reloptions) order by c.oid)
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'),
    'columns', (select jsonb_agg(jsonb_build_array(a.attrelid, a.attnum, a.attname, a.atttypid,
      a.atttypmod, a.attnotnull, a.attidentity, a.attgenerated, a.attcollation, a.attacl,
      a.attisdropped, pg_get_expr(d.adbin, d.adrelid)) order by a.attrelid, a.attnum)
      from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid = a.attrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where n.nspname = 'public' and a.attnum > 0),
    'constraints', (select jsonb_agg(jsonb_build_array(c.oid, c.conname, c.conrelid, c.confrelid,
      c.convalidated, pg_get_constraintdef(c.oid, true)) order by c.oid)
      from pg_catalog.pg_constraint c join pg_catalog.pg_namespace n on n.oid = c.connamespace
      where n.nspname = 'public'),
    'indexes', (select jsonb_agg(jsonb_build_array(i.indexrelid, i.indisvalid, i.indisready,
      pg_get_indexdef(i.indexrelid)) order by i.indexrelid)
      from pg_catalog.pg_index i join pg_catalog.pg_class c on c.oid = i.indrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'),
    'policies', (select jsonb_agg(to_jsonb(p) order by p.tablename, p.policyname)
      from pg_catalog.pg_policies p where p.schemaname = 'public'),
    'functions', (select jsonb_agg(jsonb_build_array(p.oid, p.proowner, p.proacl,
      p.prosecdef, p.provolatile, p.proisstrict, p.proconfig, pg_get_functiondef(p.oid)) order by p.oid)
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public','auth') and p.prokind in ('f','p')),
    'triggers', (select jsonb_agg(jsonb_build_array(t.oid, t.tgrelid, t.tgname, t.tgenabled,
      pg_get_triggerdef(t.oid, true)) order by t.oid)
      from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public','auth') and not t.tgisinternal),
    'event_triggers', (select jsonb_agg(to_jsonb(e) order by e.oid) from pg_catalog.pg_event_trigger e),
    'namespaces', (select jsonb_agg(jsonb_build_array(n.oid, n.nspname, n.nspowner, n.nspacl) order by n.oid)
      from pg_catalog.pg_namespace n where n.nspname in ('public','auth')),
    'roles', (select jsonb_agg(to_jsonb(r) - 'rolpassword' order by r.oid) from pg_catalog.pg_roles r),
    'role_memberships', (select jsonb_agg(to_jsonb(m) order by m.roleid, m.member) from pg_catalog.pg_auth_members m),
    'default_acls', (select jsonb_agg(to_jsonb(a) order by a.oid) from pg_catalog.pg_default_acl a)
  ) into v_catalog;
  v_manifest := v_manifest || jsonb_build_object('catalog_sha256',
    encode(sha256(convert_to(v_catalog::text, 'UTF8')), 'hex'));
  v_sequences := '{}'::jsonb;
  for v_seq in select c.oid, c.relname, c.relowner, c.relacl, to_jsonb(s) as definition
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_sequence s on s.seqrelid = c.oid where n.nspname = 'public' order by c.oid loop
    execute format('select last_value, is_called from %s', v_seq.oid::regclass) into v_last, v_called;
    v_sequences := v_sequences || jsonb_build_object(v_seq.relname, jsonb_build_object(
      'oid', v_seq.oid, 'owner', v_seq.relowner, 'acl', v_seq.relacl, 'definition', v_seq.definition,
      'last_value', v_last, 'is_called', v_called));
  end loop;
  v_manifest := v_manifest || jsonb_build_object('sequences', v_sequences);
  if v_manifest->'projects'->>'count' <> '11'
    or v_manifest->>'approved_projects_fingerprint' is distinct from
      '8ec06c5d60751b598b089aa9d16ad3d7644f1cb3417149410c6e4af88c9f1758'
    or v_manifest->'project_imports'->>'count' <> '1'
    or v_manifest->'project_import_rows'->>'count' <> '1'
    or v_manifest->'change_requests'->>'count' <> '2'
    or v_manifest->'change_request_events'->>'count' <> '11'
    or v_manifest->'organization_settings'->>'count' <> '1'
    or v_manifest->'organization_settings_row'->>'organization_name' is distinct from 'Brisk & Zip'
    or v_manifest->'organization_settings_row'->>'organization_currency' is distinct from 'CAD'
    or v_sequences->'project_business_id_seq'->>'last_value' is distinct from '12'
    or v_sequences->'project_business_id_seq'->>'is_called' is distinct from 'true' then
    raise exception 'STOP: Approved business baseline or reviewed sequence state differs.';
  end if;
  -- MANIFEST CALCULATION END

  if v_manifest is distinct from v_expected then
    raise exception using message='STOP: Rollback verification differs from original baseline.',
      detail=(select string_agg(k.key,', ' order by k.key) from (
        select key from jsonb_object_keys(v_expected || v_manifest) keys(key)
        where v_expected->key is distinct from v_manifest->key
      ) k), hint='Do not rerun migration, reset sequences, or overwrite baseline. Investigate with owner/backup.';
  end if;
  raise notice 'PASS: Original project/history/profile/organization data, schema, policies/RLS, ACLs, functions, triggers, roles and ALL public sequence states match saved baseline.';
end;
$rollback_verify$;
select 'PASS_AFTER_ROLLBACK' as rollback_verification,
  '11 projects; approved fingerprint; imports=1, rows=1, requests=2, events=11; business sequence=12/called; full saved manifest matched. NOT rollout authorization.' as scope;
rollback;
