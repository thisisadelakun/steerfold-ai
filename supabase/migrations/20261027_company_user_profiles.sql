-- LOCAL REVIEW ONLY. Requires 20261026_organization_currency.sql first.
-- Later unique version ensures this dependency sorts first in migration tooling.
-- Do not apply without approval and a rollback dry-run against staging.
-- Company identity is public portfolio context; personal profiles are private.
begin;

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

commit;
