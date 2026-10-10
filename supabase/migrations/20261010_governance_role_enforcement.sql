-- Phase 15A2: enforce business roles without changing role assignments or data.
-- Requires the verified Phase 15A1 foundation and explicit role bootstrap.
-- governance_admin is role-management authority only. Maker-checker restrictions
-- are intentionally deferred; one user may hold multiple business roles.
begin;

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

  if not public.current_user_has_governance_role('requester') then
    raise exception 'Requester role is required to create Change Requests.'
      using errcode = '42501';
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
  elsif p_new_status in ('Approved', 'Rejected', 'Deferred') then
    if not public.current_user_has_governance_role('approver') then
      raise exception 'Approver role is required for this Change Request action.'
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
  v_created_by uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication is required to delete a change request.' using errcode = '42501';
  end if;

  select status, created_by into v_status, v_created_by
  from public.change_requests
  where id = p_change_request_id
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

  delete from public.change_requests where id = p_change_request_id;
  return true;
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

revoke all on function public.create_change_request(text, numeric, text, text, text, text, text, text, text, text, text) from public, anon;
revoke all on function public.update_draft_change_request(uuid, numeric, text, text, text, text, text, text, text, text, text) from public, anon;
revoke all on function public.transition_change_request_status(uuid, text, text) from public, anon;
revoke all on function public.delete_draft_change_request(uuid) from public, anon;
revoke all on function public.apply_approved_change_request(uuid, text) from public, anon;

grant execute on function public.create_change_request(text, numeric, text, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.update_draft_change_request(uuid, numeric, text, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.transition_change_request_status(uuid, text, text) to authenticated;
grant execute on function public.delete_draft_change_request(uuid) to authenticated;
grant execute on function public.apply_approved_change_request(uuid, text) to authenticated;

commit;
