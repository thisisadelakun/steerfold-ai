-- OWNER-RUN READ-ONLY INVENTORY. Run this ENTIRE file in the intended SQL Editor.
-- No migration body, DDL, DML, temporary object, generator invocation or sequence
-- advancement is included. Sequence relations are SELECTed, never executed.
-- The three owner reviews are complete (generator, trigger paths, external hooks).
-- The exact owner-supplied RLS infrastructure definition is pinned below.
-- Attestations cannot override baseline/allowlist/constraint/security failures.
-- STOP is an exception, not permission to apply. On error, issue ROLLBACK;
-- before using that session again. Even PASS is not rollout authorization.
begin transaction isolation level repeatable read read only;
set local time zone 'UTC';
set local statement_timeout = '30s';
set local lock_timeout = '5s';

select 'ENVIRONMENT' as section, current_database() as database_name,
  current_user as database_role, current_setting('server_version') as server_version,
  current_setting('transaction_read_only') as transaction_read_only,
  current_setting('transaction_isolation') as transaction_isolation;

-- Guard inventory queries against absent prerequisites or an already-migrated DB.
do $$
declare relation_name text; missing text[] := '{}';
begin
  foreach relation_name in array array['public.projects', 'public.organization_settings',
    'public.user_profiles', 'public.project_imports', 'public.project_import_rows',
    'public.change_requests', 'public.change_request_events', 'public.governance_user_roles', 'auth.users'] loop
    if to_regclass(relation_name) is null then missing := array_append(missing, relation_name); end if;
  end loop;
  if cardinality(missing) > 0 then
    raise exception 'STOP: Required deployed relations missing: %', array_to_string(missing, ', ');
  end if;
  if to_regclass('public.organizations') is not null or to_regclass('public.organization_memberships') is not null
    or to_regclass('public._legacy_organization_settings') is not null
    or exists (select 1 from pg_catalog.pg_attribute where attrelid = 'public.projects'::regclass
      and attname = 'organization_id' and not attisdropped) then
    raise exception 'STOP: Workspace objects/ownership already exist. Do not replay the migration.';
  end if;
  if not exists (select 1 from pg_catalog.pg_class where oid = 'public.organization_settings'::regclass and relkind = 'r') then
    raise exception 'STOP: Expected the original organization_settings table, not a replacement view.';
  end if;
end;
$$;

select 'BASELINE' as section, count(*) as project_count,
  encode(sha256(convert_to(coalesce(string_agg(to_jsonb(p)::text, '' order by p.project_id), ''), 'UTF8')), 'hex') as projects_fingerprint,
  (select count(*) from public.project_imports) as project_imports,
  (select count(*) from public.project_import_rows) as project_import_rows,
  (select count(*) from public.change_requests) as change_requests,
  (select count(*) from public.change_request_events) as change_request_events
from public.projects p;
select 'ORGANIZATION' as section, id, organization_name, industry, organization_currency, updated_at
from public.organization_settings;
select 'HISTORICAL_IMPORT_CURRENCY' as section, id as import_id, currency_code,
  result->>'currency_code' as stored_result_currency from public.project_imports order by id;

-- Full live project schema, including inherited defaults/identity/generated columns.
select 'PROJECT_COLUMNS' as section, a.attnum, a.attname,
  format_type(a.atttypid, a.atttypmod) as column_type, a.attnotnull,
  a.attidentity, a.attgenerated, pg_get_expr(d.adbin, d.adrelid) as default_expression,
  col_description(a.attrelid, a.attnum) as comment
from pg_catalog.pg_attribute a left join pg_catalog.pg_attrdef d
  on d.adrelid = a.attrelid and d.adnum = a.attnum
where a.attrelid = 'public.projects'::regclass and a.attnum > 0 and not a.attisdropped order by a.attnum;
select 'PROJECT_CONSTRAINTS' as section, conname, contype, convalidated,
  condeferrable, condeferred, pg_get_constraintdef(oid, true) as definition
from pg_catalog.pg_constraint where conrelid = 'public.projects'::regclass order by contype, conname;
select 'PROJECT_INDEXES' as section, i.indexrelid::regclass::text as index_name,
  i.indisprimary, i.indisunique, i.indisvalid, i.indisready,
  pg_get_indexdef(i.indexrelid) as definition,
  pg_get_expr(i.indpred, i.indrelid) as predicate
from pg_catalog.pg_index i where i.indrelid = 'public.projects'::regclass order by index_name;
select 'PROJECT_RLS' as section, c.relrowsecurity, c.relforcerowsecurity,
  pg_get_userbyid(c.relowner) as table_owner, r.rolsuper, r.rolbypassrls
from pg_catalog.pg_class c join pg_catalog.pg_roles r on r.oid = c.relowner
where c.oid = 'public.projects'::regclass;
select 'PROJECT_POLICIES' as section, policyname, permissive, roles, cmd, qual, with_check
from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'projects' order by policyname;
select 'PROJECT_TABLE_ACL' as section,
  case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end as grantee,
  pg_get_userbyid(acl.grantor) as grantor, acl.privilege_type, acl.is_grantable
from pg_catalog.pg_class c,
  lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
where c.oid = 'public.projects'::regclass order by grantee, privilege_type;
select 'PROJECT_COLUMN_ACL' as section, a.attname,
  case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end as grantee,
  acl.privilege_type, acl.is_grantable
from pg_catalog.pg_attribute a, lateral aclexplode(a.attacl) acl
where a.attrelid = 'public.projects'::regclass and a.attnum > 0 and not a.attisdropped
order by a.attname, grantee, privilege_type;
select 'PROJECT_EFFECTIVE_ACCESS' as section, role_name,
  has_table_privilege(role_name, 'public.projects', 'SELECT') as can_select,
  has_table_privilege(role_name, 'public.projects', 'INSERT') as can_insert,
  has_table_privilege(role_name, 'public.projects', 'UPDATE') as can_update,
  has_table_privilege(role_name, 'public.projects', 'DELETE') as can_delete
from (values ('anon'), ('authenticated')) roles(role_name);

select 'PROJECT_USER_TRIGGERS' as section, t.tgname, t.tgenabled as trigger_mode,
  case t.tgenabled when 'O' then 'origin' when 'D' then 'disabled'
    when 'R' then 'replica' when 'A' then 'always' end as mode_description,
  pg_get_triggerdef(t.oid, true) as trigger_definition, t.tgfoid::regprocedure::text as function_signature,
  p.prosecdef, p.provolatile, p.proconfig, p.proacl, pg_get_userbyid(p.proowner) as function_owner,
  pg_get_functiondef(p.oid) as function_definition
from pg_catalog.pg_trigger t join pg_catalog.pg_proc p on p.oid = t.tgfoid
where t.tgrelid = 'public.projects'::regclass and not t.tgisinternal order by t.tgname;

select 'BUSINESS_ID_DEFAULT' as section, a.attname, a.attidentity, a.attgenerated,
  pg_get_expr(d.adbin, d.adrelid) as exact_default,
  pg_get_serial_sequence('public.projects', 'project_id') as owned_sequence
from pg_catalog.pg_attribute a left join pg_catalog.pg_attrdef d
  on d.adrelid = a.attrelid and d.adnum = a.attnum
where a.attrelid = 'public.projects'::regclass and a.attname = 'project_id' and not a.attisdropped;

-- Catalog edges are evidence, not a complete PL/pgSQL call graph. String-bodied
-- functions and dynamic SQL can hide dependencies. All project trigger functions
-- are therefore included, plus the previously verified generator if it exists.
with recursive roots as (
  select dep.refobjid as function_oid, 'project_id default dependency'::text as origin
  from pg_catalog.pg_attrdef d join pg_catalog.pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
  join pg_catalog.pg_depend dep on dep.classid = 'pg_attrdef'::regclass and dep.objid = d.oid
    and dep.refclassid = 'pg_proc'::regclass
  where a.attrelid = 'public.projects'::regclass and a.attname = 'project_id'
  union
  select t.tgfoid, 'project user trigger (inspect whether it assigns project_id)'
  from pg_catalog.pg_trigger t where t.tgrelid = 'public.projects'::regclass and not t.tgisinternal
  union
  select to_regprocedure('public.generate_project_business_id()')::oid, 'previously verified generator name; confirm actual binding'
  where to_regprocedure('public.generate_project_business_id()') is not null
), reachable(function_oid) as (
  select function_oid from roots
  union
  select dep.refobjid from reachable r join pg_catalog.pg_depend dep
    on dep.classid = 'pg_proc'::regclass and dep.objid = r.function_oid and dep.refclassid = 'pg_proc'::regclass
)
select 'GENERATOR_AND_TRIGGER_FUNCTIONS' as section, p.oid::regprocedure::text as signature,
  (select string_agg(distinct origin, '; ') from roots where function_oid = p.oid) as discovery,
  l.lanname as language, pg_get_userbyid(p.proowner) as owner, p.prosecdef as security_definer,
  case p.provolatile when 'i' then 'IMMUTABLE' when 's' then 'STABLE' when 'v' then 'VOLATILE' end as volatility,
  p.proconfig, p.proacl, owner_role.rolsuper, owner_role.rolbypassrls,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
  (select jsonb_agg(jsonb_build_object(
    'grantee', case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end,
    'privilege', acl.privilege_type, 'grant_option', acl.is_grantable))
    from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl) as effective_function_acl,
  p.prosrc ~* '\m(public[[:space:]]*\.[[:space:]]*)?projects\M' as projects_reference_detected,
  p.prosrc ~* '\m(max|count)[[:space:]]*\(|organization_settings|singleton' as global_dataset_heuristic,
  p.prosrc ~* '\m(nextval|setval)\M' as sequence_operation_in_body_not_executed,
  'REVIEW REQUIRED: heuristics are not proof of table use, global assumptions, concurrency safety or RLS independence' as assessment,
  case when p.prosecdef then
    'Runs as function owner. Review owner/table ownership, BYPASSRLS, FORCE RLS and nested invoker calls.'
  else 'Runs as caller. Reads of projects may become tenant-filtered or denied by the proposed RLS.' end as rls_generation_risk,
  (select jsonb_agg(jsonb_build_object('type', dep.deptype,
    'referenced_object', pg_describe_object(dep.refclassid, dep.refobjid, dep.refobjsubid)))
    from pg_catalog.pg_depend dep where dep.classid = 'pg_proc'::regclass and dep.objid = p.oid) as outgoing_dependencies,
  (select jsonb_agg(jsonb_build_object('type', dep.deptype,
    'dependent_object', pg_describe_object(dep.classid, dep.objid, dep.objsubid)))
    from pg_catalog.pg_depend dep where dep.refclassid = 'pg_proc'::regclass and dep.refobjid = p.oid) as incoming_dependencies,
  pg_get_functiondef(p.oid) as exact_function_definition
from reachable r join pg_catalog.pg_proc p on p.oid = r.function_oid
join pg_catalog.pg_language l on l.oid = p.prolang
join pg_catalog.pg_roles owner_role on owner_role.oid = p.proowner order by signature;

select 'BUSINESS_ID_DEFAULT_DEPENDENCIES' as section, dep.deptype,
  pg_describe_object(dep.refclassid, dep.refobjid, dep.refobjsubid) as referenced_object
from pg_catalog.pg_attrdef d join pg_catalog.pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
join pg_catalog.pg_depend dep on dep.classid = 'pg_attrdef'::regclass and dep.objid = d.oid
where a.attrelid = 'public.projects'::regclass and a.attname = 'project_id';

-- Inventory all public sequences plus nonpublic catalog-linked sequences. A
-- dynamically constructed sequence name remains an explicit owner-review item.
-- No generator or sequence operation is called.
select 'PUBLIC_AND_REFERENCED_SEQUENCES' as section, c.oid::regclass::text as sequence_name,
  pg_get_userbyid(c.relowner) as owner, format_type(s.seqtypid, null) as data_type,
  s.seqstart, s.seqincrement, s.seqmin, s.seqmax, s.seqcache, s.seqcycle, c.relacl,
  (select jsonb_agg(pg_describe_object(dep.refclassid, dep.refobjid, dep.refobjsubid))
    from pg_catalog.pg_depend dep where dep.classid = 'pg_class'::regclass and dep.objid = c.oid) as dependencies
from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
join pg_catalog.pg_sequence s on s.seqrelid = c.oid
where n.nspname = 'public' or exists (
  select 1 from pg_catalog.pg_depend dep where dep.refclassid = 'pg_class'::regclass and dep.refobjid = c.oid
    and ((dep.classid = 'pg_attrdef'::regclass and exists (
      select 1 from pg_catalog.pg_attrdef d where d.oid = dep.objid and d.adrelid = 'public.projects'::regclass
    )) or (dep.classid = 'pg_proc'::regclass and exists (
      select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace pn on pn.oid = p.pronamespace
      where p.oid = dep.objid and (pn.nspname = 'public' or exists (
        select 1 from pg_catalog.pg_trigger t where t.tgrelid = 'public.projects'::regclass and t.tgfoid = p.oid and not t.tgisinternal
      ))
    )))
) order by sequence_name;
do $$
declare seq record; last_number bigint; called boolean;
begin
  for seq in select c.oid from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'S' and (n.nspname = 'public' or exists (
      select 1 from pg_catalog.pg_depend dep where dep.refclassid = 'pg_class'::regclass and dep.refobjid = c.oid
        and ((dep.classid = 'pg_attrdef'::regclass and exists (
          select 1 from pg_catalog.pg_attrdef d where d.oid = dep.objid and d.adrelid = 'public.projects'::regclass
        )) or (dep.classid = 'pg_proc'::regclass and exists (
          select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace pn on pn.oid = p.pronamespace
          where p.oid = dep.objid and (pn.nspname = 'public' or exists (
            select 1 from pg_catalog.pg_trigger t where t.tgrelid = 'public.projects'::regclass and t.tgfoid = p.oid and not t.tgisinternal
          ))
        )))
    )) order by c.oid loop
    execute format('select last_value, is_called from %s', seq.oid::regclass) into last_number, called;
    raise notice 'SEQUENCE_STATE: % last_value=% is_called=% (read only; sequence state is not an MVCC snapshot)',
      seq.oid::regclass, last_number, called;
  end loop;
end;
$$;

-- Exact infrastructure evidence; normalize CRLF to LF and final CR/LF only.
-- Never execute the event-trigger function.
select 'REVIEWED_RLS_EVENT_TRIGGER' as section, e.evtname, e.evtevent,
  e.evtenabled, e.evttags, pg_get_userbyid(e.evtowner) as event_owner,
  p.oid::regprocedure::text as signature, p.prosecdef, p.provolatile, p.proconfig,
  pg_get_userbyid(p.proowner) as function_owner, p.proacl,
  encode(sha256(convert_to(rtrim(replace(pg_get_functiondef(p.oid), E'\r\n', E'\n'), E'\r\n'), 'UTF8')), 'hex') as definition_sha256,
  pg_get_functiondef(p.oid) as exact_function_definition
from pg_catalog.pg_event_trigger e join pg_catalog.pg_proc p on p.oid = e.evtfoid
order by e.evtname;

-- EXACT RPC allowlist, plus a separately validated infrastructure exception.
-- Ordinary trigger exemption is not an assertion that a trigger is tenant-safe.
with reviewed(signature) as (values
  ('public.current_user_has_governance_role(text)'), ('public.get_my_governance_roles()'),
  ('public.list_governance_role_assignments()'), ('public.assign_governance_role(uuid,text)'),
  ('public.revoke_governance_role(uuid,text)'), ('public.list_governance_users()'),
  ('public.create_change_request(text,numeric,text,text,text,text,text,text,text,text,text)'),
  ('public.update_draft_change_request(uuid,numeric,text,text,text,text,text,text,text,text,text)'),
  ('public.transition_change_request_status(uuid,text,text)'), ('public.delete_draft_change_request(uuid)'),
  ('public.apply_approved_change_request(uuid,text)'), ('public._analyze_project_import(jsonb)'),
  ('public.check_project_import(jsonb)'), ('public.commit_project_import(uuid,jsonb,jsonb)'),
  ('public.set_organization_currency(text,text,boolean)'),
  ('public.save_organization_profile(text,text,timestamptz)'), ('public.get_my_profile()'),
  ('public.save_my_profile(text,text,timestamptz)')
)
select 'PUBLIC_NON_EXTENSION_DEFINERS' as section, p.oid::regprocedure::text as signature,
  pg_get_userbyid(p.proowner) as owner, p.prorettype::regtype as return_type,
  p.provolatile, p.proconfig, p.proacl,
  exists (select 1 from reviewed where to_regprocedure(signature) = p.oid) as in_reviewed_allowlist,
  case when exists (select 1 from reviewed where to_regprocedure(signature) = p.oid) then 'REVIEWED ALLOWLIST'
    when p.oid = to_regprocedure('public.rls_auto_enable()') then 'CONDITIONAL INFRASTRUCTURE EXCEPTION; EXACT SECURITY/BINDING/BODY CHECK REQUIRED'
    when p.prorettype = 'trigger'::regtype then 'MIGRATION EXEMPTS TRIGGERS; OWNER REVIEW REQUIRED'
    else 'STOP: UNKNOWN DEFINER; MIGRATION WILL REJECT' end as migration_comparison,
  pg_get_functiondef(p.oid) as definition
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef and not exists (select 1 from pg_catalog.pg_depend dep
  where dep.classid = 'pg_proc'::regclass and dep.objid = p.oid and dep.deptype = 'e')
order by signature;

select 'AUTH_USER_TRIGGERS' as section, t.tgname, t.tgenabled,
  pg_get_triggerdef(t.oid, true) as trigger_definition, t.tgfoid::regprocedure::text as signature,
  p.prosecdef, p.provolatile, p.proconfig, p.proacl,
  p.prosrc ~* '(governance_user_roles|assign_governance_role|organization_memberships|create_workspace)' as prohibited_assignment_reference,
  pg_get_functiondef(p.oid) as function_definition,
  (select jsonb_agg(pg_describe_object(dep.refclassid, dep.refobjid, dep.refobjsubid))
    from pg_catalog.pg_depend dep where dep.classid = 'pg_proc'::regclass and dep.objid = p.oid) as dependencies
from pg_catalog.pg_trigger t join pg_catalog.pg_proc p on p.oid = t.tgfoid
where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal order by t.tgname;
select 'AUTH_HOOK_CANDIDATES' as section, p.oid::regprocedure::text as signature,
  p.prosecdef, p.provolatile, p.proconfig,
  pg_get_functiondef(p.oid) as function_definition,
  'Function presence does not prove hook registration. Inspect Supabase Auth Hooks and nested/dynamic calls separately.' as limitation
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'auth') and p.prokind = 'f'
  and p.proname ~* '(hook|signup|new_user|new_account|bootstrap|create_workspace)' order by signature;

select 'EXPECTED_IMPORT_CONSTRAINT' as section, conname, contype, convalidated,
  condeferrable, condeferred, pg_get_constraintdef(oid, true) as definition
from pg_catalog.pg_constraint where conrelid = 'public.project_imports'::regclass
  and conname = 'project_imports_actor_key_unique';
select 'EXPECTED_GOVERNANCE_PRIMARY_KEY' as section, conname, contype,
  pg_get_constraintdef(oid, true) as definition
from pg_catalog.pg_constraint where conrelid = 'public.governance_user_roles'::regclass
  and conname = 'governance_user_roles_pkey';
select 'EXPECTED_PROVENANCE_INDEX' as section, i.indexrelid::regclass::text as index_name,
  i.indisunique, i.indisvalid, i.indisready, pg_get_indexdef(i.indexrelid) as definition,
  pg_get_expr(i.indpred, i.indrelid) as predicate
from pg_catalog.pg_index i where i.indexrelid = to_regclass('public.project_import_rows_source_unique');
select 'HISTORY_FOREIGN_KEYS' as section, c.conrelid::regclass::text as source_table, c.conname,
  c.confrelid::regclass::text as target_table, c.confdeltype, c.confupdtype, c.confmatchtype,
  c.convalidated, c.condeferrable, c.condeferred, pg_get_constraintdef(c.oid, true) as definition
from pg_catalog.pg_constraint c where c.contype = 'f' and c.conrelid in (
  'public.project_import_rows'::regclass, 'public.change_requests'::regclass, 'public.change_request_events'::regclass
) order by source_table, c.conname;

-- Final automatic checks plus explicit owner-review boundary. No mutation RPCs.
do $$
declare
  -- These are attestations for THIS preflight only, not production settings.
  generator_implementation_reviewed boolean := true;
  project_and_auth_trigger_paths_reviewed boolean := true;
  external_auth_hooks_reviewed boolean := true;
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
  intended_admin constant uuid := 'ed1005a0-76e4-4614-8a66-589c055ecff5';
  reviewed constant text[] := array[
    'public.current_user_has_governance_role(text)', 'public.get_my_governance_roles()',
    'public.list_governance_role_assignments()', 'public.assign_governance_role(uuid,text)',
    'public.revoke_governance_role(uuid,text)', 'public.list_governance_users()',
    'public.create_change_request(text,numeric,text,text,text,text,text,text,text,text,text)',
    'public.update_draft_change_request(uuid,numeric,text,text,text,text,text,text,text,text,text)',
    'public.transition_change_request_status(uuid,text,text)', 'public.delete_draft_change_request(uuid)',
    'public.apply_approved_change_request(uuid,text)', 'public._analyze_project_import(jsonb)',
    'public.check_project_import(jsonb)', 'public.commit_project_import(uuid,jsonb,jsonb)',
    'public.set_organization_currency(text,text,boolean)',
    'public.save_organization_profile(text,text,timestamptz)', 'public.get_my_profile()',
    'public.save_my_profile(text,text,timestamptz)'
  ];
  stops text[] := '{}'; signature text; item record; helper oid;
  total bigint; fingerprint text; index_row record; actual_columns text[];
  previous_sub text := current_setting('request.jwt.claim.sub', true);
  previous_role text := current_setting('request.jwt.claim.role', true);
  previous_claims text := current_setting('request.jwt.claims', true);
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
  if v_rls_problem is not null then stops := array_append(stops, v_rls_problem); end if;
  select count(*), encode(sha256(convert_to(coalesce(string_agg(to_jsonb(p)::text, '' order by p.project_id), ''), 'UTF8')), 'hex')
    into total, fingerprint from public.projects p;
  if total <> 11 or fingerprint is distinct from '8ec06c5d60751b598b089aa9d16ad3d7644f1cb3417149410c6e4af88c9f1758' then
    stops := array_append(stops, 'Project count/fingerprint differs from the approved 11-project baseline.');
  end if;
  if (select count(*) from public.project_imports) <> 1 or (select count(*) from public.project_import_rows) <> 1
    or (select count(*) from public.change_requests) <> 2 or (select count(*) from public.change_request_events) <> 11 then
    stops := array_append(stops, 'Expected imports=1, import rows=1, requests=2, events=11.');
  end if;
  if (select count(*) from public.organization_settings) <> 1 or not exists (
    select 1 from public.organization_settings where id = true and organization_name = 'Brisk & Zip' and organization_currency = 'CAD'
  ) then stops := array_append(stops, 'Brisk & Zip/CAD singleton differs.'); end if;
  if exists (select 1 from public.project_imports where currency_code is distinct from 'CAD'
    or result->>'currency_code' is distinct from 'CAD') then
    stops := array_append(stops, 'Historical import currency/result is not CAD.');
  end if;
  if current_setting('server_version_num')::integer < 150000 then
    stops := array_append(stops, 'PostgreSQL 15+ is required for the reviewed view/FK features.');
  end if;
  if not exists (select 1 from pg_catalog.pg_class where oid = 'public.projects'::regclass and relrowsecurity) then
    stops := array_append(stops, 'Project RLS is not enabled.');
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.projects'::regclass
    and contype = 'p' and conkey = array[(select attnum from pg_catalog.pg_attribute
      where attrelid = 'public.projects'::regclass and attname = 'id')]::smallint[]) then
    stops := array_append(stops, 'Expected projects primary key on id is missing.');
  end if;
  if not exists (select 1 from pg_catalog.pg_index i where i.indrelid = 'public.projects'::regclass
    and i.indisunique and i.indisvalid and i.indisready and i.indpred is null and i.indnkeyatts = 1
    and i.indexprs is null and i.indkey[0] = (select attnum from pg_catalog.pg_attribute
      where attrelid = 'public.projects'::regclass and attname = 'project_id')) then
    stops := array_append(stops, 'A valid nonpartial unique project_id index is required.');
  end if;
  if not exists (select 1 from pg_catalog.pg_attrdef d join pg_catalog.pg_attribute a
    on a.attrelid = d.adrelid and a.attnum = d.adnum where a.attrelid = 'public.projects'::regclass
      and a.attname = 'project_id') and not exists (
    select 1 from pg_catalog.pg_trigger t join pg_catalog.pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.projects'::regclass and not t.tgisinternal and t.tgenabled <> 'D'
      and p.prosrc ~* '\mproject_id\M'
  ) then stops := array_append(stops, 'No project_id default or detectable ID trigger found; generator binding is unverified.'); end if;
  foreach signature in array reviewed loop
    if to_regprocedure(signature) is null then stops := array_append(stops, 'Missing reviewed prerequisite: ' || signature); end if;
  end loop;
  for item in select p.oid::regprocedure::text as name from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
      and p.oid is distinct from v_rls_oid
      and not exists (select 1 from unnest(reviewed) allowed(signature) where to_regprocedure(allowed.signature) = p.oid)
      and not exists (select 1 from pg_catalog.pg_depend dep where dep.classid = 'pg_proc'::regclass and dep.objid = p.oid and dep.deptype = 'e') loop
    stops := array_append(stops, 'Unknown non-extension public SECURITY DEFINER rejected by migration: ' || item.name);
  end loop;
  if exists (select 1 from pg_catalog.pg_trigger t join pg_catalog.pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal
      and pg_get_functiondef(p.oid) ~* '(governance_user_roles|assign_governance_role|organization_memberships|create_workspace)') then
    stops := array_append(stops, 'Auth trigger references automatic role/membership assignment; reviewed migration rejects it.');
  end if;

  if not exists (select 1 from pg_catalog.pg_constraint c where c.conrelid = 'public.project_imports'::regclass
    and c.conname = 'project_imports_actor_key_unique' and c.contype = 'u' and c.convalidated and not c.condeferrable
    and (select array_agg(a.attname::text order by key.ordinality) from unnest(c.conkey) with ordinality key(attnum, ordinality)
      join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = key.attnum) = array['imported_by', 'idempotency_key']) then
    stops := array_append(stops, 'Exact project_imports_actor_key_unique definition is missing or differs.');
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint c where c.conrelid = 'public.governance_user_roles'::regclass
    and c.conname = 'governance_user_roles_pkey' and c.contype = 'p' and c.convalidated and not c.condeferrable
    and (select array_agg(a.attname::text order by key.ordinality) from unnest(c.conkey) with ordinality key(attnum, ordinality)
      join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = key.attnum) = array['user_id', 'role']) then
    stops := array_append(stops, 'Exact governance_user_roles_pkey definition is missing or differs.');
  end if;
  select i.* into index_row from pg_catalog.pg_index i
    where i.indexrelid = to_regclass('public.project_import_rows_source_unique');
  if not found then stops := array_append(stops, 'Exact project_import_rows_source_unique index is missing.');
  else
    select array_agg(a.attname::text order by key.ordinality) into actual_columns
    from unnest(index_row.indkey) with ordinality key(attnum, ordinality)
    join pg_catalog.pg_attribute a on a.attrelid = index_row.indrelid and a.attnum = key.attnum;
    if index_row.indrelid <> 'public.project_import_rows'::regclass or not index_row.indisunique
      or not index_row.indisvalid or not index_row.indisready or index_row.indnkeyatts <> 2 or index_row.indnatts <> 2
      or index_row.indexprs is not null or actual_columns is distinct from array['source_namespace', 'source_project_id']
      or regexp_replace(lower(coalesce(pg_get_expr(index_row.indpred, index_row.indrelid), '')), '[()[:space:]]', '', 'g')
        <> 'source_namespaceisnotnullandsource_project_idisnotnull' then
      stops := array_append(stops, 'Exact source provenance index keys/predicate/uniqueness differ.');
    end if;
  end if;
  for item in select * from (values
    ('public.project_import_rows', 'project_uuid', 'public.projects', 'id', 'n'),
    ('public.project_import_rows', 'import_id', 'public.project_imports', 'id', 'a'),
    ('public.change_requests', 'project_id', 'public.projects', 'id', 'r'),
    ('public.change_request_events', 'change_request_id', 'public.change_requests', 'id', 'c')
  ) expected(source_table, source_column, target_table, target_column, delete_action) loop
    if (select count(*) from pg_catalog.pg_constraint c where c.conrelid = to_regclass(item.source_table)
      and c.contype = 'f' and (select attnum from pg_catalog.pg_attribute
        where attrelid = c.conrelid and attname = item.source_column) = any(c.conkey)) <> 1
      or not exists (select 1 from pg_catalog.pg_constraint c where c.conrelid = to_regclass(item.source_table)
        and c.contype = 'f' and c.confrelid = to_regclass(item.target_table) and c.convalidated and not c.condeferrable
        and c.confdeltype::text = item.delete_action and c.confupdtype = 'a' and c.confmatchtype = 's'
        and c.conkey = array[(select attnum from pg_catalog.pg_attribute where attrelid = c.conrelid and attname = item.source_column)]::smallint[]
        and c.confkey = array[(select attnum from pg_catalog.pg_attribute where attrelid = c.confrelid and attname = item.target_column)]::smallint[]) then
      stops := array_append(stops, format('FK semantics differ: %s.%I -> %s.%I', item.source_table, item.source_column, item.target_table, item.target_column));
    end if;
  end loop;

  helper := to_regprocedure('public.current_user_has_governance_role(text)');
  if not exists (select 1 from auth.users where id = intended_admin) or not exists (
    select 1 from public.governance_user_roles where user_id = intended_admin and role = 'governance_admin'
  ) then stops := array_append(stops, 'Intended existing Auth account is absent or not currently Governance Admin.');
  elsif helper is null or not exists (select 1 from pg_catalog.pg_proc where oid = helper
    and prosecdef and provolatile = 's' and prorettype = 'boolean'::regtype and 'search_path=""' = any(proconfig))
    or not has_function_privilege('authenticated', helper, 'EXECUTE') or has_function_privilege('anon', helper, 'EXECUTE') then
    stops := array_append(stops, 'Existing Governance Admin helper security/grants differ; recognition probe not run.');
  else
    perform set_config('request.jwt.claim.sub', intended_admin::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', intended_admin, 'role', 'authenticated')::text, true);
    if public.current_user_has_governance_role('governance_admin') is distinct from true then
      stops := array_append(stops, 'Intended existing Governance Admin is not recognized by the deployed helper.');
    else raise notice 'PASS: Intended existing Governance Admin recognized; no assignment changed.'; end if;
    perform set_config('request.jwt.claim.sub', coalesce(previous_sub, ''), true);
    perform set_config('request.jwt.claim.role', coalesce(previous_role, ''), true);
    perform set_config('request.jwt.claims', coalesce(previous_claims, ''), true);
  end if;
  if cardinality(stops) = 0 then
    raise notice 'PASS: Automatic baseline/catalog/authorization assertions passed. Generator, trigger paths and external hooks still require explicit owner review.';
  end if;
  if not generator_implementation_reviewed then
    stops := array_append(stops, 'OWNER REVIEW REQUIRED: Trace exact project_id binding, generator/helpers, sequences/global-ID assumptions, concurrency and proposed RLS impact; catalog/source heuristics alone cannot certify safety.');
  end if;
  if not project_and_auth_trigger_paths_reviewed then
    stops := array_append(stops, 'OWNER REVIEW REQUIRED: Inspect project/Auth trigger bodies and nested/dynamic helper paths; confirm no automatic role/membership assignment or unscoped side effects.');
  end if;
  if not external_auth_hooks_reviewed then
    stops := array_append(stops, 'OWNER REVIEW REQUIRED: Confirm Supabase Auth dashboard/server HTTP/SQL hooks do not automatically assign membership/roles; registration is not fully visible in PostgreSQL catalogs.');
  end if;
  if cardinality(stops) > 0 then
    foreach signature in array stops loop raise notice 'STOP: %', signature; end loop;
    raise exception using errcode = 'P0001', message = 'STOP: Workspace preflight is not cleared.',
      detail = array_to_string(stops, E'\n'), hint = 'Review inventory and unresolved items. Do not apply migration. ROLLBACK this session after the error.';
  end if;
  raise notice 'PASS: Automatic preflight assertions and explicit owner reviews passed. No objects/data/sequence state changed. Migration remains unapplied and requires separate approval.';
end;
$$;

select 'PASS' as preflight_summary,
  'Read-only checks and owner-review attestations passed; this is NOT migration authorization.' as scope;
rollback;
