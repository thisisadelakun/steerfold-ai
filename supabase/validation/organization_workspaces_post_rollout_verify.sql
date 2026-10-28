-- OWNER-RUN AFTER the exact migration, BEFORE any new Auth/profile/business writes.
-- READ ONLY. A PASS is a database gate, not proof of browser/CORS behavior.
-- Paste the complete safe ROLLOUT_EVIDENCE cell from rollout_capture into the ONE
-- marked null below. Do not unescape JSON dollar signs or paste a grid/CSV wrapper.
-- Missing/malformed/incomplete evidence fails closed. On ANY error issue ROLLBACK;
-- and keep traffic held. This ROLLBACK cannot undo an already committed migration.
begin transaction isolation level repeatable read read only;
set local time zone 'UTC';
set local search_path = pg_catalog, public;
set local statement_timeout = '120s';
set local lock_timeout = '5s';

do $preservation$
declare
  -- OWNER INPUT BEGIN (data only; never interpolated into executable SQL).
  v_expected constant jsonb := $rollout_evidence$null$rollout_evidence$::jsonb;
  -- OWNER INPUT END
  v_manifest jsonb; v_catalog jsonb; v_sequences jsonb;
  v_table text; v_count bigint; v_hash text; v_seq record; v_last bigint; v_called boolean;
  v_item jsonb; v_current jsonb; v_profile oid;
  v_trigger record; v_original_definition text; v_expected_type smallint;
begin
  if current_user <> 'postgres' then raise exception 'STOP: Run as postgres owner.'; end if;
  if jsonb_typeof(v_expected) is distinct from 'object'
    or v_expected->>'rollout_format' is distinct from '1'
    or v_expected->>'manifest_version' is distinct from '1'
    or v_expected->>'database' is distinct from current_database()
    or v_expected->>'server_version_num' is distinct from current_setting('server_version_num')
    or v_expected->>'catalog_sha256' is distinct from
       encode(sha256(convert_to((v_expected->'catalog')::text,'UTF8')),'hex')
    or v_expected->'catalog' is null or v_expected->'function_contracts' is null
    or jsonb_typeof(v_expected->'catalog'->'functions') is distinct from 'array'
    or jsonb_typeof(v_expected->'catalog'->'event_triggers') is distinct from 'array'
    or v_expected->'project_defaults' is null or v_expected->'project_default_dependencies' is null then
    raise exception 'STOP: Paste complete fresh pre-rollout evidence; do not manufacture a post-rollout baseline.';
  end if;
  foreach v_table in array array['organizations','organization_memberships','projects',
    '_legacy_organization_settings','organization_settings','user_profiles'] loop
    if to_regclass('public.'||v_table) is null then raise exception 'STOP: Missing %',v_table; end if;
  end loop;
  -- Post-rollout projection: original fields only, excluding added tenant metadata.
  v_manifest := jsonb_build_object('manifest_version', 1, 'database', current_database(),
    'server_version_num', current_setting('server_version_num'));
  foreach v_table in array array['projects','project_imports','project_import_rows',
    'change_requests','change_request_events','organization_settings','governance_user_roles','user_profiles'] loop
    execute format($query$
      select count(*), encode(sha256(convert_to(coalesce(string_agg(row_hash, '' order by row_hash), ''), 'UTF8')), 'hex')
      from (select encode(sha256(convert_to((to_jsonb(t) - 'organization_id')::text, 'UTF8')), 'hex') as row_hash
        from public.%I t) rows
    $query$, case when v_table='organization_settings' then '_legacy_organization_settings' else v_table end) into v_count, v_hash;
    v_manifest := jsonb_set(v_manifest, array[v_table], jsonb_build_object('count', v_count, 'sha256', v_hash));
  end loop;
  select encode(sha256(convert_to(coalesce(string_agg((to_jsonb(p) - 'organization_id')::text, '' order by p.project_id), ''), 'UTF8')), 'hex')
    into v_hash from public.projects p;
  v_manifest := v_manifest || jsonb_build_object('approved_projects_fingerprint', v_hash,
    'organization_settings_row', (select to_jsonb(s) from public._legacy_organization_settings s));
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
  -- End post-rollout projection.
  foreach v_table in array array['projects','project_imports','project_import_rows',
    'change_requests','change_request_events','organization_settings','governance_user_roles','user_profiles'] loop
    if v_manifest->v_table is distinct from v_expected->v_table then
      raise exception 'STOP: Original data/count changed: %',v_table;
    end if;
  end loop;
  if v_manifest->'organization_settings_row' is distinct from v_expected->'organization_settings_row'
    or v_sequences is distinct from v_expected->'sequences'
    or v_catalog->'event_triggers' is distinct from v_expected->'catalog'->'event_triggers'
    or v_catalog->'roles' is distinct from v_expected->'catalog'->'roles'
    or v_catalog->'role_memberships' is distinct from v_expected->'catalog'->'role_memberships'
    or v_catalog->'namespaces' is distinct from v_expected->'catalog'->'namespaces'
    or v_catalog->'default_acls' is distinct from v_expected->'catalog'->'default_acls' then
    raise exception 'STOP: Organization archive, sequence state/definition, event triggers, roles or schema grants changed.';
  end if;
  -- Personal profile schema/policies/grants remain EXACTLY as captured.
  v_profile := 'public.user_profiles'::regclass;
  foreach v_table in array array['relations','columns','constraints','indexes'] loop
    select jsonb_agg(x order by x::text) into v_current from jsonb_array_elements(v_catalog->v_table) x
    where case v_table when 'relations' then (x->>0)::oid=v_profile
      when 'columns' then (x->>0)::oid=v_profile
      when 'constraints' then (x->>2)::oid=v_profile
      when 'indexes' then exists(select 1 from pg_index i where i.indexrelid=(x->>0)::oid and i.indrelid=v_profile) end;
    select jsonb_agg(x order by x::text) into v_item from jsonb_array_elements(v_expected->'catalog'->v_table) x
    where case v_table when 'relations' then (x->>0)::oid=v_profile
      when 'columns' then (x->>0)::oid=v_profile
      when 'constraints' then (x->>2)::oid=v_profile
      when 'indexes' then exists(select 1 from pg_index i where i.indexrelid=(x->>0)::oid and i.indrelid=v_profile) end;
    if v_current is distinct from v_item then raise exception 'STOP: Profile catalog changed: %',v_table; end if;
  end loop;
  if (select jsonb_agg(x order by x::text) from jsonb_array_elements(v_catalog->'policies') x where x->>'tablename'='user_profiles')
     is distinct from
     (select jsonb_agg(x order by x::text) from jsonb_array_elements(v_expected->'catalog'->'policies') x where x->>'tablename'='user_profiles') then
    raise exception 'STOP: Personal profile RLS changed.';
  end if;
  if (select jsonb_agg(jsonb_build_array(a.attname,pg_get_expr(d.adbin,d.adrelid)) order by a.attname)
      from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid='public.projects'::regclass and a.attname in ('id','project_id'))
      is distinct from v_expected->'project_defaults'
    or (select jsonb_agg(to_jsonb(dep) order by dep.objid,dep.refobjid,dep.refobjsubid)
      from pg_attrdef d join pg_depend dep on dep.classid='pg_attrdef'::regclass and dep.objid=d.oid
      join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum
      where d.adrelid='public.projects'::regclass and a.attname <> 'organization_id')
      is distinct from v_expected->'project_default_dependencies'
    or to_regprocedure('public.generate_project_business_id()') is null then
    raise exception 'STOP: Project defaults/generator bindings changed.';
  end if;
  -- Check the new default separately; all original ID/timestamp dependencies above remain exact.
  foreach v_table in array array['projects','change_requests','change_request_events','project_imports','project_import_rows'] loop
    if not exists(select 1 from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum
      where a.attrelid=to_regclass('public.'||v_table) and a.attname='organization_id'
        and pg_get_expr(d.adbin,d.adrelid)='active_organization_id()'
        and exists(select 1 from pg_depend dep where dep.classid='pg_attrdef'::regclass and dep.objid=d.oid
          and dep.refclassid='pg_proc'::regclass and dep.refobjid=to_regprocedure('public.active_organization_id()'))) then
      raise exception 'STOP: Reviewed public.active_organization_id() default missing/changed: %',v_table;
    end if;
  end loop;
  -- No generator calls: inspect the exact function through the unchanged-function
  -- check below. Compare all original user triggers and reject unknown additions.
  -- ORIGINAL TRIGGER CHECK BEGIN
  if (select count(*) from jsonb_array_elements(v_expected->'catalog'->'triggers') x where x->>2=any(array[
    'organization_settings_update','organization_settings_no_delete','organization_settings_no_truncate'])) <> 3
    or (select count(*) from pg_trigger where tgrelid='public._legacy_organization_settings'::regclass and not tgisinternal) <> 3 then
    raise exception 'STOP: Archive protection trigger missing or duplicated.';
  end if;
  for v_item in select value from jsonb_array_elements(v_expected->'catalog'->'triggers') loop
    if v_item->>2=any(array['organization_settings_update','organization_settings_no_delete','organization_settings_no_truncate']) then
      v_expected_type := case v_item->>2 when 'organization_settings_update' then 19 when 'organization_settings_no_delete' then 11 else 34 end;
      v_original_definition := format('CREATE TRIGGER %I BEFORE %s ON organization_settings FOR EACH %s EXECUTE FUNCTION _protect_organization_settings()',
        v_item->>2,case v_expected_type when 19 then 'UPDATE' when 11 then 'DELETE' else 'TRUNCATE' end,
        case v_expected_type when 34 then 'STATEMENT' else 'ROW' end);
      select * into v_trigger from pg_trigger where oid=(v_item->>0)::oid;
      if not found or v_item->>4 is distinct from v_original_definition
        or v_trigger.tgrelid is distinct from (v_item->>1)::oid
        or v_trigger.tgrelid is distinct from 'public._legacy_organization_settings'::regclass
        or v_trigger.tgname::text is distinct from v_item->>2 or v_trigger.tgenabled::text is distinct from v_item->>3
        or v_trigger.tgtype is distinct from v_expected_type or v_trigger.tgisinternal
        or v_trigger.tgfoid is distinct from to_regprocedure('public._protect_organization_settings()')::oid
        or not exists(select 1 from jsonb_array_elements(v_expected->'catalog'->'functions') f
          where (f->>0)::oid=v_trigger.tgfoid and position('CREATE OR REPLACE FUNCTION public._protect_organization_settings()' in f->>7)=1)
        or pg_get_triggerdef(v_trigger.oid,true) is distinct from
          replace(v_original_definition,' ON organization_settings ',' ON _legacy_organization_settings ') then
        raise exception 'STOP: Archive trigger identity/function/semantics changed: %',v_item->>2;
      end if;
    elsif not (v_catalog->'triggers' @> jsonb_build_array(v_item)) then
      raise exception 'STOP: Original user trigger definition/mode changed: %',v_item->>2;
    end if;
  end loop;
  -- ORIGINAL TRIGGER CHECK END
  if exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth') and not t.tgisinternal
    and not exists(select 1 from jsonb_array_elements(v_expected->'catalog'->'triggers') x where (x->>0)::oid=t.oid)
    and not (t.tgname='workspace_row_guard' and c.relname=any(array['projects','change_requests',
      'change_request_events','project_imports','project_import_rows'])
      and t.tgfoid=to_regprocedure('public._guard_workspace_row()') and t.tgenabled='O')
    and not (t.tgname='organization_updated' and t.tgrelid='public.organizations'::regclass
      and t.tgfoid=to_regprocedure('public._touch_organization()') and t.tgenabled='O')) then
    raise exception 'STOP: Unexpected user trigger.';
  end if;
  perform set_config('steerfold.workspace_rollout_evidence',v_expected::text,true);
  raise notice 'PASS: Original row fields, money, historical currency/hash/results, profiles, triggers and ALL public sequences preserved; business sequence=12/called.';
end;
$preservation$;

do $workspace_catalog_checks$
declare
  v_table text; v_rpc record; v_oid oid; v_fk record; v_count bigint;
  v_reviewed_oids oid[] := '{}';
  v_expected jsonb := current_setting('steerfold.workspace_rollout_evidence')::jsonb;
  v_before jsonb; v_contract jsonb; v_properties record; v_name text;
  v_context jsonb; v_after jsonb; v_workspaces jsonb;
  v_demo constant uuid := '00000000-0000-4000-8000-000000000001';
begin
  foreach v_table in array array['organizations','organization_memberships','projects',
    'change_requests','change_request_events','project_imports','project_import_rows','governance_user_roles'] loop
    if to_regclass('public.' || v_table) is null or not exists (
      select 1 from pg_class where oid = to_regclass('public.' || v_table) and relrowsecurity
    ) then raise exception 'STOP: Missing table or disabled RLS: %', v_table; end if;
  end loop;
  if (select count(*) from public.organizations) <> 1
    or not exists (select 1 from public.organizations o join public._legacy_organization_settings s
      on o.organization_name = s.organization_name and o.industry = s.industry
      and o.organization_currency = s.organization_currency and o.updated_at = s.updated_at
      where o.id = v_demo and o.is_demo and o.organization_name = 'Brisk & Zip' and o.organization_currency = 'CAD')
    or exists (select 1 from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
      where a.attrelid = 'public.organizations'::regclass and a.attname = 'organization_currency') then
    raise exception 'STOP: Brisk & Zip is the preserved Demo, with explicit CAD and no currency default.';
  end if;
  foreach v_table in array array['projects','project_imports','project_import_rows',
    'change_requests','change_request_events','governance_user_roles'] loop
    execute format('select count(*) from public.%I where organization_id is distinct from $1', v_table) into v_count using v_demo;
    if v_count <> 0 then raise exception 'STOP: Incorrect ownership backfill: %', v_table; end if;
    if not exists (select 1 from pg_attribute where attrelid = to_regclass('public.' || v_table)
      and attname = 'organization_id' and atttypid = 'uuid'::regtype and attnotnull and not attisdropped)
      or to_regclass('public.' || v_table || '_organization_idx') is null then
      raise exception 'STOP: Missing ownership column/index: %', v_table;
    end if;
    if not exists(select 1 from pg_index i where i.indexrelid=to_regclass('public.'||v_table||'_organization_idx')
      and i.indrelid=to_regclass('public.'||v_table) and i.indisvalid and i.indisready and not i.indisunique
      and i.indpred is null and i.indexprs is null and i.indnkeyatts=1
      and i.indkey[0]=(select attnum from pg_attribute where attrelid=i.indrelid and attname='organization_id'))
      or not exists(select 1 from pg_constraint c where c.conrelid=to_regclass('public.'||v_table)
        and c.contype='f' and c.confrelid='public.organizations'::regclass and c.convalidated
        and c.conkey=array[(select attnum from pg_attribute where attrelid=c.conrelid and attname='organization_id')]::smallint[]) then
      raise exception 'STOP: Tenant index/FK differs: %',v_table;
    end if;
  end loop;
  foreach v_table in array array['projects','change_requests','change_request_events','project_imports','project_import_rows'] loop
    if not exists(select 1 from pg_trigger t where t.tgrelid=to_regclass('public.'||v_table)
        and t.tgname='workspace_row_guard' and t.tgenabled='O' and not t.tgisinternal and t.tgtype=31
        and t.tgfoid=to_regprocedure('public._guard_workspace_row()')) then
      raise exception 'STOP: Workspace write guard differs: %',v_table;
    end if;
  end loop;
  if not exists(select 1 from pg_trigger where tgrelid='public.organizations'::regclass
    and tgname='organization_updated' and tgenabled='O' and tgtype=19
    and tgfoid=to_regprocedure('public._touch_organization()')) then
    raise exception 'STOP: Organization immutable identity/update trigger missing.';
  end if;
  if (select count(*) from public.organization_memberships)
      <> (select count(distinct user_id) from public.governance_user_roles)
    or exists (select 1 from public.organization_memberships m where m.organization_id <> v_demo
      or m.membership_role <> 'member' or m.demo_write_eligible is distinct from
        exists (select 1 from public.governance_user_roles r where r.organization_id = m.organization_id
          and r.user_id = m.user_id and r.role = 'governance_admin'))
    or exists (select 1 from public.governance_user_roles r where not exists (
      select 1 from public.organization_memberships m where m.organization_id = r.organization_id and m.user_id = r.user_id)) then
    raise exception 'STOP: Migrated memberships/frozen Demo eligibility differ from existing assignments.';
  end if;
  -- Structural FK semantics, not just generated constraint names.
  for v_fk in select * from (values
    ('change_requests', 'project_id', 'projects', 'r'),
    ('change_request_events', 'change_request_id', 'change_requests', 'c'),
    ('project_import_rows', 'import_id', 'project_imports', 'r'),
    ('project_import_rows', 'project_uuid', 'projects', 'n')
  ) f(child_table, child_column, parent_table, delete_action) loop
    if not exists (select 1 from pg_constraint c
      where c.conrelid = to_regclass('public.' || v_fk.child_table) and c.contype = 'f'
        and c.confrelid = to_regclass('public.' || v_fk.parent_table) and c.convalidated and not c.condeferrable
        and c.confdeltype::text = v_fk.delete_action
        and (select array_agg(a.attname::text order by k.n) from unnest(c.conkey) with ordinality k(num,n)
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.num)
          = array['organization_id', v_fk.child_column]
        and (select array_agg(a.attname::text order by k.n) from unnest(c.confkey) with ordinality k(num,n)
          join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.num) = array['organization_id','id']
        and (v_fk.child_column <> 'project_uuid' or c.confdelsetcols =
          array[(select attnum from pg_attribute where attrelid = c.conrelid and attname = 'project_uuid')]::smallint[])
    ) then raise exception 'STOP: Missing/wrong composite FK: %.%', v_fk.child_table, v_fk.child_column; end if;
  end loop;
  if not exists (select 1 from pg_constraint c where c.conrelid = 'public.project_imports'::regclass
    and c.conname = 'project_imports_workspace_actor_key_unique' and c.contype = 'u' and c.convalidated
    and (select array_agg(a.attname::text order by k.n) from unnest(c.conkey) with ordinality k(num,n)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.num)
      = array['organization_id','imported_by','idempotency_key'])
    or not exists (select 1 from pg_index i where i.indexrelid = to_regclass('public.project_import_rows_source_unique')
      and i.indisunique and i.indisvalid and i.indisready and i.indnkeyatts = 3
      and (select array_agg(a.attname::text order by k.n) from unnest(i.indkey) with ordinality k(num,n)
        join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.num)
        = array['organization_id','source_namespace','source_project_id']
      and regexp_replace(lower(pg_get_expr(i.indpred,i.indrelid)), '[()[:space:]]', '', 'g')
        = 'source_namespaceisnotnullandsource_project_idisnotnull')
    or not exists (select 1 from pg_index where indexrelid = to_regclass('public.organizations_one_demo')
      and indrelid='public.organizations'::regclass and indisunique and indisvalid and indisready
      and indnkeyatts=1 and indexprs is null
      and indkey[0]=(select attnum from pg_attribute where attrelid=indrelid and attname='is_demo')
      and pg_get_expr(indpred,indrelid)='is_demo') then
    raise exception 'STOP: Workspace import/source/Demo uniqueness is missing.';
  end if;
  foreach v_table in array array['projects','change_requests','project_imports'] loop
    if not exists (select 1 from pg_constraint c where c.conrelid = to_regclass('public.' || v_table)
      and c.contype = 'u' and c.convalidated
      and (select array_agg(a.attname::text order by k.n) from unnest(c.conkey) with ordinality k(num,n)
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.num) = array['organization_id','id']) then
      raise exception 'STOP: Missing composite parent uniqueness: %', v_table;
    end if;
  end loop;
  if not exists (select 1 from pg_class where oid = 'public.organization_settings'::regclass and relkind = 'v'
    and reloptions @> array['security_invoker=true','security_barrier=true'])
    or has_table_privilege('authenticated','public.organization_settings','UPDATE')
    or has_table_privilege('anon','public._legacy_organization_settings','SELECT')
    or has_table_privilege('authenticated','public._legacy_organization_settings','SELECT') then
    raise exception 'STOP: Organization compatibility view/archive privileges differ.';
  end if;
  -- Every expected function signature, definer model, search_path and effective ACL.
  for v_rpc in select * from (values
    ('public.active_organization_id()', true, true, true),
    ('public._workspace_can_write(uuid)', true, true, true),
    ('public._require_workspace_write()', true, false, false),
    ('public.list_my_workspaces()', true, true, true),
    ('public.create_workspace(text,text,text)', true, false, true),
    ('public._guard_workspace_row()', true, false, false),
    ('public._touch_organization()', false, false, false),
    ('public.current_user_has_governance_role(text)', true, false, true),
    ('public.get_my_governance_roles()', true, false, true),
    ('public.list_governance_role_assignments()', true, false, true),
    ('public.assign_governance_role(uuid,text)', true, false, true),
    ('public.revoke_governance_role(uuid,text)', true, false, true),
    ('public.list_governance_users()', true, false, true),
    ('public.create_change_request(text,numeric,text,text,text,text,text,text,text,text,text)', true, false, true),
    ('public.update_draft_change_request(uuid,numeric,text,text,text,text,text,text,text,text,text)', true, false, true),
    ('public.transition_change_request_status(uuid,text,text)', true, false, true),
    ('public.delete_draft_change_request(uuid)', true, false, true),
    ('public.apply_approved_change_request(uuid,text)', true, false, true),
    ('public._analyze_project_import(jsonb)', true, false, false),
    ('public.check_project_import(jsonb)', true, false, true),
    ('public.commit_project_import(uuid,jsonb,jsonb)', true, false, true),
    ('public.get_project_import_result(uuid)', false, false, true),
    ('public.set_organization_currency(text,text,boolean)', true, false, true),
    ('public.save_organization_profile(text,text,timestamptz)', true, false, true)
  ) f(signature, definer, anon_execute, authenticated_execute) loop
    v_oid := to_regprocedure(v_rpc.signature);
    v_reviewed_oids := array_append(v_reviewed_oids, v_oid);
    if v_oid is null or not exists (select 1 from pg_proc p where p.oid = v_oid
      and p.prosecdef = v_rpc.definer and 'search_path=""' = any(p.proconfig))
      or has_function_privilege('anon',v_oid,'EXECUTE') is distinct from v_rpc.anon_execute
      or has_function_privilege('authenticated',v_oid,'EXECUTE') is distinct from v_rpc.authenticated_execute
      or exists (select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        where p.oid = v_oid and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
      raise exception 'STOP: Function security/signature/ACL differs: %', v_rpc.signature;
    end if;
  end loop;
  -- Anything outside the reviewed replacement set must be unchanged, including
  -- the business-ID generator, personal profile RPCs and RLS event infrastructure.
  if exists (select 1 from jsonb_array_elements(v_expected->'catalog'->'functions') b left join pg_proc p on p.oid=(b->>0)::oid
    where not ((b->>0)::oid=any(v_reviewed_oids)) and (p.oid is null
      or pg_get_functiondef(p.oid) is distinct from b->>7
      or coalesce(to_jsonb(p.proacl),'null'::jsonb) is distinct from b->2 or to_jsonb(p.proowner) is distinct from b->1))
    or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','auth') and p.prokind in ('f','p')
      and not exists(select 1 from jsonb_array_elements(v_expected->'catalog'->'functions') b where (b->>0)::oid=p.oid)
      and not (p.oid=any(v_reviewed_oids))) then
    raise exception 'STOP: Unknown function or unchanged generator/profile/function/ACL drift.';
  end if;
  for v_properties in select * from (values
    ('active_organization_id','cf8347e5ab8dabdd3c1f2047dd802db9eca900c03e3cb8c2135d1d5ff9b9f508','plpgsql','s',false),
    ('_workspace_can_write','1e6585b1a58e7c72f5758fcd2b51aad1d3adbe2c5d78b0865ec571fc6d2a20ea','sql','s',false),
    ('_require_workspace_write','178a1d3c056151d449bcf569cd072d39b8a46eee34e9cbfcf4da16685b6c2de1','plpgsql','s',false),
    ('current_user_has_governance_role','b7c3cac071bfbd8ace90afbb5f065b1c622d9ad3913af08f6edc30f310f8b9cd','sql','s',false),
    ('list_my_workspaces','fc3aa894d562f98d08485bfacc06866fc8333f8d6b26ec5fb04e8e77022ca853','sql','s',false),
    ('create_workspace','53a73a68a6e83813c3d485249c035e1d5f3f38ca85a5e4470717f709c22e6c7d','plpgsql','v',false),
    ('_guard_workspace_row','83eca9c45898c3baec175b236f745ca969b192c75e7dff29cbea2386bac043fe','plpgsql','v',false),
    ('_touch_organization','9344794df9cdfdeee86885014a9e34cb5f5ef559b620b7d11a6b6231ce6dd7d7','plpgsql','v',false),
    ('set_organization_currency','6c743d2a6b8c79c3a67f40b772ff439d65065d1c843cc7aae1e45e9c22fa7676','plpgsql','v',true),
    ('save_organization_profile','b913d41208546c343bc44d6ab1294a2e6c4a881460f66ed04b86e10b938f9049','plpgsql','v',true),
    ('create_change_request','733ea54abcfd9465d450b6808c312fca770387a3b9e76e1d7182192010bf608a','plpgsql','v',false),
    ('update_draft_change_request','1d13ff33fbcc228b6b83ab07cb29493d1546f3a82fac55daaf3db88c63c8103b','plpgsql','v',false),
    ('delete_draft_change_request','181d07e5b37f9600ab0e9de82f50bd47f4cc17ea77944b1706f7ab44625723eb','plpgsql','v',false),
    ('transition_change_request_status','952736f29d8e4b3f75973ae428a6cc1c641c4165ae9d86f932fcfa70a4c42fcd','plpgsql','v',false),
    ('apply_approved_change_request','41e89f4bc82ff0c8f79072eb135cd222fb0ce4cb49bc16d6392399e6889df374','plpgsql','v',false),
    ('get_my_governance_roles','b5db512ac16eb2fa528a8c4179c9f0ec06f2a411cd47ad10c83bb5fb9c8752aa','plpgsql','s',false),
    ('list_governance_role_assignments','0e61929aafa9e8e923758070a9146be798b68f717e81942dba1bb113fe4ebcd7','plpgsql','s',false),
    ('assign_governance_role','afe38281fe3344dd71d05ae92670108b3af6195798ea783198c377dc4d26afd0','plpgsql','v',false),
    ('revoke_governance_role','28e79aff1b70a9e405d6e8b185510b9e936fb8bfdf76267ecdb8e4ff863ba077','plpgsql','v',false),
    ('list_governance_users','3b1f4dca1a1a6402c8f0655c4fe3ef034e2810231d8bb0b075363639f5085042','plpgsql','s',false),
    ('_analyze_project_import','fee36238ad337d41970151f4f1c12714371ea4b7a7ead9a76c12cba6e2f7a267','plpgsql','s',false),
    ('check_project_import','15e5d9c197ae50080fa5e3c81ad2bea5b4dfffadd12fc279e3fcd62959e32018','plpgsql','s',false),
    ('commit_project_import','2f3dd80e3fdf854d5ddf6c1cdbfd5f17cdf123fad83fc32a38de240b9ce62f37','plpgsql','v',true),
    ('get_project_import_result','3a14cbad5ffad4fcb95f2edb2c66097010e7bcdf53b33f4aec170554af90538c','plpgsql','s',false)
  ) pins(name,body_sha256,language,volatility,has_lock_timeout) loop
    select p.* into strict v_rpc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=v_properties.name and p.oid=any(v_reviewed_oids);
    if encode(sha256(convert_to(replace(v_rpc.prosrc,E'\r\n',E'\n'),'UTF8')),'hex') <> v_properties.body_sha256
      or v_rpc.provolatile::text <> v_properties.volatility or v_rpc.proisstrict
      or (select lanname from pg_language where oid=v_rpc.prolang) <> v_properties.language
      or (select array_agg(x order by x) from unnest(v_rpc.proconfig) x) is distinct from
        (case when v_properties.has_lock_timeout then array['lock_timeout=5s','search_path=""']
          else array['search_path=""'] end) then
      raise exception 'STOP: Exact reviewed function body/properties differ: %',v_properties.name;
    end if;
    v_contract := v_expected->'function_contracts'->v_rpc.oid::text;
    if exists(select 1 from jsonb_array_elements(v_expected->'catalog'->'functions') x
      where (x->>0)::oid=v_rpc.oid) and v_contract is null then
      raise exception 'STOP: Missing original RPC contract evidence: %',v_properties.name;
    end if;
    if pg_get_userbyid(v_rpc.proowner)<>'postgres' then raise exception 'STOP: Unexpected RPC owner.'; end if;
    if v_rpc.prokind<>'f' or v_rpc.proleakproof then raise exception 'STOP: Unexpected RPC kind/leakproof setting.'; end if;
    if v_properties.name=any(array['active_organization_id','_workspace_can_write','_require_workspace_write',
      'list_my_workspaces','create_workspace','_guard_workspace_row','_touch_organization'])
      and (v_rpc.proretset or v_rpc.prorettype <>
        (case when v_properties.name=any(array['active_organization_id','_require_workspace_write']) then 'uuid'::regtype
          when v_properties.name='_workspace_can_write' then 'boolean'::regtype
          when v_properties.name=any(array['list_my_workspaces','create_workspace']) then 'jsonb'::regtype
          else 'trigger'::regtype end)) then
      raise exception 'STOP: New workspace RPC result contract differs: %',v_properties.name;
    end if;
    if v_contract is not null and (v_contract->>'arguments' is distinct from pg_get_function_arguments(v_rpc.oid)
      or v_contract->>'result' is distinct from pg_get_function_result(v_rpc.oid)) then
      raise exception 'STOP: Existing RPC argument/default/return contract changed: %',v_properties.name;
    end if;
  end loop;
  if not exists (select 1 from pg_event_trigger where evtname = 'ensure_rls' and evtenabled = 'O') then
    raise exception 'STOP: Expected enabled RLS event trigger missing.';
  end if;
  -- RLS infrastructure is inspected, never invoked directly.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'organization_memberships'
      and policyname = 'own_membership_read' and qual like '%auth.uid()%')
    or exists (select 1 from pg_policies where schemaname = 'public'
      and tablename = any(array['projects','organizations','organization_memberships','project_imports',
        'project_import_rows','change_requests','change_request_events'])
      and coalesce(qual,'') || coalesce(with_check,'') not like '%active_organization_id()%') then
    raise exception 'STOP: Expected tenant/own-membership policy structure missing.';
  end if;
  -- Scoped subtransaction restores ALL session-local role/JWT/header changes.
  v_context := jsonb_build_array(current_user,current_setting('role'),coalesce(current_setting('request.headers',true),''),
    coalesce(current_setting('request.jwt.claim.sub',true),''),coalesce(current_setting('request.jwt.claim.role',true),''),coalesce(current_setting('request.jwt.claims',true),''));
  begin
    perform set_config('request.headers',jsonb_build_object('x-steerfold-organization-id',v_demo)::text,true);
    perform set_config('request.jwt.claim.sub','ed1005a0-76e4-4614-8a66-589c055ecff5',true);
    perform set_config('request.jwt.claim.role','authenticated',true);
    perform set_config('request.jwt.claims','{"sub":"ed1005a0-76e4-4614-8a66-589c055ecff5","role":"authenticated"}',true);
    perform set_config('role','authenticated',true);
    if public.current_user_has_governance_role('governance_admin') is distinct from true
      or (select count(*) from public.projects) <> 11
      or (select count(*) from public.change_requests) <> 2
      or (select count(*) from public.change_request_events) <> 11
      or (select count(*) from public.organization_settings where organization_currency='CAD' and organization_name='Brisk & Zip') <> 1
      or exists(select 1 from public.user_profiles where user_id <> auth.uid()) then
      raise exception 'STOP: Existing admin, tenant read or own-profile visibility failed.';
    end if;
    v_workspaces := public.list_my_workspaces();
    if jsonb_array_length(v_workspaces) <> 1 or v_workspaces->0->>'id' <> v_demo::text
      or v_workspaces->0->>'organization_name' <> 'Brisk & Zip'
      or v_workspaces->0->>'is_demo' <> 'true' or v_workspaces->0->>'can_write' <> 'true' then
      raise exception 'STOP: Existing admin discovery differs.';
    end if;
    raise exception using errcode='PZ002',message='successful read-only probe; restore context';
  exception when sqlstate 'PZ002' then null;
  end;
  v_after := jsonb_build_array(current_user,current_setting('role'),coalesce(current_setting('request.headers',true),''),
    coalesce(current_setting('request.jwt.claim.sub',true),''),coalesce(current_setting('request.jwt.claim.role',true),''),coalesce(current_setting('request.jwt.claims',true),''));
  if v_after is distinct from v_context then raise exception 'STOP: Read probe leaked auth context.'; end if;
  raise notice 'PASS: Workspace schema, backfill, membership, FK/index, RPC/ACL, profile and RLS infrastructure checks.';
end;
$workspace_catalog_checks$;
-- Same exact reviewed RLS infrastructure check as the migration; catalog only.
do $$
declare
  v_unknown text;
  v_rls_oid oid := to_regprocedure('public.rls_auto_enable()');
  -- Exact owner-reviewed definition, stored as text only; never executed.
  -- Canonicalization changes CRLF to LF and removes final CR/LF only.
  -- Internal whitespace, literals, statements and dollar-quote tags remain exact.
  v_rls_reviewed_definition constant text := $reviewed_rls$CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
$reviewed_rls$;
  v_rls_reviewed_sha256 constant text := encode(sha256(convert_to(
    rtrim(replace(v_rls_reviewed_definition, E'\r\n', E'\n'), E'\r\n'), 'UTF8')), 'hex');
  v_rls_problem text;
begin
  -- This is one reviewed infrastructure exception, never an event_trigger exemption.
  if v_rls_oid is null then
    v_rls_problem := 'Reviewed public.rls_auto_enable() is missing.';
  elsif not exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid = p.proowner
    join pg_catalog.pg_language l on l.oid = p.prolang
    where p.oid = v_rls_oid and p.prokind = 'f' and p.pronargs = 0
      and p.prorettype = 'event_trigger'::regtype and p.prosecdef
      and p.provolatile = 'v' and l.lanname = 'plpgsql' and r.rolname = 'postgres'
      and p.proconfig = array['search_path=pg_catalog']::text[]
  ) then
    v_rls_problem := 'Reviewed RLS event-trigger function security/owner/language/search_path differs.';
  elsif (select count(*) from pg_catalog.pg_event_trigger where evtfoid = v_rls_oid) <> 1
    or not exists (
      select 1 from pg_catalog.pg_event_trigger e join pg_catalog.pg_roles r on r.oid = e.evtowner
      where e.evtname = 'ensure_rls' and e.evtfoid = v_rls_oid
        and e.evtevent = 'ddl_command_end' and e.evtenabled = 'O' and r.rolname = 'postgres'
        and (select array_agg(tag order by tag) from unnest(e.evttags) tags(tag))
          = array['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO']::text[]
    ) then
    v_rls_problem := 'Reviewed ensure_rls binding/event/mode/owner/exact tags differ.';
  elsif v_rls_reviewed_sha256 is null or v_rls_reviewed_sha256 !~ '^[0-9a-f]{64}$' then
    v_rls_problem := 'Exact owner-reviewed rls_auto_enable definition SHA-256 is required; behavior summary alone cannot certify restricted public-table RLS-only behavior.';
  elsif encode(sha256(convert_to(
    rtrim(replace(pg_catalog.pg_get_functiondef(v_rls_oid), E'\r\n', E'\n'), E'\r\n'), 'UTF8')), 'hex')
    is distinct from v_rls_reviewed_sha256 then
    v_rls_problem := 'Reviewed rls_auto_enable definition fingerprint differs; re-review required.';
  end if;
  -- Detect new public-function event triggers too, including SECURITY INVOKER ones.
  if exists (
    select 1 from pg_catalog.pg_event_trigger e join pg_catalog.pg_proc p on p.oid = e.evtfoid
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (e.evtname <> 'ensure_rls' or e.evtfoid is distinct from v_rls_oid)
      and not exists (select 1 from pg_catalog.pg_depend d
        where d.classid = 'pg_event_trigger'::regclass and d.objid = e.oid and d.deptype = 'e')
  ) then
    v_rls_problem := coalesce(v_rls_problem || ' ', '') || 'Unknown public event-trigger binding requires review.';
  end if;
  if v_rls_problem is not null then
    raise exception '%', v_rls_problem using errcode = '42501';
  end if;
end;
$$;

do $policies_and_grants$
declare
  v_policy record; v_role text; v_table text; v_priv text; v_fk record;
  v_constraints constant jsonb := $constraint_pins$[{"table_name":"organization_memberships","conname":"organization_memberships_membership_role_check","contype":"c","definition":"CHECK(membership_role=ANY(ARRAY['owner'::text,'member'::text]))"},{"table_name":"organization_memberships","conname":"organization_memberships_organization_id_fkey","contype":"f","definition":"FOREIGNKEY(organization_id)REFERENCESorganizations(id)ONDELETERESTRICT"},{"table_name":"organization_memberships","conname":"organization_memberships_pkey","contype":"p","definition":"PRIMARYKEY(organization_id,user_id)"},{"table_name":"organization_memberships","conname":"organization_memberships_user_id_fkey","contype":"f","definition":"FOREIGNKEY(user_id)REFERENCESauth.users(id)ONDELETECASCADE"},{"table_name":"organizations","conname":"organizations_demo_currency_cad","contype":"c","definition":"CHECK(NOTis_demoORorganization_currency='CAD'::text)"},{"table_name":"organizations","conname":"organizations_industry_check","contype":"c","definition":"CHECK(industry=btrim(industry)ANDchar_length(industry)<=120)"},{"table_name":"organizations","conname":"organizations_organization_currency_check","contype":"c","definition":"CHECK(organization_currency=ANY(ARRAY['CAD'::text,'USD'::text,'GBP'::text,'EUR'::text]))"},{"table_name":"organizations","conname":"organizations_organization_name_check","contype":"c","definition":"CHECK(organization_name=btrim(organization_name)ANDchar_length(organization_name)>=1ANDchar_length(organization_name)<=120)"},{"table_name":"organizations","conname":"organizations_pkey","contype":"p","definition":"PRIMARYKEY(id)"}]$constraint_pins$::jsonb;
begin
  if (select jsonb_agg(jsonb_build_object('table_name',c.conrelid::regclass::text,
      'conname',c.conname,'contype',c.contype,
      'definition',regexp_replace(pg_get_constraintdef(c.oid,true),'[[:space:]]','','g'))
      order by c.conrelid::regclass::text,c.conname)
    from pg_constraint c where c.conrelid in ('public.organizations'::regclass,'public.organization_memberships'::regclass)
      and c.contype <> 'n') is distinct from v_constraints then
    raise exception 'STOP: Exact workspace CHECK/PK/FK constraints differ.';
  end if;
  if exists(select 1 from pg_attribute where attrelid in ('public.organizations'::regclass,
    'public.organization_memberships'::regclass) and attnum>0 and not attisdropped and not attnotnull) then
    raise exception 'STOP: Workspace required column became nullable.';
  end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename=any(array[
    'projects','organizations','organization_memberships','project_imports','project_import_rows',
    'change_requests','change_request_events','governance_user_roles','_legacy_organization_settings'])) <> 10 then
    raise exception 'STOP: Missing or extra tenant/history/archive/role policy.';
  end if;
  for v_policy in select * from (values
    ('projects','workspace_read','SELECT',array['anon','authenticated'],'(organization_id=(SELECTactive_organization_id()ASactive_organization_id))',''),
    ('projects','workspace_insert','INSERT',array['authenticated'],'','((organization_id=(SELECTactive_organization_id()ASactive_organization_id))AND_workspace_can_write(organization_id))'),
    ('projects','workspace_update','UPDATE',array['authenticated'],'((organization_id=(SELECTactive_organization_id()ASactive_organization_id))AND_workspace_can_write(organization_id))','((organization_id=(SELECTactive_organization_id()ASactive_organization_id))AND_workspace_can_write(organization_id))'),
    ('projects','workspace_delete','DELETE',array['authenticated'],'((organization_id=(SELECTactive_organization_id()ASactive_organization_id))AND_workspace_can_write(organization_id))',''),
    ('change_requests','workspace_read','SELECT',array['authenticated'],'((organization_id=(SELECTactive_organization_id()ASactive_organization_id))AND(EXISTS(SELECT1FROMorganization_membershipsmWHERE((m.organization_id=change_requests.organization_id)AND(m.user_id=(SELECTauth.uid()ASuid))))))',''),
    ('change_request_events','workspace_read','SELECT',array['authenticated'],'((organization_id=(SELECTactive_organization_id()ASactive_organization_id))AND(EXISTS(SELECT1FROMorganization_membershipsmWHERE((m.organization_id=change_request_events.organization_id)AND(m.user_id=(SELECTauth.uid()ASuid))))))',''),
    ('project_imports','own_workspace_imports','SELECT',array['authenticated'],'((organization_id=(SELECTactive_organization_id()ASactive_organization_id))AND(imported_by=(SELECTauth.uid()ASuid))AND(EXISTS(SELECT1FROMorganization_membershipsmWHERE((m.organization_id=project_imports.organization_id)AND(m.user_id=(SELECTauth.uid()ASuid))))))',''),
    ('project_import_rows','own_workspace_import_rows','SELECT',array['authenticated'],'((organization_id=(SELECTactive_organization_id()ASactive_organization_id))AND(EXISTS(SELECT1FROMorganization_membershipsmWHERE((m.organization_id=project_import_rows.organization_id)AND(m.user_id=(SELECTauth.uid()ASuid)))))AND(EXISTS(SELECT1FROMproject_importsbatchWHERE((batch.id=project_import_rows.import_id)AND(batch.organization_id=project_import_rows.organization_id)AND(batch.imported_by=(SELECTauth.uid()ASuid))))))',''),
    ('organizations','workspace_read','SELECT',array['anon','authenticated'],'(id=(SELECTactive_organization_id()ASactive_organization_id))',''),
    ('organization_memberships','own_membership_read','SELECT',array['authenticated'],'((organization_id=(SELECTactive_organization_id()ASactive_organization_id))AND(user_id=(SELECTauth.uid()ASuid)))','')
  ) expected(table_name,policy_name,command,roles,qual,with_check) loop
    if not exists(select 1 from pg_policies p where p.schemaname='public' and p.tablename=v_policy.table_name
      and p.policyname=v_policy.policy_name and p.permissive='PERMISSIVE' and p.cmd=v_policy.command
      and p.roles::text[]=v_policy.roles
      and regexp_replace(coalesce(p.qual,''),'[[:space:]]','','g')=v_policy.qual
      and regexp_replace(coalesce(p.with_check,''),'[[:space:]]','','g')=v_policy.with_check) then
      raise exception 'STOP: Exact reviewed policy differs: %.%',v_policy.table_name,v_policy.policy_name;
    end if;
  end loop;
  if regexp_replace(pg_get_viewdef('public.organization_settings'::regclass,true),'[[:space:]]','','g')
    <> 'SELECTtrueASid,organization_currency,updated_at,organization_name,industry,idASorganization_idFROMorganizationsoWHEREid=active_organization_id();' then
    raise exception 'STOP: Organization compatibility view definition differs.';
  end if;
  foreach v_role in array array['anon','authenticated'] loop
    foreach v_table in array array['projects','organizations','organization_memberships',
      'project_imports','project_import_rows','change_requests','change_request_events',
      'governance_user_roles','_legacy_organization_settings','organization_settings','user_profiles'] loop
      foreach v_priv in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
        if has_table_privilege(v_role,'public.'||v_table,v_priv) is distinct from
          (case when v_table='projects' then v_priv='SELECT' or (v_role='authenticated' and v_priv=any(array['INSERT','UPDATE','DELETE']))
            when v_table=any(array['organizations','organization_settings']) then v_priv='SELECT'
            when v_table=any(array['organization_memberships','project_imports','project_import_rows',
              'change_requests','change_request_events','user_profiles']) then v_role='authenticated' and v_priv='SELECT'
            else false end) then
          raise exception 'STOP: Effective table grant differs: % %.%',v_role,v_table,v_priv;
        end if;
        if v_priv=any(array['SELECT','INSERT','UPDATE','REFERENCES']) and not has_table_privilege(v_role,'public.'||v_table,v_priv)
          and has_any_column_privilege(v_role,'public.'||v_table,v_priv) then
          raise exception 'STOP: Column grant bypass: % %.%',v_role,v_table,v_priv;
        end if;
      end loop;
    end loop;
  end loop;
  if exists(select 1 from pg_policies where schemaname='public' and tablename='user_profiles'
    and ('anon'=any(roles) or 'public'=any(roles))) then
    raise exception 'STOP: Anonymous/PUBLIC personal profile policy.';
  end if;
  if not exists(select 1 from pg_index i where i.indrelid='public.projects'::regclass
    and i.indisunique and i.indisvalid and i.indisready and i.indpred is null and i.indexprs is null
    and i.indnkeyatts=1 and i.indkey[0]=(select attnum from pg_attribute
      where attrelid=i.indrelid and attname='project_id')) then
    raise exception 'STOP: Global business-code uniqueness missing.';
  end if;
  if not exists(select 1 from pg_constraint c where c.conrelid='public.governance_user_roles'::regclass
    and c.contype='f' and c.confrelid='public.organization_memberships'::regclass and c.convalidated
    and c.confdeltype='c'
    and (select array_agg(a.attname::text order by k.n) from unnest(c.conkey) with ordinality k(num,n)
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.num)=array['organization_id','user_id']) then
    raise exception 'STOP: Scoped role membership FK missing.';
  end if;
  foreach v_table in array array['organizations','organization_memberships'] loop
    if exists(select 1 from pg_constraint where conrelid=to_regclass('public.'||v_table) and not convalidated)
      or not exists(select 1 from pg_constraint where conrelid=to_regclass('public.'||v_table) and contype='p') then
      raise exception 'STOP: New workspace table constraints invalid: %',v_table;
    end if;
  end loop;
  raise notice 'PASS: Exact policies, compatibility view, table/column grants, personal-profile privacy and global IDs.';
end;
$policies_and_grants$;

-- Read-only expected-denial probes; scoped exceptions restore context, and only
-- the EXACT expected SQLSTATE after query entry is accepted. No temporary helper.
do $negative_reads$
declare
  v_case record; v_before jsonb; v_after jsonb; v_started boolean; v_finished boolean; v_code text;
  v_demo constant uuid := '00000000-0000-4000-8000-000000000001';
  v_nonmember constant uuid := 'f1600000-0000-4000-8000-000000000099';
  v_list jsonb;
begin
  if exists(select 1 from auth.users where id=v_nonmember) then
    raise exception 'STOP: Negative-probe synthetic identity is occupied.';
  end if;
  for v_case in select * from (values
    ('missing header','authenticated','{}','42501'),
    ('malformed header','authenticated','{"x-steerfold-organization-id":"not-a-uuid"}','22023'),
    ('inaccessible organization','authenticated','{"x-steerfold-organization-id":"f1600000-0000-4000-8000-000000000098"}','42501')
  ) cases(label,role_name,headers,expected_code) loop
    v_before := jsonb_build_array(current_user,current_setting('role'),coalesce(current_setting('request.headers',true),''),
      coalesce(current_setting('request.jwt.claim.sub',true),''),coalesce(current_setting('request.jwt.claim.role',true),''),coalesce(current_setting('request.jwt.claims',true),''));
    v_started:=false; v_finished:=false; v_code:=null;
    begin
      perform set_config('request.jwt.claim.sub',v_nonmember::text,true);
      perform set_config('request.jwt.claim.role',v_case.role_name,true);
      perform set_config('request.jwt.claims',jsonb_build_object('sub',v_nonmember,'role',v_case.role_name)::text,true);
      perform set_config('request.headers',v_case.headers,true);
      perform set_config('role',v_case.role_name,true);
      v_started:=true;
      perform public.active_organization_id();
      v_finished:=true;
      raise exception using errcode='PZ002',message='restore probe context';
    exception when others then v_code:=sqlstate;
    end;
    v_after := jsonb_build_array(current_user,current_setting('role'),coalesce(current_setting('request.headers',true),''),
      coalesce(current_setting('request.jwt.claim.sub',true),''),coalesce(current_setting('request.jwt.claim.role',true),''),coalesce(current_setting('request.jwt.claims',true),''));
    if not v_started or v_finished or v_code is distinct from v_case.expected_code or v_before is distinct from v_after then
      raise exception 'STOP: Negative probe/context failure: %, observed %',v_case.label,v_code;
    end if;
    raise notice 'PASS: % denied with %, context restored.',v_case.label,v_code;
  end loop;
  foreach v_code in array array['anon','authenticated'] loop
    v_before := jsonb_build_array(current_user,current_setting('role'),coalesce(current_setting('request.headers',true),''),
      coalesce(current_setting('request.jwt.claim.sub',true),''),coalesce(current_setting('request.jwt.claim.role',true),''),coalesce(current_setting('request.jwt.claims',true),''));
    begin
      perform set_config('request.jwt.claim.sub',case when v_code='authenticated' then v_nonmember::text else '' end,true);
      perform set_config('request.jwt.claim.role',v_code,true);
      perform set_config('request.jwt.claims',case when v_code='authenticated'
        then jsonb_build_object('sub',v_nonmember,'role',v_code)::text else '{"role":"anon"}' end,true);
      perform set_config('request.headers',jsonb_build_object('x-steerfold-organization-id',v_demo)::text,true);
      perform set_config('role',v_code,true);
      v_list:=public.list_my_workspaces();
      if jsonb_array_length(v_list)<>1 or v_list->0->>'id'<>v_demo::text
        or v_list->0->>'can_write'<>'false' or (select count(*) from public.projects)<>11 then
        raise exception 'STOP: Public Demo discovery/read semantics differ.';
      end if;
      if v_code='authenticated' and ((select count(*) from public.change_requests)<>0
        or (select count(*) from public.change_request_events)<>0
        or (select count(*) from public.project_imports)<>0
        or (select count(*) from public.project_import_rows)<>0
        or (select count(*) from public.user_profiles)<>0) then
        raise exception 'STOP: Nonmember private data leaked.';
      end if;
      raise exception using errcode='PZ002',message='successful read-only probe; restore context';
    exception when sqlstate 'PZ002' then null;
    end;
    v_after := jsonb_build_array(current_user,current_setting('role'),coalesce(current_setting('request.headers',true),''),
      coalesce(current_setting('request.jwt.claim.sub',true),''),coalesce(current_setting('request.jwt.claim.role',true),''),coalesce(current_setting('request.jwt.claims',true),''));
    if v_before is distinct from v_after then raise exception 'STOP: Demo read leaked auth context.'; end if;
  end loop;
end;
$negative_reads$;

select 'PASS_POST_ROLLOUT' as result,
  'Baseline/history/profile/sequence preserved; reviewed workspace schema, security and read probes passed. Browser/API gates still required.' as scope;
rollback;
