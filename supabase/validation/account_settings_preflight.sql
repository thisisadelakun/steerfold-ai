-- Operator-run, read-only preflight. Do not apply migrations with this script.
-- Confirm the Supabase dashboard project/environment before running.
-- v_admin_user_id identifies this preflight's intended account only, not a permanent administrator.
-- The helper probe uses transaction-local JWT context, not a role assignment.
begin transaction read only;
set local time zone 'UTC';
select current_database() as database_name, current_user as database_role,
  current_setting('server_version') as postgres_version;
do $$
declare
  v_admin_user_id uuid := 'ed1005a0-76e4-4614-8a66-589c055ecff5'::uuid; -- Verification only; does not assign a role.
  v_helper oid;
  v_assignment oid;
  v_previous_sub text := current_setting('request.jwt.claim.sub', true);
  v_previous_role text := current_setting('request.jwt.claim.role', true);
  v_previous_claims text := current_setting('request.jwt.claims', true);
begin
  v_helper := pg_catalog.to_regprocedure('public.current_user_has_governance_role(text)');
  if v_helper is null then
    raise exception 'BLOCKER: current_user_has_governance_role(text) is missing.' using errcode = '42883';
  end if;
  if pg_catalog.to_regclass('public.governance_user_roles') is null
    or pg_catalog.to_regclass('auth.users') is null then
    raise exception 'BLOCKER: Governance role assignments or Auth users structure is missing.' using errcode = '42P01';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public'
    and table_name = 'governance_user_roles' and (column_name, udt_name) in
      (('user_id', 'uuid'), ('role', 'text'), ('assigned_by', 'uuid'), ('assigned_at', 'timestamptz'))) <> 4 then
    raise exception 'BLOCKER: Governance role assignment columns differ from the expected model.' using errcode = '23514';
  end if;
  if not exists (select 1 from pg_catalog.pg_class where oid = 'public.governance_user_roles'::regclass and relrowsecurity)
    or not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.governance_user_roles'::regclass
      and contype = 'p' and pg_catalog.pg_get_constraintdef(oid) = 'PRIMARY KEY (user_id, role)')
    or not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.governance_user_roles'::regclass
      and contype = 'f' and confrelid = 'auth.users'::regclass) then
    raise exception 'BLOCKER: Governance role RLS, primary key or Auth relationship is missing.' using errcode = '23514';
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.governance_user_roles'::regclass
    and contype = 'c' and convalidated
    and position(quote_literal('governance_admin') in pg_catalog.pg_get_constraintdef(oid)) > 0)
    or position(quote_literal('governance_admin') in pg_catalog.pg_get_functiondef(v_helper)) = 0 then
    raise exception 'BLOCKER: The deployed governance model does not recognize governance_admin.' using errcode = '23514';
  end if;
  if not exists (select 1 from pg_catalog.pg_proc where oid = v_helper and prosecdef
    and prorettype = 'boolean'::regtype and 'search_path=""' = any(proconfig))
    or not pg_catalog.has_function_privilege('authenticated', v_helper, 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', v_helper, 'EXECUTE') then
    raise exception 'BLOCKER: Governance helper security/search_path or authenticated EXECUTE is invalid.' using errcode = '42501';
  end if;
  v_assignment := pg_catalog.to_regprocedure('public.assign_governance_role(uuid,text)');
  if v_assignment is null or pg_catalog.to_regprocedure('public.get_my_governance_roles()') is null then
    raise exception 'BLOCKER: Controlled Governance role assignment/read RPCs are missing.' using errcode = '42883';
  end if;
  if position(quote_literal('governance_admin') in pg_catalog.pg_get_functiondef(v_assignment)) = 0
    or not exists (select 1 from pg_catalog.pg_proc where oid = v_assignment and prosecdef and 'search_path=""' = any(proconfig))
    or not pg_catalog.has_function_privilege('authenticated', v_assignment, 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', v_assignment, 'EXECUTE')
    or pg_catalog.has_table_privilege('authenticated', 'public.governance_user_roles', 'INSERT,UPDATE,DELETE') then
    raise exception 'BLOCKER: Controlled role assignment does not support Governance Admin.' using errcode = '42501';
  end if;
  if v_admin_user_id is null then
    raise exception 'BLOCKER: Intended administrator UUID is required. Governance Admin status is UNVERIFIED; do not roll out.' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = v_admin_user_id) then
    raise exception 'BLOCKER: Intended administrator is not an existing Supabase Auth user.' using errcode = '23503';
  end if;
  if not exists (select 1 from public.governance_user_roles where user_id = v_admin_user_id and role = 'governance_admin') then
    raise exception 'BLOCKER: Intended account is NOT Governance Admin. An authorized assignment/bootstrap is required before rollout; no assignment was made.' using errcode = '42501';
  end if;
  -- Read-only recognition probe: no credentials, assignments or grants are changed.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_admin_user_id::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  perform pg_catalog.set_config('request.jwt.claims', jsonb_build_object('sub', v_admin_user_id, 'role', 'authenticated')::text, true);
  if public.current_user_has_governance_role('governance_admin') is distinct from true then
    raise exception 'BLOCKER: Intended administrator assignment exists but the governance helper does not recognize it.' using errcode = '42501';
  end if;
  perform pg_catalog.set_config('request.jwt.claim.sub', coalesce(v_previous_sub, ''), true);
  perform pg_catalog.set_config('request.jwt.claim.role', coalesce(v_previous_role, ''), true);
  perform pg_catalog.set_config('request.jwt.claims', coalesce(v_previous_claims, ''), true);
  raise notice 'PASS: Intended Auth user is assigned and recognized as governance_admin. No assignment or grant was changed.';
end;
$$;
select table_schema, table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name in ('projects', 'organization_settings', 'user_profiles', 'project_imports', 'change_requests')
order by table_name, ordinal_position;
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_catalog.pg_policies
where schemaname = 'public' and tablename in ('organization_settings', 'user_profiles', 'projects');
select n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef, p.proconfig, p.proacl
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('set_organization_currency', 'get_my_profile', 'save_my_profile', 'save_organization_profile');
do $$
declare item record; total bigint;
begin
  if pg_catalog.to_regclass('supabase_migrations.schema_migrations') is not null then
    for item in execute 'select version::text as version from supabase_migrations.schema_migrations order by version' loop
      raise notice 'Applied migration version: %', item.version;
    end loop;
  else
    raise notice 'No CLI migration ledger found. Review the established SQL Editor deployment records.';
  end if;
  for item in select unnest(array['projects', 'organization_settings', 'user_profiles', 'project_imports', 'change_requests']) as name loop
    if pg_catalog.to_regclass('public.' || item.name) is not null then
      execute pg_catalog.format('select count(*) from public.%I', item.name) into total;
      raise notice 'Existing % rows: %', item.name, total;
    end if;
  end loop;
end;
$$;
-- Fingerprint rows without returning personal or financial field values.
select count(*) as project_count,
  encode(sha256(convert_to(coalesce(string_agg(to_jsonb(p)::text, '' order by p.project_id), ''), 'UTF8')), 'hex') as projects_fingerprint
from public.projects p;
rollback;
