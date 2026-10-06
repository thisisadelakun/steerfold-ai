-- One-time migration: adds explicit application of an approved budget change.
begin;

alter table public.change_requests
  add column applied_at timestamptz,
  add column applied_by uuid references auth.users(id),
  add column applied_bac_before numeric,
  add column applied_bac_after numeric,
  add column application_note text;

alter table public.change_requests
  add constraint change_requests_application_metadata_consistent check (
    (
      applied_at is null and
      applied_by is null and
      applied_bac_before is null and
      applied_bac_after is null
    ) or (
      applied_at is not null and
      applied_by is not null and
      applied_bac_before is not null and
      applied_bac_after is not null
    )
  ),
  add constraint change_requests_applied_bac_before_positive check (
    applied_bac_before is null or applied_bac_before > 0
  ),
  add constraint change_requests_applied_bac_after_positive check (
    applied_bac_after is null or applied_bac_after > 0
  );

alter table public.change_request_events
  drop constraint change_request_events_type_allowed,
  add constraint change_request_events_type_allowed check (
    event_type in (
      'Created', 'Updated', 'Submitted', 'Review Started',
      'Approved', 'Rejected', 'Deferred', 'Withdrawn', 'Applied'
    )
  );

-- Phase 14C1 continues to treat authenticated users as trusted admins.
-- Application changes only the locked project's budget baseline; request status
-- remains Approved and all prior lifecycle events remain immutable.
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
  v_user_id uuid := auth.uid();
  v_request public.change_requests%rowtype;
  v_project public.projects%rowtype;
  v_application_note text := nullif(btrim(p_application_note), '');
begin
  if v_user_id is null then
    raise exception 'Authentication is required to apply an approved Change Request.'
      using errcode = '42501';
  end if;

  select * into v_request
  from public.change_requests
  where id = p_change_request_id
  for update;

  if not found then
    raise exception 'Change Request not found.' using errcode = 'P0002';
  end if;

  if v_request.status <> 'Approved' then
    raise exception 'Only an Approved Change Request can be applied.'
      using errcode = '23514';
  end if;

  if v_request.applied_at is not null then
    raise exception 'Change Request has already been applied.'
      using errcode = '23514';
  end if;

  select * into v_project
  from public.projects
  where id = v_request.project_id
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
  where id = v_project.id;

  update public.change_requests
  set applied_at = now(),
      applied_by = v_user_id,
      applied_bac_before = v_project.budget_bac,
      applied_bac_after = v_request.proposed_bac,
      application_note = v_application_note
  where id = v_request.id
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

comment on function public.apply_approved_change_request(uuid, text) is
  'Atomically applies one Approved request after baseline-drift checks; status remains Approved.';

revoke all on function public.apply_approved_change_request(uuid, text)
  from public, anon;

grant execute on function public.apply_approved_change_request(uuid, text)
  to authenticated;

commit;
