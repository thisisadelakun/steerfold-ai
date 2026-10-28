-- RUN THIS ENTIRE FILE in one Supabase SQL Editor execution, not selected excerpts.
-- Confirm the intended project first. Requires the SQL Editor owner role.
-- LOCAL VALIDATION ONLY: the reviewed migrations themselves remain unchanged.
-- No write RPC is invoked, no project IDs are generated, no sequence is advanced.
-- Short-lived SHARE locks prevent concurrent writes from invalidating snapshots.
-- If execution errors, run ROLLBACK; before doing anything else in that session.
begin;
set local time zone 'UTC';
set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.organization_settings') is not null
    or to_regclass('public.user_profiles') is not null then
    raise exception 'STOP: Settings/profile tables already exist. This dry-run expects the pre-rollout environment.';
  end if;
  if to_regprocedure('public.current_user_has_governance_role(text)') is null then
    raise exception 'STOP: Governance role prerequisite is missing.';
  end if;
end;
$$;

lock table public.projects, public.project_imports, public.project_import_rows,
  public.change_requests, public.change_request_events in share mode;

create temporary table account_settings_dry_run_baseline on commit drop as
select 'projects'::text as relation_name, count(*) as row_count,
  encode(sha256(convert_to(coalesce(string_agg(to_jsonb(p)::text, '' order by p.project_id), ''), 'UTF8')), 'hex') as fingerprint
from public.projects p
union all
select 'project_imports', count(*), encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text, '' order by to_jsonb(t)::text), ''), 'UTF8')), 'hex') from public.project_imports t
union all
select 'project_import_rows', count(*), encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text, '' order by to_jsonb(t)::text), ''), 'UTF8')), 'hex') from public.project_import_rows t
union all
select 'change_requests', count(*), encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text, '' order by to_jsonb(t)::text), ''), 'UTF8')), 'hex') from public.change_requests t
union all
select 'change_request_events', count(*), encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text, '' order by to_jsonb(t)::text), ''), 'UTF8')), 'hex') from public.change_request_events t;

-- Retain this result grid for comparison with AFTER_ROLLBACK below.
select 'BEFORE' as checkpoint, * from pg_temp.account_settings_dry_run_baseline order by relation_name;

create temporary table account_settings_dry_run_policies on commit drop as
select to_jsonb(p) as policy_definition from pg_catalog.pg_policies p
where schemaname = 'public' and tablename in ('projects', 'project_imports', 'project_import_rows');

create temporary table account_settings_dry_run_result_rpc on commit drop as
select pg_get_functiondef('public.get_project_import_result(uuid)'::regprocedure) as function_definition;

do $$
declare item record;
begin
  for item in select * from pg_temp.account_settings_dry_run_baseline order by relation_name loop
    raise notice 'BEFORE %: count=%, fingerprint=%', item.relation_name, item.row_count, item.fingerprint;
  end loop;
  if not exists (select 1 from pg_temp.account_settings_dry_run_baseline
    where relation_name = 'projects' and row_count = 11
      and fingerprint = '8ec06c5d60751b598b089aa9d16ad3d7644f1cb3417149410c6e4af88c9f1758') then
    raise exception 'STOP: Project baseline differs from the reviewed preflight. No migration should be run.';
  end if;
end;
$$;

-- BEGIN COPIED MIGRATION: supabase/migrations/20261026_organization_currency.sql
-- Phase 18. LOCAL REVIEW ONLY. Do not apply without approval and rollback dry-run.
-- Currency context only: no project numbers, governance records or history change.
-- Single organization, no tenant IDs. Existing CAD history/replays remain immutable.
-- Brisk & Zip selects CAD. Other deployments must choose their own currency;
-- the currency column deliberately has no universal product default.
-- Settings confirmation requires governance_admin, not a workflow wildcard.
-- A confirmed currency change reinterprets existing numeric amounts. It does not
-- perform FX conversion or rewrite project, governance or import-history values.
-- Lock order for NEW imports: actor/key -> settings row SHARE -> projects write
-- exclusion. Settings UPDATE waits for imports; conflict recheck/atomicity remain.
-- Benchmark the unchanged 5,000-row project lock window in staging before release.

create table public.organization_settings (
  id boolean primary key default true check (id = true),
  organization_currency text not null
    check (organization_currency in ('USD', 'CAD', 'GBP', 'EUR')),
  updated_at timestamptz not null default now()
);
insert into public.organization_settings (id, organization_currency) values (true, 'CAD');
alter table public.organization_settings enable row level security;
revoke all on public.organization_settings from public, anon, authenticated;
grant select on public.organization_settings to anon, authenticated;
create policy "Public organization currency read"
on public.organization_settings for select to anon, authenticated using (true);

-- The singleton cannot be removed via DELETE/TRUNCATE, including owner mistakes.
create function public._protect_organization_settings()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if TG_OP <> 'UPDATE' then
    raise exception 'The organization settings singleton cannot be removed.' using errcode = '23514';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
create trigger organization_settings_update
before update on public.organization_settings for each row
execute function public._protect_organization_settings();
create trigger organization_settings_no_delete
before delete on public.organization_settings for each row
execute function public._protect_organization_settings();
create trigger organization_settings_no_truncate
before truncate on public.organization_settings for each statement
execute function public._protect_organization_settings();

create function public.set_organization_currency(
  p_currency text, p_expected_currency text, p_confirm boolean
)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '5s'
as $$
declare
  v_settings public.organization_settings%rowtype;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated'
    or not public.current_user_has_governance_role('governance_admin') then
    raise exception 'Governance Admin access is required to change organization currency.' using errcode = '42501';
  end if;
  if p_currency is null or p_currency <> all(array['USD', 'CAD', 'GBP', 'EUR'])
    or p_expected_currency is null or p_expected_currency <> all(array['USD', 'CAD', 'GBP', 'EUR']) then
    raise exception 'Unsupported organization currency.' using errcode = '22023';
  end if;
  select * into v_settings from public.organization_settings where id = true for update;
  if not found then
    raise exception 'Organization settings are unavailable.' using errcode = '23514';
  end if;
  if v_settings.organization_currency is distinct from p_expected_currency then
    raise exception 'Organization currency changed elsewhere. Reload Settings.' using errcode = '23505';
  end if;
  if v_settings.organization_currency <> p_currency then
    if p_confirm is distinct from true then
      raise exception 'Explicit currency-context confirmation is required.' using errcode = '22023';
    end if;
    update public.organization_settings set organization_currency = p_currency
    where id = true returning * into v_settings;
  end if;
  return to_jsonb(v_settings);
end;
$$;

-- Expand the historical allowlist without rewriting any stored import/result.
alter table public.project_imports drop constraint project_imports_currency_code_check;
alter table public.project_imports add constraint project_imports_currency_code_check
  check (currency_code in ('USD', 'CAD', 'GBP', 'EUR'));

-- Canonicalization permits supported historical currencies so identical replay
-- hashes remain valid. Public RPCs separately require current authority for NEW work.


create or replace function public._prepare_project_import(p_payload jsonb)
returns jsonb language plpgsql stable set search_path = ''
as $$
declare
  v_entry jsonb;
  v_data jsonb;
  v_normalized jsonb;
  v_project public.projects%rowtype;
  v_field text;
  v_text text;
  v_row integer;
  v_source_id text;
  v_namespace text;
  v_seen_rows integer[] := '{}';
  v_errors text[];
  v_rows jsonb[] := '{}';
  v_canonical jsonb;
  v_fields constant text[] := array[
    'project_name', 'project_manager', 'project_type', 'strategic_priority',
    'budget_bac', 'planned_value_pv', 'earned_value_ev', 'actual_cost_ac',
    'percent_complete', 'risk_score', 'start_date', 'end_date',
    'resource_demand', 'project_status'
  ];
begin
  if jsonb_typeof(p_payload) is distinct from 'object'
    or pg_catalog.octet_length(p_payload::text) > 5242880 then
    raise exception 'Import payload must be an object no larger than 5 MiB.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_payload) as key(value)
    where value <> all(array['contract_version', 'file_name', 'worksheet_name', 'source_namespace', 'currency_code', 'rows'])) then
    raise exception 'Import payload contains unsupported fields.' using errcode = '22023';
  end if;
  if p_payload->'contract_version' is distinct from '1'::jsonb
    or jsonb_typeof(p_payload->'currency_code') is distinct from 'string'
    or coalesce(p_payload->>'currency_code', '') <> all(array['USD', 'CAD', 'GBP', 'EUR']) then
    raise exception 'Import contract version 1 and a supported currency are required.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload->'file_name') is distinct from 'string'
    or length(btrim(p_payload->>'file_name')) not between 1 and 255
    or (p_payload->>'file_name') !~ '[^[:space:]]' then
    raise exception 'A filename is required.' using errcode = '22023';
  end if;
  if p_payload ? 'source_namespace' and p_payload->'source_namespace' <> 'null'::jsonb then
    if jsonb_typeof(p_payload->'source_namespace') is distinct from 'string' then
      raise exception 'Source namespace must be null or text.' using errcode = '22023';
    end if;
    v_namespace := nullif(lower(pg_catalog.regexp_replace(
      p_payload->>'source_namespace', '^[[:space:]]+|[[:space:]]+$', '', 'g'
    )), '');
    if length(v_namespace) > 128 then
      raise exception 'Source namespace must be at most 128 characters.' using errcode = '22023';
    end if;
  end if;
  if p_payload ? 'worksheet_name' and p_payload->'worksheet_name' <> 'null'::jsonb then
    if jsonb_typeof(p_payload->'worksheet_name') is distinct from 'string'
      or length(btrim(p_payload->>'worksheet_name')) not between 1 and 128
      or (p_payload->>'worksheet_name') !~ '[^[:space:]]' then
      raise exception 'Worksheet name must be null or non-empty text of at most 128 characters.' using errcode = '22023';
    end if;
  end if;
  if jsonb_typeof(p_payload->'rows') is distinct from 'array' then
    raise exception 'Import rows must be an array.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_payload->'rows') not between 1 and 5000 then
    raise exception 'Submit between 1 and 5,000 rows per import.' using errcode = '22023';
  end if;

  for v_entry in select value from jsonb_array_elements(p_payload->'rows') loop
    if jsonb_typeof(v_entry) is distinct from 'object' then
      raise exception 'Each import row must be an object.' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_object_keys(v_entry) as key(value)
      where value <> all(array['source_row', 'source_project_id', 'project'])) then
      raise exception 'Import row contains unsupported fields.' using errcode = '22023';
    end if;
    if jsonb_typeof(v_entry->'source_row') is distinct from 'number' then
      raise exception 'Every source row must have a positive integer row number.' using errcode = '22023';
    end if;
    if (v_entry->>'source_row')::numeric < 1
      or (v_entry->>'source_row')::numeric > 2147483647
      or trunc((v_entry->>'source_row')::numeric) <> (v_entry->>'source_row')::numeric then
      raise exception 'Source row number is outside the supported integer range.' using errcode = '22023';
    end if;
    v_row := (v_entry->>'source_row')::integer;
    if v_row = any(v_seen_rows) then
      raise exception 'Duplicate source row number: %.', v_row using errcode = '23514';
    end if;
    v_seen_rows := array_append(v_seen_rows, v_row);
    v_source_id := null;
    if v_entry ? 'source_project_id' and v_entry->'source_project_id' <> 'null'::jsonb then
      if jsonb_typeof(v_entry->'source_project_id') is distinct from 'string'
        or length(btrim(v_entry->>'source_project_id')) not between 1 and 255
        or (v_entry->>'source_project_id') !~ '[^[:space:]]' then
        raise exception 'Source Project ID at row % must be null or non-empty text of at most 255 characters.', v_row using errcode = '22023';
      end if;
      v_source_id := btrim(v_entry->>'source_project_id');
    end if;
    v_data := v_entry->'project';
    v_normalized := v_data;
    v_errors := '{}';
    if jsonb_typeof(v_data) is distinct from 'object' then
      v_errors := array_append(v_errors, 'Project must be an object.');
    else
      if exists (select 1 from jsonb_object_keys(v_data) as key(value) where value <> all(v_fields)) then
        v_errors := array_append(v_errors, 'Unsupported project fields: live IDs, audit fields and derived metrics are not accepted.');
      end if;
      foreach v_field in array array['project_name', 'project_manager', 'project_type', 'strategic_priority', 'resource_demand', 'project_status'] loop
        v_text := pg_catalog.regexp_replace(v_data->>v_field, '^[[:space:]]+|[[:space:]]+$', '', 'g');
        if jsonb_typeof(v_data->v_field) is distinct from 'string'
          or length(v_text) not between 1 and 1000 then
          v_errors := array_append(v_errors, v_field || ' must be non-empty text of at most 1,000 characters.');
        else
          v_data := jsonb_set(v_data, array[v_field], to_jsonb(v_text));
        end if;
      end loop;
      foreach v_field in array array['budget_bac', 'planned_value_pv', 'earned_value_ev', 'actual_cost_ac', 'percent_complete', 'risk_score'] loop
        if jsonb_typeof(v_data->v_field) is distinct from 'number' then
          v_errors := array_append(v_errors, v_field || ' must be a finite JSON number.');
        elsif (v_data->>v_field)::numeric < 0 then
          v_errors := array_append(v_errors, v_field || ' must be non-negative.');
        elsif (v_field = 'percent_complete' and (v_data->>v_field)::numeric > 1)
          or (v_field = 'risk_score' and (v_data->>v_field)::numeric > 25) then
          v_errors := array_append(v_errors, v_field || ' is outside its permitted range.');
        end if;
      end loop;
      if coalesce(v_data->>'strategic_priority', '') <> all(array['High', 'Medium', 'Low'])
        or coalesce(v_data->>'resource_demand', '') <> all(array['High', 'Medium', 'Low'])
        or coalesce(v_data->>'project_status', '') <> all(array['On Track', 'At Risk', 'Critical']) then
        v_errors := array_append(v_errors, 'Unsupported priority, resource demand or status.');
      end if;
      foreach v_field in array array['start_date', 'end_date'] loop
        if jsonb_typeof(v_data->v_field) is distinct from 'string'
          or (v_data->>v_field) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
          v_errors := array_append(v_errors, v_field || ' must be an ISO YYYY-MM-DD date.');
        end if;
      end loop;
      if cardinality(v_errors) = 0 then
        begin
          select * into v_project from jsonb_populate_record(null::public.projects, v_data);
          select jsonb_object_agg(key, value) into v_normalized
          from jsonb_each(to_jsonb(v_project)) where key = any(v_fields);
          if v_project.end_date < v_project.start_date then
            v_errors := array_append(v_errors, 'End Date must be on or after Start Date.');
          end if;
          foreach v_field in array v_fields loop
            if v_normalized->v_field is distinct from v_data->v_field then
              v_errors := array_append(v_errors, v_field || ' cannot be represented exactly by the projects column type.');
            end if;
          end loop;
        exception when data_exception then
          v_errors := array_append(v_errors, 'A value exceeds its database type/precision or contains an invalid calendar date.');
        end;
      end if;
    end if;
    v_rows := array_append(v_rows, jsonb_build_object(
      'source_row', v_row, 'source_project_id', v_source_id,
      'project', v_normalized, 'errors', to_jsonb(v_errors)
    ));
  end loop;
  -- Canonical source-row order makes client array reordering immaterial.
  select jsonb_agg(value order by (value->>'source_row')::integer) into v_canonical
  from jsonb_array_elements(to_jsonb(v_rows));
  return jsonb_build_object(
    'contract_version', 1, 'currency_code', p_payload->>'currency_code',
    'file_name', btrim(p_payload->>'file_name'),
    'worksheet_name', nullif(btrim(p_payload->>'worksheet_name'), ''),
    'source_namespace', v_namespace, 'rows', v_canonical
  );
end;
$$;

create or replace function public.check_project_import(p_payload jsonb)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_prepared jsonb;
  v_currency text;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' then
    raise exception 'Authentication is required to import projects.' using errcode = '42501';
  end if;
  v_prepared := public._prepare_project_import(p_payload);
  select organization_currency into v_currency from public.organization_settings where id = true;
  if v_currency is null or v_prepared->>'currency_code' is distinct from v_currency then
    raise exception 'Import currency must match the current organization currency. Review again.' using errcode = '23514';
  end if;
  return public._analyze_project_import(v_prepared);
end;
$$;



-- CREATE OR REPLACE retains existing ACLs; explicitly restate the safe boundary.
create or replace function public.commit_project_import(
  p_idempotency_key uuid,
  p_payload jsonb,
  p_acknowledgements jsonb default '[]'::jsonb
)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '5s'
as $$
declare
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
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text || ':' || p_idempotency_key::text, 0));
  select * into v_prior from public.project_imports
  where imported_by = v_actor and idempotency_key = p_idempotency_key;
  if found then
    if v_prior.payload_hash <> v_hash or v_prior.acknowledgements <> v_acknowledgements then
      raise exception 'Import key was already committed with a different payload or acknowledgement set.' using errcode = '23505';
    end if;
    return v_prior.result || jsonb_build_object('replayed', true);
  end if;

  -- An advisory import lock alone cannot exclude normal REST creates/updates.
  -- This lock also excludes ordinary project writers until this transaction ends.
  -- Reads stay available. All import commits acquire locks in this same order.
  -- Lock current currency through the whole NEW batch. Historical replays above
  -- keep their recorded currency and do not acquire the project-table lock.
  select organization_currency into v_currency from public.organization_settings
  where id = true for share;
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
    'contract_version', 1, 'status', 'committed', 'replayed', false,
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

revoke all on function public._protect_organization_settings() from public, anon, authenticated;
revoke all on function public.set_organization_currency(text, text, boolean) from public, anon, authenticated;
grant execute on function public.set_organization_currency(text, text, boolean) to authenticated;
revoke all on function public._prepare_project_import(jsonb) from public, anon, authenticated;
revoke all on function public.check_project_import(jsonb) from public, anon, authenticated;
revoke all on function public.commit_project_import(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.check_project_import(jsonb) to authenticated;
grant execute on function public.commit_project_import(uuid, jsonb, jsonb) to authenticated;
-- get_project_import_result and own-history policies stay unchanged.


-- END COPIED MIGRATION: supabase/migrations/20261026_organization_currency.sql

-- BEGIN COPIED MIGRATION: supabase/migrations/20261027_company_user_profiles.sql
-- LOCAL REVIEW ONLY. Requires 20261026_organization_currency.sql first.
-- Later unique version ensures this dependency sorts first in migration tooling.
-- Do not apply without approval and a rollback dry-run against staging.
-- Company identity is public portfolio context; personal profiles are private.

alter table public.organization_settings
  add column organization_name text not null default 'Brisk & Zip'
    check (organization_name = btrim(organization_name) and char_length(organization_name) between 1 and 120),
  add column industry text not null default ''
    check (industry = btrim(industry) and char_length(industry) <= 120);
-- The deployment seed is not a universal organization-name default.
alter table public.organization_settings alter column organization_name drop default;

create table public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (full_name = btrim(full_name) and char_length(full_name) between 1 and 120),
  job_title text not null default '' check (job_title = btrim(job_title) and char_length(job_title) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.user_profiles enable row level security;
revoke all on public.user_profiles from public, anon, authenticated;
grant select on public.user_profiles to authenticated;
create policy "Read own personal profile" on public.user_profiles
  for select to authenticated using (user_id = (select auth.uid()));

create function public.get_my_profile()
returns jsonb language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s'
as $$
declare
  v_profile public.user_profiles%rowtype;
  v_signup_name jsonb;
  v_full_name text;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  select * into v_profile from public.user_profiles where user_id = auth.uid();
  if found then return to_jsonb(v_profile); end if;
  -- Metadata is read from Auth on the server, never from a client session cache.
  -- Share the save RPC's lock so bootstrap cannot overwrite a completed profile.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('steerfold-profile:' || auth.uid()::text, 0));
  select * into v_profile from public.user_profiles where user_id = auth.uid();
  if found then return to_jsonb(v_profile); end if;
  select raw_user_meta_data->'full_name' into v_signup_name from auth.users where id = auth.uid();
  if jsonb_typeof(v_signup_name) = 'string' then
    v_full_name := regexp_replace(v_signup_name #>> '{}', '^[[:space:]]+|[[:space:]]+$', '', 'g');
    if char_length(v_full_name) between 1 and 120 then
      insert into public.user_profiles (user_id, full_name)
        values (auth.uid(), v_full_name) on conflict (user_id) do nothing;
    end if;
  end if;
  select * into v_profile from public.user_profiles where user_id = auth.uid();
  return case when found then to_jsonb(v_profile) else
    jsonb_build_object('user_id', auth.uid(), 'full_name', '', 'job_title', '', 'created_at', null, 'updated_at', null) end;
end;
$$;

create function public.save_my_profile(p_full_name text, p_job_title text, p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '5s'
as $$
declare v_profile public.user_profiles%rowtype;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if p_full_name is null or char_length(btrim(p_full_name)) not between 1 and 120
    or p_job_title is null or char_length(btrim(p_job_title)) > 120 then
    raise exception 'Enter a full name and use at most 120 characters per field.' using errcode = '22023';
  end if;
  -- Serialize first-save races as well as edits without accepting a client user ID.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('steerfold-profile:' || auth.uid()::text, 0));
  select * into v_profile from public.user_profiles where user_id = auth.uid() for update;
  if v_profile.updated_at is distinct from p_expected_updated_at then
    raise exception 'Your profile changed elsewhere. Reload your profile before saving.' using errcode = '23505';
  end if;
  insert into public.user_profiles (user_id, full_name, job_title, updated_at)
    values (auth.uid(), btrim(p_full_name), btrim(p_job_title), clock_timestamp())
    on conflict (user_id) do update set full_name = excluded.full_name,
      job_title = excluded.job_title, updated_at = excluded.updated_at
    returning * into v_profile;
  -- created_at is supplied only by the table default and is never edited here.
  return to_jsonb(v_profile);
end;
$$;

create function public.save_organization_profile(p_name text, p_industry text, p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '5s'
as $$
declare v_settings public.organization_settings%rowtype;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated'
    or not public.current_user_has_governance_role('governance_admin') then
    raise exception 'Governance Admin access is required to change organization details.' using errcode = '42501';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 120
    or p_industry is null or char_length(btrim(p_industry)) > 120 then
    raise exception 'Enter an organization name and use at most 120 characters per field.' using errcode = '22023';
  end if;
  select * into v_settings from public.organization_settings where id = true for update;
  if not found then
    raise exception 'Organization settings are unavailable.' using errcode = '23514';
  end if;
  if v_settings.updated_at is distinct from p_expected_updated_at then
    raise exception 'Organization settings changed elsewhere. Reload before saving.' using errcode = '23505';
  end if;
  update public.organization_settings set organization_name = btrim(p_name), industry = btrim(p_industry)
    where id = true returning * into v_settings;
  return to_jsonb(v_settings);
end;
$$;

revoke all on function public.get_my_profile() from public, anon, authenticated;
revoke all on function public.save_my_profile(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.save_organization_profile(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.get_my_profile() to authenticated;
grant execute on function public.save_my_profile(text, text, timestamptz) to authenticated;
grant execute on function public.save_organization_profile(text, text, timestamptz) to authenticated;


-- END COPIED MIGRATION: supabase/migrations/20261027_company_user_profiles.sql

-- Catalog/definition assertions only: do not invoke profile bootstrap/save,
-- currency mutation, import commit or business-ID generation functions.
do $$
declare
  item record;
  function_row record;
  function_oid oid;
  definition text;
  actual_count bigint;
  actual_fingerprint text;
begin
  if to_regclass('public.organization_settings') is null
    or to_regclass('public.user_profiles') is null then
    raise exception 'Expected settings/profile tables were not created.';
  end if;
  if (select count(*) from public.organization_settings) <> 1
    or not exists (select 1 from public.organization_settings
      where id = true and organization_name = 'Brisk & Zip' and organization_currency = 'CAD') then
    raise exception 'Brisk & Zip singleton/CAD seed is incorrect.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
    and table_name = 'organization_settings' and column_name = 'organization_currency'
    and column_default is null and is_nullable = 'NO') then
    raise exception 'Organization currency must be required with no universal default.';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public'
    and table_name = 'organization_settings' and column_name in ('organization_name', 'industry')
    and data_type = 'text' and is_nullable = 'NO') <> 2 then
    raise exception 'Organization profile columns are missing.';
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.organization_settings'::regclass and contype = 'c' and convalidated
    and pg_get_constraintdef(oid) like '%organization_currency%'
    and pg_get_constraintdef(oid) like '%CAD%' and pg_get_constraintdef(oid) like '%USD%'
    and pg_get_constraintdef(oid) like '%GBP%' and pg_get_constraintdef(oid) like '%EUR%') then
    raise exception 'Supported organization currency constraint is missing.';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public'
    and table_name = 'user_profiles' and column_name in ('created_at', 'updated_at')
    and data_type = 'timestamp with time zone' and is_nullable = 'NO' and column_default = 'now()') <> 2 then
    raise exception 'Profile audit timestamps/defaults are incorrect.';
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.user_profiles'::regclass and contype = 'f'
      and confrelid = 'auth.users'::regclass
      and pg_get_constraintdef(oid) = 'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE') then
    raise exception 'Profile Auth user relationship is incorrect.';
  end if;
  if (select count(*) from pg_catalog.pg_class where oid in
    ('public.organization_settings'::regclass, 'public.user_profiles'::regclass) and relrowsecurity) <> 2 then
    raise exception 'Settings/profile RLS must be enabled.';
  end if;
  if has_table_privilege('anon', 'public.user_profiles', 'SELECT')
    or has_any_column_privilege('anon', 'public.user_profiles', 'SELECT')
    or not has_table_privilege('authenticated', 'public.user_profiles', 'SELECT')
    or has_table_privilege('authenticated', 'public.user_profiles', 'INSERT,UPDATE,DELETE,TRUNCATE')
    or has_any_column_privilege('authenticated', 'public.user_profiles', 'INSERT,UPDATE') then
    raise exception 'Profile grants violate own-read/RPC-only-write security.';
  end if;
  if (select count(*) from pg_catalog.pg_policy where polrelid = 'public.user_profiles'::regclass) <> 1
    or not exists (select 1 from pg_catalog.pg_policy where polrelid = 'public.user_profiles'::regclass
      and polname = 'Read own personal profile' and polcmd = 'r' and polpermissive
      and polroles = array['authenticated'::regrole::oid]
      and pg_get_expr(polqual, polrelid) like '%user_id =%'
      and pg_get_expr(polqual, polrelid) like '%auth.uid()%'
      and polwithcheck is null) then
    raise exception 'Authenticated profile SELECT must be restricted to auth.uid().';
  end if;

  for item in select * from (values
    ('public.get_my_profile()', true),
    ('public.save_my_profile(text,text,timestamp with time zone)', true),
    ('public.save_organization_profile(text,text,timestamp with time zone)', true),
    ('public.set_organization_currency(text,text,boolean)', true),
    ('public.check_project_import(jsonb)', true),
    ('public.commit_project_import(uuid,jsonb,jsonb)', true),
    ('public.get_project_import_result(uuid)', false)
  ) as expected(signature, is_security_definer) loop
    function_oid := to_regprocedure(item.signature);
    if function_oid is null then raise exception 'Missing RPC: %', item.signature; end if;
    select * into strict function_row from pg_catalog.pg_proc where oid = function_oid;
    if function_row.prosecdef is distinct from item.is_security_definer
      or not coalesce('search_path=""' = any(function_row.proconfig), false)
      or not has_function_privilege('authenticated', function_oid, 'EXECUTE')
      or has_function_privilege('anon', function_oid, 'EXECUTE')
      or exists (select 1 from aclexplode(coalesce(function_row.proacl, acldefault('f', function_row.proowner)))
        where grantee = 0 and privilege_type = 'EXECUTE') then
      raise exception 'RPC security/search_path/grants incorrect: %', item.signature;
    end if;
    definition := pg_get_functiondef(function_oid);
    if position('auth.uid()' in definition) = 0 or position('authenticated' in definition) = 0 then
      raise exception 'RPC authentication guard missing: %', item.signature;
    end if;
    if item.signature = 'public.get_project_import_result(uuid)' then
      -- Own-history reads deliberately use invoker RLS, not elevated privileges.
      definition := regexp_replace(lower(function_row.prosrc), '[[:space:]]+', ' ', 'g');
      if function_row.provolatile <> 's'
        or position('if auth.uid() is null or auth.role() is distinct from ''authenticated'' then' in definition) = 0
        or position('42501' in definition) = 0
        or position('if p_idempotency_key is null then' in definition) = 0
        or position('22023' in definition) = 0
        or position('from public.project_imports where imported_by = auth.uid() and idempotency_key = p_idempotency_key' in definition) = 0 then
        raise exception 'Import result invoker stability/authentication/own-history guards are incorrect.';
      end if;
      if pg_get_functiondef(function_oid) is distinct from
        (select function_definition from pg_temp.account_settings_dry_run_result_rpc) then
        raise exception 'Existing import result function definition changed during the dry-run.';
      end if;
    end if;
  end loop;

  foreach definition in array array[
    pg_get_functiondef('public.set_organization_currency(text,text,boolean)'::regprocedure),
    pg_get_functiondef('public.save_organization_profile(text,text,timestamp with time zone)'::regprocedure)
  ] loop
    if position('current_user_has_governance_role(''governance_admin'')' in definition) = 0
      or position('42501' in definition) = 0 then
      raise exception 'Governance Admin authorization must remain enforced.';
    end if;
  end loop;
  definition := pg_get_functiondef('public.set_organization_currency(text,text,boolean)'::regprocedure);
  if position('p_expected_currency' in definition) = 0 or position('p_confirm is distinct from true' in definition) = 0
    or position('for update' in lower(definition)) = 0 then
    raise exception 'Currency concurrency/confirmation guard is missing.';
  end if;
  definition := pg_get_functiondef('public.save_my_profile(text,text,timestamp with time zone)'::regprocedure);
  if position('values (auth.uid()' in definition) = 0
    or position('created_at =' in definition) > 0 then
    raise exception 'Profile ownership or immutable creation timestamp contract changed.';
  end if;
  for item in select * from (values
    ('public.check_project_import(jsonb)'), ('public.commit_project_import(uuid,jsonb,jsonb)')
  ) as expected(signature) loop
    definition := pg_get_functiondef(to_regprocedure(item.signature));
    if position('from public.organization_settings' in definition) = 0
      or position('v_prepared->>''currency_code'' is distinct from v_currency' in definition) = 0 then
      raise exception 'New imports must use authoritative organization currency: %', item.signature;
    end if;
  end loop;
  definition := pg_get_functiondef('public.commit_project_import(uuid,jsonb,jsonb)'::regprocedure);
  if position('return v_prior.result' in definition) = 0
    or position('return v_prior.result' in definition) >= position('select organization_currency' in definition)
    or position('for share' in lower(definition)) = 0
    or position('lock table public.projects in share row exclusive mode' in lower(definition)) = 0 then
    raise exception 'Historical replay or new-import currency/project locking changed.';
  end if;
  if exists ((select policy_definition from pg_temp.account_settings_dry_run_policies)
    except (select to_jsonb(p) from pg_catalog.pg_policies p where schemaname = 'public'
      and tablename in ('projects', 'project_imports', 'project_import_rows')))
    or exists ((select to_jsonb(p) from pg_catalog.pg_policies p where schemaname = 'public'
      and tablename in ('projects', 'project_imports', 'project_import_rows'))
      except (select policy_definition from pg_temp.account_settings_dry_run_policies)) then
    raise exception 'Existing project/import RLS policies changed.';
  end if;
  for item in select * from pg_temp.account_settings_dry_run_baseline loop
    execute format('select count(*), encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text, '''' order by %s), ''''), ''UTF8'')), ''hex'') from public.%I t',
      case when item.relation_name = 'projects' then 't.project_id' else 'to_jsonb(t)::text' end, item.relation_name)
      into actual_count, actual_fingerprint;
    if actual_count is distinct from item.row_count or actual_fingerprint is distinct from item.fingerprint then
      raise exception 'Existing rows changed in %.', item.relation_name;
    end if;
  end loop;
  if (select count(*) from public.user_profiles) <> 0 then
    raise exception 'Dry-run must not create personal profiles.';
  end if;
  raise notice 'PASS: In-transaction assertions passed. No project/history/profile mutation RPC was invoked. Rolling back all migration DDL and the singleton seed.';
end;
$$;

select 'IN_TRANSACTION' as checkpoint, organization_name, organization_currency, industry
from public.organization_settings;

rollback;

-- Session-only time zone for reproducible fingerprints after transaction rollback.
-- No database row, schema or role setting is persisted by this SELECT.
select pg_catalog.set_config('TimeZone', 'UTC', false) as fingerprint_time_zone;

-- Read-only assertions AFTER rollback. Tables were required absent before BEGIN's DDL.
do $$
declare total bigint; fingerprint text;
begin
  if to_regclass('public.organization_settings') is not null
    or to_regclass('public.user_profiles') is not null then
    raise exception 'ROLLBACK VERIFICATION FAILED: New tables still exist.';
  end if;
  select count(*), encode(sha256(convert_to(coalesce(string_agg(to_jsonb(p)::text, '' order by p.project_id), ''), 'UTF8')), 'hex')
    into total, fingerprint from public.projects p;
  if total <> 11 or fingerprint <> '8ec06c5d60751b598b089aa9d16ad3d7644f1cb3417149410c6e4af88c9f1758' then
    raise exception 'Post-rollback project baseline differs. Investigate concurrent writes/environment before rollout.';
  end if;
  raise notice 'PASS: New tables are absent; project count and fingerprint match the approved baseline.';
end;
$$;

select 'AFTER_ROLLBACK' as checkpoint,
  to_regclass('public.organization_settings') is null as organization_settings_absent,
  to_regclass('public.user_profiles') is null as user_profiles_absent;

-- Compare every count AND fingerprint to the BEFORE grid. Baseline temp tables
-- deliberately do not survive rollback; no permanent comparison artifact is made.
select 'AFTER_ROLLBACK' as checkpoint, 'projects'::text as relation_name, count(*) as row_count,
  encode(sha256(convert_to(coalesce(string_agg(to_jsonb(p)::text, '' order by p.project_id), ''), 'UTF8')), 'hex') as fingerprint from public.projects p
union all
select 'AFTER_ROLLBACK', 'project_imports', count(*), encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text, '' order by to_jsonb(t)::text), ''), 'UTF8')), 'hex') from public.project_imports t
union all
select 'AFTER_ROLLBACK', 'project_import_rows', count(*), encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text, '' order by to_jsonb(t)::text), ''), 'UTF8')), 'hex') from public.project_import_rows t
union all
select 'AFTER_ROLLBACK', 'change_requests', count(*), encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text, '' order by to_jsonb(t)::text), ''), 'UTF8')), 'hex') from public.change_requests t
union all
select 'AFTER_ROLLBACK', 'change_request_events', count(*), encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text, '' order by to_jsonb(t)::text), ''), 'UTF8')), 'hex') from public.change_request_events t
order by relation_name;
