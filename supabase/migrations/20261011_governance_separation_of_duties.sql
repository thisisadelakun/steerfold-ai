-- Phase 15C1: per-request actor separation; no historical data changes.
begin;

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
  v_review_event public.change_request_events%rowtype;
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
    where change_request_id = v_request.id
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
  v_approval_event public.change_request_events%rowtype;
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
  where change_request_id = v_request.id
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

revoke all on function public.transition_change_request_status(uuid, text, text) from public, anon;
revoke all on function public.apply_approved_change_request(uuid, text) from public, anon;
grant execute on function public.transition_change_request_status(uuid, text, text) to authenticated;
grant execute on function public.apply_approved_change_request(uuid, text) to authenticated;

commit;
