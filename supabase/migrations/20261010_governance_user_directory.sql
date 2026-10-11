-- Read-only directory for future Governance Admin role management.
begin;

create function public.list_governance_users()
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
    order by directory_user.email asc nulls last,
      directory_user.created_at asc, directory_user.id asc;
end;
$$;

revoke all on function public.list_governance_users() from public, anon;
grant execute on function public.list_governance_users() to authenticated;

commit;
