-- Phase 15A1 creates zero initial role assignments.
-- After migration verification, explicitly bootstrap the first governance_admin
-- using privileged Supabase SQL Editor access. No browser bootstrap RPC exists.
-- Existing Change Request lifecycle/application authorization stays unchanged
-- until Phase 15A2. Assign and verify test roles before enabling enforcement.
begin;

create table public.governance_user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (user_id, role),
  constraint governance_user_roles_role_allowed check (
    role in (
      'requester', 'reviewer', 'approver',
      'baseline_controller', 'governance_admin'
    )
  )
);

comment on table public.governance_user_roles is
  'Authoritative role assignments; role enforcement on business workflow RPCs begins in Phase 15A2.';
comment on column public.governance_user_roles.role is
  'requester: create/manage own requests; reviewer: governance review; approver: approve/reject reviewed requests; baseline_controller: apply approved budget changes; governance_admin: manage roles only, never a wildcard for business roles.';

alter table public.governance_user_roles enable row level security;
-- No browser policies or direct table privileges: access is RPC-controlled.
revoke all on table public.governance_user_roles
  from public, anon, authenticated;

create function public.current_user_has_governance_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and coalesce(p_role in (
      'requester', 'reviewer', 'approver',
      'baseline_controller', 'governance_admin'
    ), false)
    and exists (
      select 1 from public.governance_user_roles as assignment
      where assignment.user_id = auth.uid() and assignment.role = p_role
    );
$$;

create function public.get_my_governance_roles()
returns table (role text, assigned_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication is required to access governance roles.'
      using errcode = '42501';
  end if;

  return query
    select assignment.role, assignment.assigned_at
    from public.governance_user_roles as assignment
    where assignment.user_id = v_user_id
    order by assignment.role;
end;
$$;

create function public.list_governance_role_assignments()
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
    order by target.email, assignment.user_id, assignment.role;
end;
$$;

create function public.assign_governance_role(p_user_id uuid, p_role text)
returns public.governance_user_roles
language plpgsql
security definer
set search_path = ''
as $$
declare
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

  perform 1 from auth.users where id = p_user_id for key share;
  if not found then
    raise exception 'Target auth user not found.' using errcode = 'P0002';
  end if;

  insert into public.governance_user_roles (user_id, role, assigned_by, assigned_at)
  values (p_user_id, p_role, v_user_id, now())
  on conflict (user_id, role) do nothing;

  -- Duplicate assignment is idempotent and preserves the original audit fields.
  select * into v_assignment
  from public.governance_user_roles as assignment
  where assignment.user_id = p_user_id and assignment.role = p_role;

  return v_assignment;
end;
$$;

create function public.revoke_governance_role(p_user_id uuid, p_role text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
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
    where assignment.user_id = p_user_id and assignment.role = p_role
  ) then
    raise exception 'Role assignment not found.' using errcode = 'P0002';
  end if;

  if p_role = 'governance_admin' and (
    select count(*) from public.governance_user_roles as assignment
    where assignment.role = 'governance_admin'
  ) <= 1 then
    raise exception 'At least one Governance Admin must remain assigned.'
      using errcode = '23514';
  end if;

  delete from public.governance_user_roles as assignment
  where assignment.user_id = p_user_id and assignment.role = p_role;

  return true;
end;
$$;

revoke all on function public.current_user_has_governance_role(text)
  from public, anon, authenticated;
revoke all on function public.get_my_governance_roles()
  from public, anon, authenticated;
revoke all on function public.list_governance_role_assignments()
  from public, anon, authenticated;
revoke all on function public.assign_governance_role(uuid, text)
  from public, anon, authenticated;
revoke all on function public.revoke_governance_role(uuid, text)
  from public, anon, authenticated;

grant execute on function public.current_user_has_governance_role(text) to authenticated;
grant execute on function public.get_my_governance_roles() to authenticated;
grant execute on function public.list_governance_role_assignments() to authenticated;
grant execute on function public.assign_governance_role(uuid, text) to authenticated;
grant execute on function public.revoke_governance_role(uuid, text) to authenticated;

commit;
