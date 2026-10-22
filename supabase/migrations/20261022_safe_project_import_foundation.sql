-- Phase 16E1. LOCAL REVIEW ONLY: do not apply without explicit approval.
-- Requires the verified public.projects schema/defaults and authenticated INSERT.
-- No project policies, defaults, generators, constraints or existing rows change.
--
-- RPC payload v1 (all amounts are CAD; display currency is never accepted):
-- {
--   "contract_version": 1, "file_name": "projects.xlsx",
--   "worksheet_name": "Projects", "source_namespace": "source-system-name",
--   "currency_code": "CAD", "rows": [
--     {"source_row": 2, "source_project_id": "EXTERNAL-1", "project": {
--       "project_name": "Example", "project_manager": "Manager",
--       "project_type": "IT", "strategic_priority": "Medium",
--       "budget_bac": 100, "planned_value_pv": 50, "earned_value_ev": 40,
--       "actual_cost_ac": 60, "percent_complete": 0.4, "risk_score": 10,
--       "start_date": "2026-01-01", "end_date": "2026-12-31",
--       "resource_demand": "Medium", "project_status": "On Track"
--     }}
--   ]
-- }
-- source_project_id, worksheet_name and source_namespace may be omitted/null.
-- Nonblank namespaces are trimmed/lowercased; blank namespaces become null.
-- Without a namespace, source IDs are provenance only, not cross-import identity.
-- Source IDs are trimmed and case-sensitive; duplicates within a batch block.
-- All 14 project fields are required. No live IDs, derived metrics or audit fields.
--
-- check_project_import(payload) is read-only and returns a server payload hash,
-- blocking_conflicts and warnings with conflict_id acknowledgement tokens.
-- commit_project_import(key, payload, acknowledgements) accepts an array of ALL
-- current warning conflict_ids, not a blanket override. It rechecks under lock.
-- A committed actor/key can only replay the same canonical payload AND acknowledgements.
-- get_project_import_result(key) reconciles a lost response for the current actor.
-- not_found does NOT prove failure while a commit is still in flight: retry only
-- with the SAME key/payload. Never generate a new key to recover an unknown outcome.
--
-- Only successful, whole-batch imports are recorded. No partial success, upsert,
-- baseline change, governance event or failed-attempt history is manufactured.
-- The selected batch is the submitted set: skipped/failed counts are zero on success.
-- Cross-source natural-name matches are warnings, never project uniqueness rules.
-- Source IDs cannot be reused within a namespace, even if a project is later deleted.
--
-- REVIEW: CAD is explicitly pinned for this single-organization deployment. This
-- does not introduce a general organization/tenant/currency authority or FX layer.
-- Benchmark 5,000 rows and the lock window in staging. Verify the business-ID
-- generator preserves full sequence digits beyond P999 and never truncates them.
begin;

create table public.project_imports (
  id uuid primary key default gen_random_uuid(),
  imported_by uuid not null references auth.users(id),
  idempotency_key uuid not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  contract_version integer not null default 1 check (contract_version = 1),
  source_namespace text check (
    length(source_namespace) between 1 and 128
    and source_namespace = lower(btrim(source_namespace))
  ),
  file_name text not null check (length(btrim(file_name)) between 1 and 255),
  worksheet_name text check (length(worksheet_name) between 1 and 128),
  currency_code text not null check (currency_code = 'CAD'),
  status text not null default 'committed' check (status = 'committed'),
  rows_submitted integer not null check (rows_submitted between 1 and 5000),
  rows_imported integer not null check (rows_imported = rows_submitted),
  rows_skipped integer not null default 0 check (rows_skipped = 0),
  rows_failed integer not null default 0 check (rows_failed = 0),
  acknowledgements jsonb not null check (jsonb_typeof(acknowledgements) = 'array'),
  committed_at timestamptz not null default now(),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  constraint project_imports_actor_key_unique unique (imported_by, idempotency_key)
);

create table public.project_import_rows (
  import_id uuid not null references public.project_imports(id),
  source_row integer not null check (source_row > 0),
  source_namespace text check (
    length(source_namespace) between 1 and 128
    and source_namespace = lower(btrim(source_namespace))
  ),
  source_project_id text check (length(source_project_id) between 1 and 255),
  -- Deletion preserves the immutable code and name snapshot, not a broken FK.
  project_uuid uuid references public.projects(id) on delete set null,
  project_code text not null,
  project_name_snapshot text not null,
  created_at timestamptz not null default now(),
  primary key (import_id, source_row)
);

create index project_imports_actor_time_idx
  on public.project_imports (imported_by, committed_at desc, id);
create index project_import_rows_project_idx on public.project_import_rows (project_uuid);
create unique index project_import_rows_source_unique
  on public.project_import_rows (source_namespace, source_project_id)
  where source_namespace is not null and source_project_id is not null;

alter table public.project_imports enable row level security;
alter table public.project_import_rows enable row level security;
revoke all on public.project_imports, public.project_import_rows from public, anon, authenticated;
grant select on public.project_imports, public.project_import_rows to authenticated;

create policy "Actors can read their own import history"
on public.project_imports for select to authenticated
using (imported_by = (select auth.uid()));

create policy "Actors can read their own import rows"
on public.project_import_rows for select to authenticated
using (exists (
  select 1 from public.project_imports as batch
  where batch.id = import_id and batch.imported_by = (select auth.uid())
));

comment on table public.project_imports is
  'Successful atomic project imports; actor-bound idempotency and server-owned results. RPC writes only.';
comment on table public.project_import_rows is
  'Source provenance mapped to generated project identities. Never a source of live project IDs.';

-- Pure internal helpers have no browser EXECUTE grants. SHA-256 is a pg_catalog
-- builtin, so the migration does not depend on where pgcrypto was installed.
create function public._project_import_hash(p_value jsonb)
returns text language sql immutable strict set search_path = ''
as $$ select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_value::text, 'UTF8')), 'hex'); $$;

create function public._project_import_match_key(p_value text)
returns text language sql immutable strict set search_path = ''
as $$ select lower(btrim(pg_catalog.regexp_replace(p_value, '[[:space:]]+', ' ', 'g'))); $$;

create index projects_import_match_name_idx
  on public.projects (public._project_import_match_key(project_name::text));

-- One canonicalization/validation implementation is shared by both public RPCs.
-- jsonb_populate_record checks the ACTUAL projects column types/typmods. The
-- round-trip comparisons reject implicit rounding or truncation of input values.
create function public._prepare_project_import(p_payload jsonb)
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
    or p_payload->'currency_code' is distinct from '"CAD"'::jsonb then
    raise exception 'Import contract version 1 and organization currency CAD are required.' using errcode = '22023';
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
    'contract_version', 1, 'currency_code', 'CAD',
    'file_name', btrim(p_payload->>'file_name'),
    'worksheet_name', nullif(btrim(p_payload->>'worksheet_name'), ''),
    'source_namespace', v_namespace, 'rows', v_canonical
  );
end;
$$;

create function public._analyze_project_import(p_prepared jsonb)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
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
      on public._project_import_match_key(project.project_name::text) = input.name_key
    union all
    select jsonb_build_object('code', 'source_id_matches_live_code', 'source_row', input.source_row,
      'existing_project_uuid', project.id, 'existing_project_id', project.project_id)
    from input join public.projects as project on project.project_id = input.source_id
    union all
    select jsonb_build_object('code', 'name_repeated_in_upload', 'name_key', name_key,
      'source_rows', jsonb_agg(source_row order by source_row))
    from input group by name_key having count(*) > 1
  ), bounded as (
    -- Reject excessive conflicts rather than emitting an incomplete warning set.
    select item from conflicts limit 10001
  ) select coalesce(jsonb_agg(item || jsonb_build_object('conflict_id',
      public._project_import_hash(jsonb_build_object('payload_hash', v_hash, 'conflict', item))) order by item::text), '[]'::jsonb)
    into v_warnings from bounded;
  if jsonb_array_length(v_warnings) > 10000 then
    raise exception 'Too many duplicate warnings; submit a smaller batch for review.' using errcode = '54000';
  end if;
  return jsonb_build_object(
    'contract_version', 1, 'payload_hash', v_hash,
    'rows_submitted', jsonb_array_length(p_prepared->'rows'),
    'blocking_count', jsonb_array_length(v_blocking), 'warning_count', jsonb_array_length(v_warnings),
    'ready_for_confirmation', jsonb_array_length(v_blocking) = 0,
    'requires_acknowledgement', jsonb_array_length(v_warnings) > 0,
    'blocking_conflicts', v_blocking, 'warnings', v_warnings
  );
end;
$$;

create function public.check_project_import(p_payload jsonb)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' then
    raise exception 'Authentication is required to import projects.' using errcode = '42501';
  end if;
  return public._analyze_project_import(public._prepare_project_import(p_payload));
end;
$$;

create function public.commit_project_import(
  p_idempotency_key uuid,
  p_payload jsonb,
  p_acknowledgements jsonb default '[]'::jsonb
)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '5s'
as $$
declare
  v_actor uuid := auth.uid();
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
    'source_namespace', v_prepared->'source_namespace', 'currency_code', 'CAD',
    'rows_submitted', cardinality(v_results), 'rows_imported', cardinality(v_results),
    'rows_skipped', 0, 'rows_failed', 0, 'rows', to_jsonb(v_results)
  );
  insert into public.project_imports (
    id, imported_by, idempotency_key, payload_hash, source_namespace, file_name,
    worksheet_name, currency_code, rows_submitted, rows_imported, acknowledgements, committed_at, result
  ) values (
    v_import_id, v_actor, p_idempotency_key, v_hash, v_prepared->>'source_namespace',
    v_prepared->>'file_name', v_prepared->>'worksheet_name', 'CAD',
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

create function public.get_project_import_result(p_idempotency_key uuid)
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' then
    raise exception 'Authentication is required to read import results.' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'An import idempotency key is required.' using errcode = '22023';
  end if;
  select result into v_result from public.project_imports
  where imported_by = auth.uid() and idempotency_key = p_idempotency_key;
  return coalesce(v_result, jsonb_build_object('contract_version', 1, 'status', 'not_found', 'idempotency_key', p_idempotency_key));
end;
$$;

-- Definer RPCs intentionally implement the verified authenticated-create rule;
-- governance_admin is not a wildcard and no governance business role is required.
-- Re-review these RPCs if project-create policy ever becomes tenant/role scoped.
revoke all on function public._project_import_hash(jsonb) from public, anon, authenticated;
revoke all on function public._project_import_match_key(text) from public, anon, authenticated;
revoke all on function public._prepare_project_import(jsonb) from public, anon, authenticated;
revoke all on function public._analyze_project_import(jsonb) from public, anon, authenticated;
revoke all on function public.check_project_import(jsonb) from public, anon, authenticated;
revoke all on function public.commit_project_import(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.get_project_import_result(uuid) from public, anon, authenticated;
grant execute on function public.check_project_import(jsonb) to authenticated;
grant execute on function public.commit_project_import(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.get_project_import_result(uuid) to authenticated;

commit;
