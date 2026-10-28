-- LOCAL REVIEW ONLY. No database execution is authorized by this artifact.
-- Requires all preceding repository migrations, PostgreSQL 15+, and projects.
-- Existing business IDs, amounts, audit actors and historical JSON stay intact.
begin;
set local lock_timeout = '5s';
set local time zone 'UTC';

-- The base projects DDL is external to this repository. Refuse unknown public
-- definer entry points rather than silently leaving an unreviewed tenant bypass.
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
  select string_agg(p.oid::regprocedure::text, ', ') into v_unknown
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
    and p.oid <> v_rls_oid
    and p.oid <> all(array[
      'public.current_user_has_governance_role(text)'::regprocedure,
      'public.get_my_governance_roles()'::regprocedure,
      'public.list_governance_role_assignments()'::regprocedure,
      'public.assign_governance_role(uuid,text)'::regprocedure,
      'public.revoke_governance_role(uuid,text)'::regprocedure,
      'public.list_governance_users()'::regprocedure,
      'public.create_change_request(text,numeric,text,text,text,text,text,text,text,text,text)'::regprocedure,
      'public.update_draft_change_request(uuid,numeric,text,text,text,text,text,text,text,text,text)'::regprocedure,
      'public.transition_change_request_status(uuid,text,text)'::regprocedure,
      'public.delete_draft_change_request(uuid)'::regprocedure,
      'public.apply_approved_change_request(uuid,text)'::regprocedure,
      'public._analyze_project_import(jsonb)'::regprocedure,
      'public.check_project_import(jsonb)'::regprocedure,
      'public.commit_project_import(uuid,jsonb,jsonb)'::regprocedure,
      'public.set_organization_currency(text,text,boolean)'::regprocedure,
      'public.save_organization_profile(text,text,timestamptz)'::regprocedure,
      'public.get_my_profile()'::regprocedure,
      'public.save_my_profile(text,text,timestamptz)'::regprocedure
    ]) and not exists (select 1 from pg_catalog.pg_depend d
      where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e');
  if v_unknown is not null then
    raise exception 'Unreviewed SECURITY DEFINER functions: %', v_unknown using errcode = '42501';
  end if;
  if (select count(*) from public.organization_settings) <> 1 then
    raise exception 'Exactly one legacy organization settings row is required.';
  end if;
end;
$$;

-- Hold source rows stable for the entire migration and verify their original
-- content again before COMMIT. Only the new tenant metadata is excluded.
lock table public.projects, public.change_requests, public.change_request_events,
  public.project_imports, public.project_import_rows, public.governance_user_roles,
  public.organization_settings, public.user_profiles in share row exclusive mode;

-- This rollout targets the verified Brisk & Zip baseline, not arbitrary data.
-- Use the original preflight serialization/order, separately from the generic
-- order-independent preservation snapshots below.
do $$
declare v_count bigint; v_fingerprint text;
begin
  select count(*), encode(sha256(convert_to(coalesce(string_agg(to_jsonb(p)::text, '' order by p.project_id), ''), 'UTF8')), 'hex')
    into v_count, v_fingerprint from public.projects p;
  if v_count <> 11 or v_fingerprint is distinct from '8ec06c5d60751b598b089aa9d16ad3d7644f1cb3417149410c6e4af88c9f1758' then
    raise exception 'Known baseline mismatch: expected 11 projects and the verified original fingerprint.' using errcode = '23514';
  end if;
  if (select count(*) from public.project_imports) <> 1
    or (select count(*) from public.project_import_rows) <> 1
    or (select count(*) from public.change_requests) <> 2
    or (select count(*) from public.change_request_events) <> 11 then
    raise exception 'Known baseline mismatch: expected imports=1, import rows=1, requests=2, events=11.' using errcode = '23514';
  end if;
  if (select count(*) from public.organization_settings) <> 1 or not exists (
    select 1 from public.organization_settings where id = true
      and organization_name = 'Brisk & Zip' and organization_currency = 'CAD'
  ) then
    raise exception 'Known baseline mismatch: expected the unchanged Brisk & Zip/CAD singleton.' using errcode = '23514';
  end if;
end;
$$;

-- Read sequence state without advancing it. Table locks block normal writers;
-- direct sequence consumers must also be quiescent during the future rollout.
create temporary table workspace_sequence_snapshot (
  sequence_oid oid primary key, sequence_name text not null,
  last_value bigint not null, is_called boolean not null, definition jsonb not null
) on commit drop;
do $$
declare v_sequence record; v_last bigint; v_called boolean;
begin
  for v_sequence in select c.oid, c.oid::regclass::text as name, to_jsonb(s) as definition
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_sequence s on s.seqrelid = c.oid
    where n.nspname = 'public' and c.relkind = 'S' loop
    execute format('select last_value, is_called from %s', v_sequence.oid::regclass) into v_last, v_called;
    insert into pg_temp.workspace_sequence_snapshot values
      (v_sequence.oid, v_sequence.name, v_last, v_called, v_sequence.definition);
  end loop;
end;
$$;

create temporary table workspace_preservation_snapshot (
  table_name text primary key, row_count bigint not null, fingerprint text not null
) on commit drop;
do $$
declare v_table text; v_count bigint; v_fingerprint text;
begin
  foreach v_table in array array['projects','change_requests','change_request_events',
    'project_imports','project_import_rows','governance_user_roles','organization_settings','user_profiles'] loop
    execute format($query$
      select count(*), encode(sha256(convert_to(coalesce(string_agg(row_hash, '' order by row_hash), ''), 'UTF8')), 'hex')
      from (select encode(sha256(convert_to((to_jsonb(t) - 'organization_id')::text, 'UTF8')), 'hex') as row_hash
        from public.%I t) rows
    $query$, v_table) into v_count, v_fingerprint;
    insert into pg_temp.workspace_preservation_snapshot values (v_table, v_count, v_fingerprint);
  end loop;
end;
$$;

-- Abort if an installed Auth hook would grant global roles on signup. Personal
-- profile hooks are independent and remain untouched.
do $$
begin
  if exists (select 1 from pg_catalog.pg_trigger t join pg_catalog.pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal
      and pg_catalog.pg_get_functiondef(p.oid) ~* '(governance_user_roles|assign_governance_role|organization_memberships|create_workspace)') then
    raise exception 'Remove automatic signup role/membership hooks before workspace rollout.' using errcode = '42501';
  end if;
end;
$$;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  organization_name text not null check (organization_name = btrim(organization_name)
    and char_length(organization_name) between 1 and 120),
  industry text not null check (industry = btrim(industry) and char_length(industry) <= 120),
  organization_currency text not null check (organization_currency in ('CAD','USD','GBP','EUR')),
  is_demo boolean not null default false,
  constraint organizations_demo_currency_cad check (not is_demo or organization_currency = 'CAD'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index organizations_one_demo on public.organizations (is_demo) where is_demo;

-- Stable discovery ID; the legacy singleton supplies identity/currency verbatim.
insert into public.organizations (id, organization_name, industry, organization_currency, is_demo, updated_at)
select '00000000-0000-4000-8000-000000000001', organization_name, industry,
  organization_currency, true, updated_at from public.organization_settings where id = true;

create table public.organization_memberships (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  membership_role text not null default 'member' check (membership_role in ('owner','member')),
  -- Frozen migration eligibility: newly assigned demo admins cannot gain writes.
  demo_write_eligible boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_memberships_user_idx on public.organization_memberships (user_id, organization_id);
insert into public.organization_memberships (organization_id, user_id, demo_write_eligible)
select '00000000-0000-4000-8000-000000000001', user_id, bool_or(role = 'governance_admin')
from public.governance_user_roles group by user_id;

-- Only a tenant column is added to existing business/history rows.
-- Suspend existing user triggers during this metadata-only backfill so timestamp
-- and audit hooks cannot alter historical fields. Restore their exact modes.
create temporary table workspace_trigger_state on commit drop as
select t.tgrelid, t.tgname, t.tgenabled from pg_catalog.pg_trigger t
where not t.tgisinternal and t.tgrelid in (
  'public.projects'::regclass, 'public.change_requests'::regclass,
  'public.change_request_events'::regclass, 'public.project_imports'::regclass,
  'public.project_import_rows'::regclass, 'public.governance_user_roles'::regclass
);
do $$
declare v_table text; v_trigger record;
begin
  for v_trigger in select * from pg_temp.workspace_trigger_state where tgenabled <> 'D' loop
    execute format('alter table %s disable trigger %I', v_trigger.tgrelid::regclass, v_trigger.tgname);
  end loop;
  foreach v_table in array array['projects','change_requests','change_request_events',
    'project_imports','project_import_rows','governance_user_roles'] loop
    execute format('alter table public.%I add column organization_id uuid references public.organizations(id)', v_table);
    execute format('update public.%I set organization_id = %L::uuid', v_table, '00000000-0000-4000-8000-000000000001');
    execute format('alter table public.%I alter column organization_id set not null', v_table);
    execute format('create index %I on public.%I (organization_id)', v_table || '_organization_idx', v_table);
  end loop;
  for v_trigger in select * from pg_temp.workspace_trigger_state where tgenabled <> 'D' loop
    execute format('alter table %s enable %strigger %I', v_trigger.tgrelid::regclass,
      case v_trigger.tgenabled when 'R' then 'replica ' when 'A' then 'always ' else '' end, v_trigger.tgname);
  end loop;
end;
$$;
alter table public.governance_user_roles drop constraint governance_user_roles_pkey;
alter table public.governance_user_roles add primary key (organization_id, user_id, role);
alter table public.governance_user_roles add foreign key (organization_id, user_id)
  references public.organization_memberships(organization_id, user_id) on delete cascade;
alter table public.projects add unique (organization_id, id);
alter table public.change_requests add unique (organization_id, id);
alter table public.project_imports add unique (organization_id, id);
alter table public.change_requests add foreign key (organization_id, project_id)
  references public.projects(organization_id, id) on delete restrict;
alter table public.change_request_events add foreign key (organization_id, change_request_id)
  references public.change_requests(organization_id, id) on delete cascade;
alter table public.project_import_rows add foreign key (organization_id, import_id)
  references public.project_imports(organization_id, id) on delete restrict;
alter table public.project_import_rows add foreign key (organization_id, project_uuid)
  references public.projects(organization_id, id) on delete set null (project_uuid);
alter table public.project_imports drop constraint project_imports_actor_key_unique;
alter table public.project_imports add constraint project_imports_workspace_actor_key_unique
  unique (organization_id, imported_by, idempotency_key);
drop index public.project_import_rows_source_unique;
create unique index project_import_rows_source_unique
  on public.project_import_rows (organization_id, source_namespace, source_project_id)
  where source_namespace is not null and source_project_id is not null;

create function public.active_organization_id()
returns uuid language plpgsql stable security definer set search_path = ''
as $$
declare v_headers jsonb; v_raw text; v_id uuid;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when invalid_text_representation then
    raise exception 'Invalid request headers.' using errcode = '22023';
  end;
  if v_headers is null or jsonb_typeof(v_headers) <> 'object'
    or not (v_headers ? 'x-steerfold-organization-id') then
    raise exception 'An organization request header is required.' using errcode = '42501';
  end if;
  v_raw := v_headers->>'x-steerfold-organization-id';
  if jsonb_typeof(v_headers->'x-steerfold-organization-id') is distinct from 'string'
    or v_raw !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Organization header must be a canonical UUID.' using errcode = '22023';
  end if;
  v_id := v_raw::uuid;
  if not exists (select 1 from public.organizations o where o.id = v_id and
    (o.is_demo or (auth.role() = 'authenticated' and auth.uid() is not null and exists
      (select 1 from public.organization_memberships m where m.organization_id = o.id and m.user_id = auth.uid())))) then
    raise exception 'Organization access denied.' using errcode = '42501';
  end if;
  return v_id;
end;
$$;

create function public._workspace_can_write(p_organization_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce(auth.role() = 'authenticated' and auth.uid() is not null and exists (
    select 1 from public.organization_memberships m join public.organizations o on o.id = m.organization_id
    where m.organization_id = p_organization_id and m.user_id = auth.uid()
      and (not o.is_demo or (m.demo_write_eligible and exists (
        select 1 from public.governance_user_roles r where r.organization_id = o.id
          and r.user_id = auth.uid() and r.role = 'governance_admin')))), false);
$$;
create function public._require_workspace_write()
returns uuid language plpgsql stable security definer set search_path = ''
as $$
declare v_id uuid := public.active_organization_id();
begin
  if public._workspace_can_write(v_id) is distinct from true then
    raise exception 'Workspace writes are not permitted.' using errcode = '42501';
  end if;
  return v_id;
end;
$$;

create or replace function public.current_user_has_governance_role(p_role text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce(auth.role() = 'authenticated' and auth.uid() is not null and exists (
    select 1 from public.governance_user_roles r
    where r.organization_id = public.active_organization_id() and r.user_id = auth.uid() and r.role = p_role), false);
$$;

create function public.list_my_workspaces()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id, 'organization_name', o.organization_name, 'industry', o.industry,
    'organization_currency', o.organization_currency, 'is_demo', o.is_demo,
    'can_write', public._workspace_can_write(o.id), 'membership_role', m.membership_role
  ) order by o.is_demo desc, o.organization_name, o.id), '[]'::jsonb)
  from public.organizations o left join public.organization_memberships m
    on m.organization_id = o.id and m.user_id = auth.uid() and auth.role() = 'authenticated'
  where o.is_demo or m.user_id is not null;
$$;

create function public.create_workspace(p_name text, p_industry text, p_currency text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_org public.organizations%rowtype;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 120
    or p_industry is null or char_length(btrim(p_industry)) > 120
    or p_currency is null or p_currency <> all(array['CAD','USD','GBP','EUR']) then
    raise exception 'A name, industry and supported explicit currency are required.' using errcode = '22023';
  end if;
  insert into public.organizations (organization_name, industry, organization_currency)
    values (btrim(p_name), btrim(p_industry), p_currency) returning * into v_org;
  insert into public.organization_memberships (organization_id, user_id, membership_role)
    values (v_org.id, auth.uid(), 'owner');
  insert into public.governance_user_roles (organization_id, user_id, role, assigned_by)
    values (v_org.id, auth.uid(), 'governance_admin', auth.uid());
  return jsonb_build_object('id', v_org.id, 'organization_name', v_org.organization_name,
    'industry', v_org.industry, 'organization_currency', v_org.organization_currency,
    'is_demo', false, 'can_write', true, 'membership_role', 'owner');
end;
$$;

-- RLS is complemented by immutable tenant ownership and cross-tenant FKs.
-- Trigger guards cover definer writes too; role creation is separately controlled.
create function public._guard_workspace_row()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_id uuid := public._require_workspace_write();
begin
  if TG_OP <> 'INSERT' and old.organization_id is distinct from v_id then
    raise exception 'Row belongs to another workspace.' using errcode = '42501';
  end if;
  if TG_OP <> 'DELETE' and new.organization_id is distinct from v_id then
    raise exception 'Row must belong to the selected workspace.' using errcode = '42501';
  end if;
  if TG_OP = 'DELETE' then return old; end if;
  return new;
end;
$$;
do $$
declare v_table text; v_policy record;
begin
  foreach v_table in array array['organizations','organization_memberships','projects',
    'change_requests','change_request_events','project_imports','project_import_rows','governance_user_roles'] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on public.%I from public, anon, authenticated', v_table);
    for v_policy in select policyname from pg_catalog.pg_policies
      where schemaname = 'public' and tablename = v_table loop
      execute format('drop policy %I on public.%I', v_policy.policyname, v_table);
    end loop;
  end loop;
  foreach v_table in array array['projects','change_requests','change_request_events','project_imports','project_import_rows'] loop
    execute format('alter table public.%I alter column organization_id set default public.active_organization_id()', v_table);
    execute format('create trigger workspace_row_guard before insert or update or delete on public.%I for each row execute function public._guard_workspace_row()', v_table);
  end loop;
end;
$$;
grant select on public.projects to anon, authenticated;
create policy workspace_read on public.projects for select to anon, authenticated
  using (organization_id = (select public.active_organization_id()));
-- Operational history requires real membership, even in public Demo. These
-- correlated checks use the nonrecursive own-membership SELECT policy below.
grant select on public.change_requests, public.change_request_events to authenticated;
create policy workspace_read on public.change_requests for select to authenticated
  using (organization_id = (select public.active_organization_id()) and exists (
    select 1 from public.organization_memberships m
    where m.organization_id = change_requests.organization_id and m.user_id = (select auth.uid())
  ));
create policy workspace_read on public.change_request_events for select to authenticated
  using (organization_id = (select public.active_organization_id()) and exists (
    select 1 from public.organization_memberships m
    where m.organization_id = change_request_events.organization_id and m.user_id = (select auth.uid())
  ));
grant select on public.project_imports, public.project_import_rows to authenticated;
create policy own_workspace_imports on public.project_imports for select to authenticated
  using (organization_id = (select public.active_organization_id()) and imported_by = (select auth.uid()) and exists (
    select 1 from public.organization_memberships m
    where m.organization_id = project_imports.organization_id and m.user_id = (select auth.uid())
  ));
create policy own_workspace_import_rows on public.project_import_rows for select to authenticated
  using (organization_id = (select public.active_organization_id()) and exists (
    select 1 from public.organization_memberships m
    where m.organization_id = project_import_rows.organization_id and m.user_id = (select auth.uid())
  ) and exists (
    select 1 from public.project_imports batch where batch.id = import_id
      and batch.organization_id = project_import_rows.organization_id and batch.imported_by = (select auth.uid())
  ));
grant select on public.organizations to anon, authenticated;
create policy workspace_read on public.organizations for select to anon, authenticated
  using (id = (select public.active_organization_id()));
grant select on public.organization_memberships to authenticated;
create policy own_membership_read on public.organization_memberships for select to authenticated
  using (organization_id = (select public.active_organization_id()) and user_id = (select auth.uid()));
grant insert, update, delete on public.projects to authenticated;
create policy workspace_insert on public.projects for insert to authenticated
  with check (organization_id = (select public.active_organization_id()) and public._workspace_can_write(organization_id));
create policy workspace_update on public.projects for update to authenticated
  using (organization_id = (select public.active_organization_id()) and public._workspace_can_write(organization_id))
  with check (organization_id = (select public.active_organization_id()) and public._workspace_can_write(organization_id));
create policy workspace_delete on public.projects for delete to authenticated
  using (organization_id = (select public.active_organization_id()) and public._workspace_can_write(organization_id));

-- Preserve legacy configuration as an inaccessible archive, not a second authority.
alter table public.organization_settings rename to _legacy_organization_settings;
revoke all on public._legacy_organization_settings from public, anon, authenticated;
drop policy "Public organization currency read" on public._legacy_organization_settings;
create view public.organization_settings with (security_invoker = true, security_barrier = true) as
select true as id, o.organization_currency, o.updated_at, o.organization_name, o.industry,
  o.id as organization_id
from public.organizations o where o.id = public.active_organization_id();
revoke all on public.organization_settings from public, anon, authenticated;
grant select on public.organization_settings to anon, authenticated;

create function public._touch_organization()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.is_demo is distinct from old.is_demo
    or new.created_at is distinct from old.created_at then
    raise exception 'Workspace identity is immutable.' using errcode = '23514';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
create trigger organization_updated before update on public.organizations
  for each row execute function public._touch_organization();

create or replace function public.set_organization_currency(p_currency text, p_expected_currency text, p_confirm boolean)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '5s'
as $$
declare v_id uuid := public._require_workspace_write(); v_org public.organizations%rowtype;
begin
  if not public.current_user_has_governance_role('governance_admin') then
    raise exception 'Governance Admin access is required.' using errcode = '42501';
  end if;
  if p_currency is null or p_currency <> all(array['CAD','USD','GBP','EUR'])
    or p_expected_currency is null or p_expected_currency <> all(array['CAD','USD','GBP','EUR']) then
    raise exception 'Unsupported organization currency.' using errcode = '22023';
  end if;
  select * into strict v_org from public.organizations where id = v_id for update;
  if v_org.is_demo and p_currency <> 'CAD' then
    raise exception 'Demo workspace currency must remain CAD.' using errcode = '23514';
  end if;
  if v_org.organization_currency is distinct from p_expected_currency then
    raise exception 'Organization currency changed elsewhere. Reload Settings.' using errcode = '23505';
  end if;
  if v_org.organization_currency <> p_currency then
    if p_confirm is distinct from true then
      raise exception 'Explicit currency-context confirmation is required.' using errcode = '22023';
    end if;
    update public.organizations set organization_currency = p_currency where id = v_id;
  end if;
  return (select to_jsonb(s) from public.organization_settings s);
end;
$$;

create or replace function public.save_organization_profile(p_name text, p_industry text, p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '5s'
as $$
declare v_id uuid := public._require_workspace_write(); v_org public.organizations%rowtype;
begin
  if not public.current_user_has_governance_role('governance_admin') then
    raise exception 'Governance Admin access is required.' using errcode = '42501';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 120
    or p_industry is null or char_length(btrim(p_industry)) > 120 then
    raise exception 'A name and industry of at most 120 characters are required.' using errcode = '22023';
  end if;
  select * into strict v_org from public.organizations where id = v_id for update;
  if v_org.updated_at is distinct from p_expected_updated_at then
    raise exception 'Organization settings changed elsewhere. Reload before saving.' using errcode = '23505';
  end if;
  update public.organizations set organization_name = btrim(p_name), industry = btrim(p_industry) where id = v_id;
  return (select to_jsonb(s) from public.organization_settings s);
end;
$$;

-- Tenant-scoped replacements retain existing workflow checks and audit writes.
create or replace function public.create_change_request(
  p_project_code text,
  p_budget_change_amount numeric,
  p_change_type text,
  p_change_summary text default null,
  p_impact_scope text default 'None',
  p_impact_schedule text default 'None',
  p_impact_cost text default 'None',
  p_impact_quality text default 'None',
  p_impact_resources text default 'None',
  p_impact_risk text default 'None',
  p_impact_stakeholders text default 'None'
)
returns public.change_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public._require_workspace_write();
  v_user_id uuid := auth.uid();
  v_project public.projects%rowtype;
  v_request public.change_requests%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication is required to create a change request.' using errcode = '42501';
  end if;

  if not public.current_user_has_governance_role('requester') then
    raise exception 'Requester role is required to create Change Requests.'
      using errcode = '42501';
  end if;

  select * into v_project
  from public.projects
  where organization_id = v_org and project_id = p_project_code;

  if not found then
    raise exception 'The selected project does not exist.' using errcode = '23503';
  end if;

  insert into public.change_requests (
    project_id, project_code, original_bac, budget_change_amount,
    proposed_bac, change_type, change_summary, impact_scope,
    impact_schedule, impact_cost, impact_quality, impact_resources,
    impact_risk, impact_stakeholders, created_by
  ) values (
    v_project.id, v_project.project_id, v_project.budget_bac,
    p_budget_change_amount, v_project.budget_bac + p_budget_change_amount,
    p_change_type, nullif(btrim(p_change_summary), ''), p_impact_scope,
    p_impact_schedule, p_impact_cost, p_impact_quality,
    p_impact_resources, p_impact_risk, p_impact_stakeholders, v_user_id
  ) returning * into v_request;

  insert into public.change_request_events (
    change_request_id, event_type, to_status, note, performed_by
  ) values (
    v_request.id, 'Created', 'Draft', null, v_user_id
  );

  return v_request;
end;
$$;

create or replace function public.update_draft_change_request(
  p_change_request_id uuid,
  p_budget_change_amount numeric,
  p_change_type text,
  p_change_summary text default null,
  p_impact_scope text default 'None',
  p_impact_schedule text default 'None',
  p_impact_cost text default 'None',
  p_impact_quality text default 'None',
  p_impact_resources text default 'None',
  p_impact_risk text default 'None',
  p_impact_stakeholders text default 'None'
)
returns public.change_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public._require_workspace_write();
  v_user_id uuid := auth.uid();
  v_request public.change_requests%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication is required to update a change request.' using errcode = '42501';
  end if;

  select * into v_request
  from public.change_requests
  where organization_id = v_org and id = p_change_request_id
  for update;

  if not found then
    raise exception 'Change request not found.' using errcode = 'P0002';
  end if;

  if not public.current_user_has_governance_role('requester') then
    raise exception 'Requester role is required for this Change Request action.'
      using errcode = '42501';
  end if;

  if v_request.created_by is distinct from v_user_id then
    raise exception 'Only the Requester who created this Draft can edit it.'
      using errcode = '42501';
  end if;

  if v_request.status <> 'Draft' then
    raise exception 'Only Draft change requests can be edited.' using errcode = '23514';
  end if;

  update public.change_requests
  set budget_change_amount = p_budget_change_amount,
      proposed_bac = original_bac + p_budget_change_amount,
      change_type = p_change_type,
      change_summary = nullif(btrim(p_change_summary), ''),
      impact_scope = p_impact_scope,
      impact_schedule = p_impact_schedule,
      impact_cost = p_impact_cost,
      impact_quality = p_impact_quality,
      impact_resources = p_impact_resources,
      impact_risk = p_impact_risk,
      impact_stakeholders = p_impact_stakeholders
  where organization_id = v_org and id = p_change_request_id
  returning * into v_request;

  insert into public.change_request_events (
    change_request_id, event_type, from_status, to_status, performed_by
  ) values (
    v_request.id, 'Updated', 'Draft', 'Draft', v_user_id
  );

  return v_request;
end;
$$;

create or replace function public.delete_draft_change_request(
  p_change_request_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public._require_workspace_write();
  v_user_id uuid := auth.uid();
  v_status text;
  v_created_by uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication is required to delete a change request.' using errcode = '42501';
  end if;

  select status, created_by into v_status, v_created_by
  from public.change_requests
  where organization_id = v_org and id = p_change_request_id
  for update;

  if not found then
    raise exception 'Change request not found.' using errcode = 'P0002';
  end if;

  if not public.current_user_has_governance_role('requester') then
    raise exception 'Requester role is required for this Change Request action.'
      using errcode = '42501';
  end if;

  if v_created_by is distinct from v_user_id then
    raise exception 'Only the Requester who created this Change Request can perform this action.'
      using errcode = '42501';
  end if;

  if v_status <> 'Draft' then
    raise exception 'Only Draft change requests can be deleted.' using errcode = '23514';
  end if;

  delete from public.change_requests where organization_id = v_org and id = p_change_request_id;
  return true;
end;
$$;

create or replace function public.transition_change_request_status(
  p_change_request_id uuid,
  p_new_status text,
  p_note text default null
)
returns public.change_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public._require_workspace_write();
  v_user_id uuid := auth.uid();
  v_request public.change_requests%rowtype;
  v_from_status text;
  v_event_type text;
  v_review_event public.change_request_events%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication is required to transition a change request.' using errcode = '42501';
  end if;

  select * into v_request
  from public.change_requests
  where organization_id = v_org and id = p_change_request_id
  for update;

  if not found then
    raise exception 'Change request not found.' using errcode = 'P0002';
  end if;

  v_from_status := v_request.status;

  if not (
    (v_from_status = 'Draft' and p_new_status in ('Submitted', 'Withdrawn')) or
    (v_from_status = 'Submitted' and p_new_status in ('Under Review', 'Withdrawn')) or
    (v_from_status = 'Under Review' and p_new_status in ('Approved', 'Rejected', 'Deferred')) or
    (v_from_status = 'Deferred' and p_new_status = 'Under Review')
  ) then
    raise exception 'Invalid change request status transition from % to %.', v_from_status, p_new_status
      using errcode = '23514';
  end if;

  if p_new_status in ('Submitted', 'Withdrawn') then
    if not public.current_user_has_governance_role('requester') then
      raise exception 'Requester role is required for this Change Request action.'
        using errcode = '42501';
    end if;
    if v_request.created_by is distinct from v_user_id then
      raise exception 'Only the Requester who created this Change Request can perform this action.'
        using errcode = '42501';
    end if;
  elsif p_new_status = 'Under Review' then
    if not public.current_user_has_governance_role('reviewer') then
      raise exception 'Reviewer role is required for this Change Request action.'
        using errcode = '42501';
    end if;
    if v_user_id is not distinct from v_request.created_by then
      raise exception 'The Requester who created this Change Request cannot perform its governance review.'
        using errcode = '42501';
    end if;
  elsif p_new_status in ('Approved', 'Rejected', 'Deferred') then
    if not public.current_user_has_governance_role('approver') then
      raise exception 'Approver role is required for this Change Request action.'
        using errcode = '42501';
    end if;
    if v_user_id is not distinct from v_request.created_by then
      raise exception 'The Requester who created this Change Request cannot record its governance decision.'
        using errcode = '42501';
    end if;

    -- Verify the latest event belongs to this review cycle, not a prior deferral.
    select * into v_review_event
    from public.change_request_events
    where organization_id = v_org and change_request_id = v_request.id
      and event_type = 'Review Started'
    order by created_at desc, id desc
    limit 1;

    if not found or v_review_event.performed_by is null
      or v_review_event.from_status is null
      or v_review_event.from_status not in ('Submitted', 'Deferred')
      or v_review_event.to_status is distinct from 'Under Review'
      or v_request.reviewed_at is null
      or v_review_event.created_at is distinct from v_request.reviewed_at
    then
      raise exception 'Current review actor could not be verified.'
        using errcode = '23514';
    end if;
    if v_user_id is not distinct from v_review_event.performed_by then
      raise exception 'The Reviewer who started this review cannot record its governance decision.'
        using errcode = '42501';
    end if;
  end if;

  v_event_type := case p_new_status
    when 'Submitted' then 'Submitted'
    when 'Under Review' then 'Review Started'
    when 'Approved' then 'Approved'
    when 'Rejected' then 'Rejected'
    when 'Deferred' then 'Deferred'
    when 'Withdrawn' then 'Withdrawn'
  end;

  update public.change_requests
  set status = p_new_status,
      submitted_at = case when p_new_status = 'Submitted' then now() else submitted_at end,
      reviewed_at = case when p_new_status = 'Under Review' then now() else reviewed_at end,
      decided_at = case
        when p_new_status in ('Approved', 'Rejected', 'Deferred', 'Withdrawn') then now()
        when p_new_status = 'Under Review' then null
        else decided_at
      end,
      decision_note = case
        when p_new_status = 'Under Review' then null
        when p_new_status in ('Approved', 'Rejected', 'Deferred', 'Withdrawn') then nullif(btrim(p_note), '')
        else decision_note
      end
  where organization_id = v_org and id = p_change_request_id
  returning * into v_request;

  insert into public.change_request_events (
    change_request_id, event_type, from_status, to_status, note, performed_by
  ) values (
    v_request.id, v_event_type, v_from_status, p_new_status,
    nullif(btrim(p_note), ''), v_user_id
  );

  return v_request;
end;
$$;

create or replace function public.apply_approved_change_request(
  p_change_request_id uuid,
  p_application_note text default null
)
returns public.change_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public._require_workspace_write();
  v_user_id uuid := auth.uid();
  v_request public.change_requests%rowtype;
  v_project public.projects%rowtype;
  v_application_note text := nullif(btrim(p_application_note), '');
  v_approval_event public.change_request_events%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication is required to apply an approved Change Request.'
      using errcode = '42501';
  end if;

  select * into v_request
  from public.change_requests
  where organization_id = v_org and id = p_change_request_id
  for update;

  if not found then
    raise exception 'Change Request not found.' using errcode = 'P0002';
  end if;

  if not public.current_user_has_governance_role('baseline_controller') then
    raise exception 'Baseline Controller role is required to apply an approved budget change.'
      using errcode = '42501';
  end if;

  if v_request.status <> 'Approved' then
    raise exception 'Only an Approved Change Request can be applied.'
      using errcode = '23514';
  end if;

  if v_request.applied_at is not null then
    raise exception 'Change Request has already been applied.'
      using errcode = '23514';
  end if;

  if v_user_id is not distinct from v_request.created_by then
    raise exception 'The Requester who created this Change Request cannot apply its approved baseline change.'
      using errcode = '42501';
  end if;

  select * into v_approval_event
  from public.change_request_events
  where organization_id = v_org and change_request_id = v_request.id
    and event_type = 'Approved'
  order by created_at desc, id desc
  limit 1;

  if not found or v_approval_event.performed_by is null
    or v_approval_event.from_status is distinct from 'Under Review'
    or v_approval_event.to_status is distinct from 'Approved'
    or v_request.decided_at is null
    or v_approval_event.created_at is distinct from v_request.decided_at
  then
    raise exception 'Approval actor could not be verified.'
      using errcode = '23514';
  end if;
  if v_user_id is not distinct from v_approval_event.performed_by then
    raise exception 'The Approver who recorded this governance decision cannot apply the approved baseline change.'
      using errcode = '42501';
  end if;

  select * into v_project
  from public.projects
  where organization_id = v_org and id = v_request.project_id
  for update;

  if not found then
    raise exception 'The related project no longer exists.' using errcode = '23503';
  end if;

  if v_project.budget_bac is distinct from v_request.original_bac then
    raise exception 'Project budget baseline has changed since this Change Request was created.'
      using errcode = '23514';
  end if;

  if v_request.budget_change_amount = 0 then
    raise exception 'Change Request budget change amount must be non-zero.'
      using errcode = '23514';
  end if;

  if
    v_request.proposed_bac <= 0 or
    v_request.proposed_bac is distinct from
      (v_request.original_bac + v_request.budget_change_amount)
  then
    raise exception 'Change Request proposed budget is invalid.'
      using errcode = '23514';
  end if;

  update public.projects
  set budget_bac = v_request.proposed_bac
  where organization_id = v_org and id = v_project.id;

  update public.change_requests
  set applied_at = now(),
      applied_by = v_user_id,
      applied_bac_before = v_project.budget_bac,
      applied_bac_after = v_request.proposed_bac,
      application_note = v_application_note
  where organization_id = v_org and id = v_request.id
  returning * into v_request;

  insert into public.change_request_events (
    change_request_id,
    event_type,
    from_status,
    to_status,
    note,
    performed_by,
    created_at
  ) values (
    v_request.id,
    'Applied',
    'Approved',
    'Approved',
    v_application_note,
    v_user_id,
    now()
  );

  return v_request;
end;
$$;

create or replace function public.get_my_governance_roles()
returns table (role text, assigned_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.active_organization_id();
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication is required to access governance roles.'
      using errcode = '42501';
  end if;

  return query
    select assignment.role, assignment.assigned_at
    from public.governance_user_roles as assignment
    where assignment.organization_id = v_org and assignment.user_id = v_user_id
    order by assignment.role;
end;
$$;

create or replace function public.list_governance_role_assignments()
returns table (
  user_id uuid,
  email text,
  role text,
  assigned_at timestamptz,
  assigned_by uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_org uuid := public.active_organization_id();
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to access governance roles.'
      using errcode = '42501';
  end if;

  if not public.current_user_has_governance_role('governance_admin') then
    raise exception 'Governance Admin role is required to manage role assignments.'
      using errcode = '42501';
  end if;

  return query
    select assignment.user_id, target.email::text, assignment.role,
      assignment.assigned_at, assignment.assigned_by
    from public.governance_user_roles as assignment
    join auth.users as target on target.id = assignment.user_id
    where assignment.organization_id = v_org
    order by target.email, assignment.user_id, assignment.role;
end;
$$;

create or replace function public.assign_governance_role(p_user_id uuid, p_role text)
returns public.governance_user_roles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public._require_workspace_write();
  v_user_id uuid := auth.uid();
  v_assignment public.governance_user_roles%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication is required to access governance roles.'
      using errcode = '42501';
  end if;

  -- Serialize role mutations and check caller authority after acquiring the lock.
  lock table public.governance_user_roles in share row exclusive mode;

  if not public.current_user_has_governance_role('governance_admin') then
    raise exception 'Governance Admin role is required to manage role assignments.'
      using errcode = '42501';
  end if;

  if p_role is null or p_role not in (
    'requester', 'reviewer', 'approver',
    'baseline_controller', 'governance_admin'
  ) then
    raise exception 'Unsupported governance role.' using errcode = '22023';
  end if;

  perform 1 from public.organization_memberships
  where organization_id = v_org and user_id = p_user_id for key share;
  if not found then
    raise exception 'Target workspace member not found.' using errcode = 'P0002';
  end if;

  insert into public.governance_user_roles (organization_id, user_id, role, assigned_by, assigned_at)
  values (v_org, p_user_id, p_role, v_user_id, now())
  on conflict (organization_id, user_id, role) do nothing;

  -- Duplicate assignment is idempotent and preserves the original audit fields.
  select * into v_assignment
  from public.governance_user_roles as assignment
  where assignment.organization_id = v_org and assignment.user_id = p_user_id and assignment.role = p_role;

  return v_assignment;
end;
$$;

create or replace function public.revoke_governance_role(p_user_id uuid, p_role text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public._require_workspace_write();
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication is required to access governance roles.'
      using errcode = '42501';
  end if;

  -- The same mutation lock protects the last-admin count and deletion together.
  lock table public.governance_user_roles in share row exclusive mode;

  if not public.current_user_has_governance_role('governance_admin') then
    raise exception 'Governance Admin role is required to manage role assignments.'
      using errcode = '42501';
  end if;

  if p_role is null or p_role not in (
    'requester', 'reviewer', 'approver',
    'baseline_controller', 'governance_admin'
  ) then
    raise exception 'Unsupported governance role.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.governance_user_roles as assignment
    where assignment.organization_id = v_org and assignment.user_id = p_user_id and assignment.role = p_role
  ) then
    raise exception 'Role assignment not found.' using errcode = 'P0002';
  end if;

  if p_role = 'governance_admin' and (
    select count(*) from public.governance_user_roles as assignment
    where assignment.organization_id = v_org and assignment.role = 'governance_admin'
  ) <= 1 then
    raise exception 'At least one Governance Admin must remain assigned.'
      using errcode = '23514';
  end if;

  delete from public.governance_user_roles as assignment
  where assignment.organization_id = v_org and assignment.user_id = p_user_id and assignment.role = p_role;

  return true;
end;
$$;

create or replace function public.list_governance_users()
returns table (
  user_id uuid,
  email text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_org uuid := public.active_organization_id();
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to access the governance user directory.'
      using errcode = '42501';
  end if;

  if not public.current_user_has_governance_role('governance_admin') then
    raise exception 'Governance Admin role is required to access the governance user directory.'
      using errcode = '42501';
  end if;

  return query
    select directory_user.id, directory_user.email::text, directory_user.created_at
    from auth.users as directory_user
    join public.organization_memberships m on m.user_id = directory_user.id
      and m.organization_id = v_org
    order by directory_user.email asc nulls last,
      directory_user.created_at asc, directory_user.id asc;
end;
$$;

create or replace function public._analyze_project_import(p_prepared jsonb)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_org uuid := public._require_workspace_write();
  v_hash text := public._project_import_hash(p_prepared);
  v_blocking jsonb;
  v_warnings jsonb;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' then
    raise exception 'Authentication is required to import projects.' using errcode = '42501';
  end if;
  with input as (
    select value, (value->>'source_row')::integer as source_row,
      value->>'source_project_id' as source_id
    from jsonb_array_elements(p_prepared->'rows')
  ), conflicts as (
    select jsonb_build_object('code', 'invalid_project', 'source_row', source_row,
      'messages', value->'errors') as item from input where jsonb_array_length(value->'errors') > 0
    union all
    select jsonb_build_object('code', 'duplicate_source_id', 'source_project_id', source_id,
      'source_rows', jsonb_agg(source_row order by source_row))
    from input where source_id is not null group by source_id having count(*) > 1
    union all
    select jsonb_build_object('code', 'source_id_already_imported', 'source_row', input.source_row,
      'source_project_id', input.source_id)
    from input join public.project_import_rows as prior
      on (p_prepared->>'source_namespace') is not null
        and prior.organization_id = v_org
        and prior.source_namespace = p_prepared->>'source_namespace'
        and prior.source_project_id = input.source_id
  ) select coalesce(jsonb_agg(item order by item::text), '[]'::jsonb) into v_blocking from conflicts;

  with input as (
    select value, (value->>'source_row')::integer as source_row,
      value->>'source_project_id' as source_id,
      public._project_import_match_key(value->'project'->>'project_name') as name_key
    from jsonb_array_elements(p_prepared->'rows')
    where jsonb_array_length(value->'errors') = 0
  ), conflicts as (
    select jsonb_build_object(
      'code', case
        when public._project_import_match_key(project.project_manager::text) = public._project_import_match_key(input.value->'project'->>'project_manager')
          and to_char(project.start_date, 'YYYY-MM-DD') = input.value->'project'->>'start_date' then 'name_manager_start_date_match'
        when public._project_import_match_key(project.project_manager::text) = public._project_import_match_key(input.value->'project'->>'project_manager') then 'name_manager_match'
        when to_char(project.start_date, 'YYYY-MM-DD') = input.value->'project'->>'start_date' then 'name_start_date_match'
        else 'name_match' end,
      'source_row', input.source_row, 'existing_project_uuid', project.id,
      'existing_project_id', project.project_id, 'existing_project_name', project.project_name,
      'existing_project_manager', project.project_manager, 'existing_start_date', project.start_date
    ) as item from input join public.projects as project
      on project.organization_id = v_org
        and public._project_import_match_key(project.project_name::text) = input.name_key
    union all
    select jsonb_build_object('code', 'source_id_matches_live_code', 'source_row', input.source_row,
      'existing_project_uuid', project.id, 'existing_project_id', project.project_id)
    from input join public.projects as project on project.organization_id = v_org and project.project_id = input.source_id
    union all
    select jsonb_build_object('code', 'name_repeated_in_upload', 'name_key', name_key,
      'source_rows', jsonb_agg(source_row order by source_row))
    from input group by name_key having count(*) > 1
  ), bounded as (
    -- Reject excessive conflicts rather than emitting an incomplete warning set.
    select item from conflicts limit 10001
  ) select coalesce(jsonb_agg(item || jsonb_build_object('conflict_id',
      public._project_import_hash(jsonb_build_object('organization_id', v_org, 'payload_hash', v_hash, 'conflict', item))) order by item::text), '[]'::jsonb)
    into v_warnings from bounded;
  if jsonb_array_length(v_warnings) > 10000 then
    raise exception 'Too many duplicate warnings; submit a smaller batch for review.' using errcode = '54000';
  end if;
  return jsonb_build_object(
    'contract_version', 1, 'organization_id', v_org, 'payload_hash', v_hash,
    'rows_submitted', jsonb_array_length(p_prepared->'rows'),
    'blocking_count', jsonb_array_length(v_blocking), 'warning_count', jsonb_array_length(v_warnings),
    'ready_for_confirmation', jsonb_array_length(v_blocking) = 0,
    'requires_acknowledgement', jsonb_array_length(v_warnings) > 0,
    'blocking_conflicts', v_blocking, 'warnings', v_warnings
  );
end;
$$;

create or replace function public.check_project_import(p_payload jsonb)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_org uuid := public._require_workspace_write();
  v_prepared jsonb;
  v_currency text;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' then
    raise exception 'Authentication is required to import projects.' using errcode = '42501';
  end if;
  v_prepared := public._prepare_project_import(p_payload);
  select organization_currency into v_currency from public.organizations where id = v_org;
  if v_currency is null or v_prepared->>'currency_code' is distinct from v_currency then
    raise exception 'Import currency must match the current organization currency. Review again.' using errcode = '23514';
  end if;
  return public._analyze_project_import(v_prepared);
end;
$$;

create or replace function public.commit_project_import(
  p_idempotency_key uuid,
  p_payload jsonb,
  p_acknowledgements jsonb default '[]'::jsonb
)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '5s'
as $$
declare
  v_org uuid := public._require_workspace_write();
  v_actor uuid := auth.uid();
  v_currency text;
  v_prepared jsonb;
  v_hash text;
  v_prior public.project_imports%rowtype;
  v_analysis jsonb;
  v_acknowledgements jsonb;
  v_expected jsonb;
  v_import_id uuid := gen_random_uuid();
  v_committed_at timestamptz;
  v_entry jsonb;
  v_project public.projects%rowtype;
  v_project_uuid uuid;
  v_project_code text;
  v_project_name text;
  v_results jsonb[] := '{}';
  v_result jsonb;
begin
  if v_actor is null or auth.role() is distinct from 'authenticated' then
    raise exception 'Authentication is required to import projects.' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'An import idempotency key is required.' using errcode = '22023';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Project import requires read committed isolation for conflict rechecking.' using errcode = '25000';
  end if;
  if jsonb_typeof(p_acknowledgements) is distinct from 'array' then
    raise exception 'Acknowledgements must be an array of conflict IDs.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_acknowledgements) > 10000 or exists (
    select 1 from jsonb_array_elements(p_acknowledgements) as ack(value)
    where jsonb_typeof(value) <> 'string' or (value #>> '{}') !~ '^[0-9a-f]{64}$'
  ) then
    raise exception 'Acknowledgements contain invalid conflict IDs.' using errcode = '22023';
  end if;
  if (select count(distinct value) from jsonb_array_elements(p_acknowledgements)) <> jsonb_array_length(p_acknowledgements) then
    raise exception 'Acknowledgement IDs must not be repeated.' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(value order by value::text), '[]'::jsonb) into v_acknowledgements
  from jsonb_array_elements(p_acknowledgements);
  v_prepared := public._prepare_project_import(p_payload);
  v_hash := public._project_import_hash(v_prepared);

  -- Same actor/key retries wait for the original transaction, then replay its
  -- stored result. A different actor never gets access to that original result.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_org::text || ':' || v_actor::text || ':' || p_idempotency_key::text, 0));
  select * into v_prior from public.project_imports
  where organization_id = v_org and imported_by = v_actor and idempotency_key = p_idempotency_key;
  if found then
    if v_prior.payload_hash <> v_hash or v_prior.acknowledgements <> v_acknowledgements then
      raise exception 'Import key was already committed with a different payload or acknowledgement set.' using errcode = '23505';
    end if;
    return v_prior.result || jsonb_build_object('organization_id', v_org, 'replayed', true);
  end if;

  -- An advisory import lock alone cannot exclude normal REST creates/updates.
  -- This lock also excludes ordinary project writers until this transaction ends.
  -- Reads stay available. All import commits acquire locks in this same order.
  -- Lock current currency through the whole NEW batch. Historical replays above
  -- keep their recorded currency and do not acquire the project-table lock.
  select organization_currency into v_currency from public.organizations
  where id = v_org for share;
  if v_currency is null or v_prepared->>'currency_code' is distinct from v_currency then
    raise exception 'Import currency must match the current organization currency. Review again.' using errcode = '23514';
  end if;
  lock table public.projects in share row exclusive mode;
  v_analysis := public._analyze_project_import(v_prepared);
  if (v_analysis->>'blocking_count')::integer > 0 then
    raise exception 'Import has blocking conflicts; no projects were imported.'
      using errcode = '23514', detail = v_analysis::text;
  end if;
  select coalesce(jsonb_agg(value->'conflict_id' order by (value->'conflict_id')::text), '[]'::jsonb)
  into v_expected from jsonb_array_elements(v_analysis->'warnings');
  if v_acknowledgements <> v_expected then
    raise exception 'Review and acknowledge the exact current duplicate warnings; no projects were imported.'
      using errcode = '23514', detail = v_analysis::text;
  end if;

  for v_entry in select value from jsonb_array_elements(v_prepared->'rows') loop
    select * into v_project from jsonb_populate_record(null::public.projects, v_entry->'project');
    -- Deliberately omit BOTH live IDs and timestamps. Verified database defaults
    -- generate them. No project UPDATE, DELETE or ON CONFLICT upsert exists here.
    insert into public.projects (
      project_name, project_manager, project_type, strategic_priority,
      budget_bac, planned_value_pv, earned_value_ev, actual_cost_ac,
      percent_complete, risk_score, start_date, end_date, resource_demand, project_status
    ) values (
      v_project.project_name, v_project.project_manager, v_project.project_type, v_project.strategic_priority,
      v_project.budget_bac, v_project.planned_value_pv, v_project.earned_value_ev, v_project.actual_cost_ac,
      v_project.percent_complete, v_project.risk_score, v_project.start_date, v_project.end_date,
      v_project.resource_demand, v_project.project_status
    ) returning id, project_id, project_name into v_project_uuid, v_project_code, v_project_name;
    v_results := array_append(v_results, jsonb_build_object(
      'source_row', (v_entry->>'source_row')::integer, 'source_project_id', v_entry->'source_project_id',
      'project_uuid', v_project_uuid, 'project_id', v_project_code, 'project_name', v_project_name
    ));
  end loop;

  v_committed_at := clock_timestamp();
  v_result := jsonb_build_object(
    'contract_version', 1, 'organization_id', v_org, 'status', 'committed', 'replayed', false,
    'import_id', v_import_id, 'idempotency_key', p_idempotency_key,
    'payload_hash', v_hash, 'imported_by', v_actor, 'committed_at', v_committed_at,
    'source_namespace', v_prepared->'source_namespace', 'currency_code', v_currency,
    'rows_submitted', cardinality(v_results), 'rows_imported', cardinality(v_results),
    'rows_skipped', 0, 'rows_failed', 0, 'rows', to_jsonb(v_results)
  );
  insert into public.project_imports (
    id, imported_by, idempotency_key, payload_hash, source_namespace, file_name,
    worksheet_name, currency_code, rows_submitted, rows_imported, acknowledgements, committed_at, result
  ) values (
    v_import_id, v_actor, p_idempotency_key, v_hash, v_prepared->>'source_namespace',
    v_prepared->>'file_name', v_prepared->>'worksheet_name', v_currency,
    cardinality(v_results), cardinality(v_results), v_acknowledgements, v_committed_at, v_result
  );
  insert into public.project_import_rows (
    import_id, source_row, source_namespace, source_project_id, project_uuid, project_code, project_name_snapshot
  ) select v_import_id, (original.value->>'source_row')::integer,
    v_prepared->>'source_namespace', original.value->>'source_project_id',
    (created.value->>'project_uuid')::uuid, created.value->>'project_id', created.value->>'project_name'
  from jsonb_array_elements(v_prepared->'rows') as original(value)
  join jsonb_array_elements(to_jsonb(v_results)) as created(value)
    on original.value->'source_row' = created.value->'source_row';

  -- No exception handler swallows insert/constraint/history failures. Every write
  -- above rolls back together. PostgreSQL sequences may still have harmless gaps.
  return v_result;
end;
$$;

create or replace function public.get_project_import_result(p_idempotency_key uuid)
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_org uuid := public.active_organization_id();
  v_result jsonb;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' then
    raise exception 'Authentication is required to read import results.' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'An import idempotency key is required.' using errcode = '22023';
  end if;
  select result into v_result from public.project_imports
  where organization_id = v_org and imported_by = auth.uid() and idempotency_key = p_idempotency_key;
  return coalesce(v_result || jsonb_build_object('organization_id', v_org), jsonb_build_object('contract_version', 1, 'organization_id', v_org, 'status', 'not_found', 'idempotency_key', p_idempotency_key));
end;
$$;

-- New functions never retain PostgreSQL's default PUBLIC EXECUTE. Restate the
-- complete modified API ACL, including revoked internal/trigger entry points.
do $$
declare v_signature text;
begin
  foreach v_signature in array array[
    'active_organization_id()', '_workspace_can_write(uuid)', '_require_workspace_write()',
    'list_my_workspaces()', 'create_workspace(text,text,text)', '_guard_workspace_row()', '_touch_organization()',
    'current_user_has_governance_role(text)', 'get_my_governance_roles()',
    'list_governance_role_assignments()', 'assign_governance_role(uuid,text)',
    'revoke_governance_role(uuid,text)', 'list_governance_users()',
    'create_change_request(text,numeric,text,text,text,text,text,text,text,text,text)',
    'update_draft_change_request(uuid,numeric,text,text,text,text,text,text,text,text,text)',
    'transition_change_request_status(uuid,text,text)', 'delete_draft_change_request(uuid)',
    'apply_approved_change_request(uuid,text)', '_analyze_project_import(jsonb)',
    'check_project_import(jsonb)', 'commit_project_import(uuid,jsonb,jsonb)', 'get_project_import_result(uuid)',
    'set_organization_currency(text,text,boolean)', 'save_organization_profile(text,text,timestamptz)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', v_signature);
  end loop;
  foreach v_signature in array array[
    'active_organization_id()', '_workspace_can_write(uuid)', 'list_my_workspaces()'
  ] loop
    execute format('grant execute on function public.%s to anon, authenticated', v_signature);
  end loop;
  foreach v_signature in array array[
    'create_workspace(text,text,text)', 'current_user_has_governance_role(text)', 'get_my_governance_roles()',
    'list_governance_role_assignments()', 'assign_governance_role(uuid,text)',
    'revoke_governance_role(uuid,text)', 'list_governance_users()',
    'create_change_request(text,numeric,text,text,text,text,text,text,text,text,text)',
    'update_draft_change_request(uuid,numeric,text,text,text,text,text,text,text,text,text)',
    'transition_change_request_status(uuid,text,text)', 'delete_draft_change_request(uuid)',
    'apply_approved_change_request(uuid,text)', 'check_project_import(jsonb)',
    'commit_project_import(uuid,jsonb,jsonb)', 'get_project_import_result(uuid)',
    'set_organization_currency(text,text,boolean)', 'save_organization_profile(text,text,timestamptz)'
  ] loop
    execute format('grant execute on function public.%s to authenticated', v_signature);
  end loop;
end;
$$;

comment on column public.organizations.organization_currency is
  'Explicit workspace currency; no universal default, FX conversion or numeric history rewrite.';
comment on function public.list_my_workspaces() is
  'Header-free JSON array: Demo for anon; memberships plus Demo for authenticated.';
comment on view public.organization_settings is
  'Read-only header-scoped compatibility projection. Organizations is authoritative.';

do $$
declare v_before record; v_table text; v_count bigint; v_fingerprint text;
  v_last bigint; v_called boolean; v_definition jsonb;
begin
  select count(*), encode(sha256(convert_to(coalesce(string_agg((to_jsonb(p) - 'organization_id')::text, '' order by p.project_id), ''), 'UTF8')), 'hex')
    into v_count, v_fingerprint from public.projects p;
  if v_count <> 11 or v_fingerprint is distinct from '8ec06c5d60751b598b089aa9d16ad3d7644f1cb3417149410c6e4af88c9f1758' then
    raise exception 'Known project baseline was not preserved after adding workspace metadata.' using errcode = '23514';
  end if;
  if (select count(*) from public.project_imports) <> 1
    or (select count(*) from public.project_import_rows) <> 1
    or (select count(*) from public.change_requests) <> 2
    or (select count(*) from public.change_request_events) <> 11 then
    raise exception 'Known history counts were not preserved.' using errcode = '23514';
  end if;
  if (select count(*) from public.organizations) <> 1 or not exists (
    select 1 from public.organizations o join public._legacy_organization_settings s
      on s.id = true and o.organization_name = s.organization_name
      and o.organization_currency = s.organization_currency
      and o.industry = s.industry and o.updated_at = s.updated_at
    where o.id = '00000000-0000-4000-8000-000000000001' and o.is_demo
      and o.organization_name = 'Brisk & Zip' and o.organization_currency = 'CAD'
  ) then
    raise exception 'Brisk & Zip/CAD seed differs from the original singleton.' using errcode = '23514';
  end if;
  for v_before in select * from pg_temp.workspace_sequence_snapshot loop
    select to_jsonb(s) into v_definition from pg_catalog.pg_sequence s where s.seqrelid = v_before.sequence_oid;
    if v_definition is distinct from v_before.definition
      or v_before.sequence_oid::regclass::text is distinct from v_before.sequence_name then
      raise exception 'Original sequence definition/identity changed: %.', v_before.sequence_name using errcode = '23514';
    end if;
    execute format('select last_value, is_called from %s', v_before.sequence_oid::regclass) into v_last, v_called;
    if v_last is distinct from v_before.last_value or v_called is distinct from v_before.is_called then
      raise exception 'Original sequence state advanced/changed: %.', v_before.sequence_name using errcode = '23514';
    end if;
  end loop;
  for v_before in select * from pg_temp.workspace_preservation_snapshot loop
    v_table := case v_before.table_name when 'organization_settings' then '_legacy_organization_settings' else v_before.table_name end;
    execute format($query$
      select count(*), encode(sha256(convert_to(coalesce(string_agg(row_hash, '' order by row_hash), ''), 'UTF8')), 'hex')
      from (select encode(sha256(convert_to((to_jsonb(t) - 'organization_id')::text, 'UTF8')), 'hex') as row_hash
        from public.%I t) rows
    $query$, v_table) into v_count, v_fingerprint;
    if v_count is distinct from v_before.row_count or v_fingerprint is distinct from v_before.fingerprint then
      raise exception 'Workspace migration altered original rows in %.', v_before.table_name using errcode = '23514';
    end if;
  end loop;
  if exists (select 1 from pg_temp.workspace_trigger_state s
    left join pg_catalog.pg_trigger t on t.tgrelid = s.tgrelid and t.tgname = s.tgname
    where t.oid is null or t.tgenabled is distinct from s.tgenabled) then
    raise exception 'Workspace migration did not restore original trigger modes.' using errcode = '23514';
  end if;
end;
$$;
commit;
