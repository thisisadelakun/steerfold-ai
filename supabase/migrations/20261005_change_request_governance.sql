-- One-time migration: apply once through the Supabase migration or SQL workflow.
begin;

create extension if not exists pgcrypto;

create sequence if not exists public.change_request_number_seq;

create table public.change_requests (
  id uuid primary key default gen_random_uuid(),
  request_id text not null unique default (
    'CR-' || lpad(nextval('public.change_request_number_seq')::text, 4, '0')
  ),
  project_id uuid not null references public.projects(id) on delete restrict,
  project_code text,
  original_bac numeric not null,
  budget_change_amount numeric not null,
  proposed_bac numeric not null,
  change_type text not null,
  change_summary text,
  impact_scope text not null default 'None',
  impact_schedule text not null default 'None',
  impact_cost text not null default 'None',
  impact_quality text not null default 'None',
  impact_resources text not null default 'None',
  impact_risk text not null default 'None',
  impact_stakeholders text not null default 'None',
  status text not null default 'Draft',
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  decided_at timestamptz,
  decision_note text,
  constraint change_requests_original_bac_positive check (original_bac > 0),
  constraint change_requests_proposed_bac_positive check (proposed_bac > 0),
  constraint change_requests_budget_balance check (
    proposed_bac = original_bac + budget_change_amount
  ),
  constraint change_requests_change_type_allowed check (
    change_type in (
      'Scope', 'Schedule', 'Cost', 'Resource',
      'Risk Response', 'Compliance', 'Other'
    )
  ),
  constraint change_requests_impact_scope_allowed check (impact_scope in ('None', 'Low', 'Medium', 'High')),
  constraint change_requests_impact_schedule_allowed check (impact_schedule in ('None', 'Low', 'Medium', 'High')),
  constraint change_requests_impact_cost_allowed check (impact_cost in ('None', 'Low', 'Medium', 'High')),
  constraint change_requests_impact_quality_allowed check (impact_quality in ('None', 'Low', 'Medium', 'High')),
  constraint change_requests_impact_resources_allowed check (impact_resources in ('None', 'Low', 'Medium', 'High')),
  constraint change_requests_impact_risk_allowed check (impact_risk in ('None', 'Low', 'Medium', 'High')),
  constraint change_requests_impact_stakeholders_allowed check (impact_stakeholders in ('None', 'Low', 'Medium', 'High')),
  constraint change_requests_status_allowed check (
    status in (
      'Draft', 'Submitted', 'Under Review', 'Approved',
      'Rejected', 'Deferred', 'Withdrawn'
    )
  )
);

comment on table public.change_requests is
  'Persistent governance requests. A proposed BAC is not an approved project baseline.';

create table public.change_request_events (
  id uuid primary key default gen_random_uuid(),
  change_request_id uuid not null references public.change_requests(id) on delete cascade,
  event_type text not null,
  from_status text,
  to_status text,
  note text,
  performed_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  constraint change_request_events_type_allowed check (
    event_type in (
      'Created', 'Updated', 'Submitted', 'Review Started',
      'Approved', 'Rejected', 'Deferred', 'Withdrawn'
    )
  ),
  constraint change_request_events_from_status_allowed check (
    from_status is null or from_status in (
      'Draft', 'Submitted', 'Under Review', 'Approved',
      'Rejected', 'Deferred', 'Withdrawn'
    )
  ),
  constraint change_request_events_to_status_allowed check (
    to_status is null or to_status in (
      'Draft', 'Submitted', 'Under Review', 'Approved',
      'Rejected', 'Deferred', 'Withdrawn'
    )
  )
);

comment on table public.change_request_events is
  'Append-only lifecycle history for governance change requests.';

create index change_requests_project_id_idx on public.change_requests(project_id);
create index change_requests_status_idx on public.change_requests(status);
create index change_requests_created_at_idx on public.change_requests(created_at);
create index change_request_events_request_idx on public.change_request_events(change_request_id);
create index change_request_events_created_at_idx on public.change_request_events(created_at);

create or replace function public.set_change_request_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_change_requests_updated_at
before update on public.change_requests
for each row execute function public.set_change_request_updated_at();

alter table public.change_requests enable row level security;
alter table public.change_request_events enable row level security;

create policy "Authenticated users can read change requests"
on public.change_requests for select
to authenticated
using (true);

create policy "Authenticated users can read change request events"
on public.change_request_events for select
to authenticated
using (true);

revoke all on public.change_requests from anon, authenticated;
revoke all on public.change_request_events from anon, authenticated;
revoke all on sequence public.change_request_number_seq from anon, authenticated;
grant select on public.change_requests to authenticated;
grant select on public.change_request_events to authenticated;

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
  v_user_id uuid := auth.uid();
  v_project public.projects%rowtype;
  v_request public.change_requests%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication is required to create a change request.' using errcode = '42501';
  end if;

  select * into v_project
  from public.projects
  where project_id = p_project_code;

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
  v_user_id uuid := auth.uid();
  v_request public.change_requests%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication is required to update a change request.' using errcode = '42501';
  end if;

  select * into v_request
  from public.change_requests
  where id = p_change_request_id
  for update;

  if not found then
    raise exception 'Change request not found.' using errcode = 'P0002';
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
  where id = p_change_request_id
  returning * into v_request;

  insert into public.change_request_events (
    change_request_id, event_type, from_status, to_status, performed_by
  ) values (
    v_request.id, 'Updated', 'Draft', 'Draft', v_user_id
  );

  return v_request;
end;
$$;

-- Phase 14B1 treats authenticated users as trusted admins. Add explicit roles
-- and separation-of-duty authorization before enabling a multi-user workflow.
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
  v_user_id uuid := auth.uid();
  v_request public.change_requests%rowtype;
  v_from_status text;
  v_event_type text;
begin
  if v_user_id is null then
    raise exception 'Authentication is required to transition a change request.' using errcode = '42501';
  end if;

  select * into v_request
  from public.change_requests
  where id = p_change_request_id
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
  where id = p_change_request_id
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

comment on function public.transition_change_request_status(uuid, text, text) is
  'Validates lifecycle transitions and appends history; it never updates project BAC.';

create or replace function public.delete_draft_change_request(
  p_change_request_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_status text;
begin
  if v_user_id is null then
    raise exception 'Authentication is required to delete a change request.' using errcode = '42501';
  end if;

  select status into v_status
  from public.change_requests
  where id = p_change_request_id
  for update;

  if not found then
    raise exception 'Change request not found.' using errcode = 'P0002';
  end if;

  if v_status <> 'Draft' then
    raise exception 'Only Draft change requests can be deleted.' using errcode = '23514';
  end if;

  delete from public.change_requests where id = p_change_request_id;
  return true;
end;
$$;

revoke all on function public.create_change_request(text, numeric, text, text, text, text, text, text, text, text, text) from public, anon;
revoke all on function public.update_draft_change_request(uuid, numeric, text, text, text, text, text, text, text, text, text) from public, anon;
revoke all on function public.transition_change_request_status(uuid, text, text) from public, anon;
revoke all on function public.delete_draft_change_request(uuid) from public, anon;

grant execute on function public.create_change_request(text, numeric, text, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.update_draft_change_request(uuid, numeric, text, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.transition_change_request_status(uuid, text, text) to authenticated;
grant execute on function public.delete_draft_change_request(uuid) to authenticated;

commit;
