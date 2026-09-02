create or replace function private.normalize_maritime_profile()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_profile_type public.profile_type;
begin
  select profile_type
  into v_profile_type
  from public.profiles
  where id = new.user_id;

  if v_profile_type is null
    or v_profile_type not in ('seafarer', 'maritime_professional')
  then
    raise check_violation using message = 'maritime details require a maritime profile type';
  end if;

  new.rank := nullif(btrim(new.rank), '');
  new.current_company := nullif(btrim(new.current_company), '');
  new.current_vessel := nullif(btrim(new.current_vessel), '');
  new.availability := nullif(btrim(new.availability), '');

  if exists (
    select 1
    from unnest(coalesce(new.vessel_types, '{}'::text[])) as entry(value)
    where value is null
      or char_length(btrim(value)) not between 1 and 80
  ) then
    raise check_violation using message = 'vessel types contain an invalid entry';
  end if;

  if exists (
    select 1
    from unnest(coalesce(new.trading_areas, '{}'::text[])) as entry(value)
    where value is null
      or char_length(btrim(value)) not between 1 and 80
  ) then
    raise check_violation using message = 'trading areas contain an invalid entry';
  end if;

  select coalesce(array_agg(term order by first_position), '{}'::text[])
  into new.vessel_types
  from (
    select distinct on (lower(btrim(value)))
      btrim(value) as term,
      position as first_position
    from unnest(coalesce(new.vessel_types, '{}'::text[])) with ordinality as entry(value, position)
    order by lower(btrim(value)), position
  ) normalized;

  select coalesce(array_agg(term order by first_position), '{}'::text[])
  into new.trading_areas
  from (
    select distinct on (lower(btrim(value)))
      btrim(value) as term,
      position as first_position
    from unnest(coalesce(new.trading_areas, '{}'::text[])) with ordinality as entry(value, position)
    order by lower(btrim(value)), position
  ) normalized;

  if v_profile_type = 'seafarer' and coalesce(char_length(new.rank), 0) < 2 then
    raise check_violation using message = 'rank is required for seafarers';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.normalize_maritime_profile() from public, anon, authenticated;

create or replace function public.complete_onboarding(
  p_profile_type public.profile_type,
  p_full_name text,
  p_slug text,
  p_location text,
  p_headline text,
  p_summary text,
  p_contact_visibility public.contact_visibility,
  p_skills text[],
  p_rank text default null,
  p_current_company text default null,
  p_current_vessel text default null,
  p_sailing_experience_years numeric default null,
  p_vessel_types text[] default '{}',
  p_trading_areas text[] default '{}',
  p_shore_career_preference boolean default false,
  p_availability text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_account_status public.account_status;
  v_onboarding_completed_at timestamptz;
  v_full_name text := btrim(p_full_name);
  v_slug text := lower(btrim(p_slug));
  v_location text := nullif(btrim(p_location), '');
  v_headline text := btrim(p_headline);
  v_summary text := btrim(p_summary);
  v_skills text[];
  v_rank text;
  v_current_company text;
  v_current_vessel text;
  v_sailing_experience_years numeric;
  v_vessel_types text[] := '{}';
  v_trading_areas text[] := '{}';
  v_shore_career_preference boolean := false;
  v_availability text;
  v_row_count integer;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication required';
  end if;

  if p_profile_type is null then
    raise exception using errcode = '22023', message = 'profile type is required';
  end if;
  if p_contact_visibility is null then
    raise exception using errcode = '22023', message = 'contact visibility is required';
  end if;

  select account_status, onboarding_completed_at
  into v_account_status, v_onboarding_completed_at
  from public.profiles
  where id = v_user_id
  for update;

  if not found
    or v_account_status <> 'active'
    or v_onboarding_completed_at is not null
  then
    raise exception using errcode = 'P0001', message = 'onboarding is unavailable';
  end if;

  if v_full_name is null or char_length(v_full_name) not between 2 and 120 then
    raise exception using errcode = '22023', message = 'full name must be between 2 and 120 characters';
  end if;
  if v_slug is null or char_length(v_slug) not between 1 and 80
    or v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  then
    raise exception using errcode = '22023', message = 'profile address is invalid';
  end if;
  if v_location is not null and char_length(v_location) > 120 then
    raise exception using errcode = '22023', message = 'location must be 120 characters or fewer';
  end if;
  if v_headline is null or char_length(v_headline) not between 4 and 160 then
    raise exception using errcode = '22023', message = 'headline must be between 4 and 160 characters';
  end if;
  if v_summary is null or char_length(v_summary) not between 20 and 2000 then
    raise exception using errcode = '22023', message = 'summary must be between 20 and 2000 characters';
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_skills, '{}'::text[])) as entry(value)
    where value is null
      or char_length(btrim(value)) not between 1 and 80
  ) then
    raise exception using errcode = '22023', message = 'skills contain an invalid entry';
  end if;

  select coalesce(array_agg(term order by first_position), '{}'::text[])
  into v_skills
  from (
    select distinct on (lower(btrim(value)))
      btrim(value) as term,
      position as first_position
    from unnest(coalesce(p_skills, '{}'::text[])) with ordinality as entry(value, position)
    order by lower(btrim(value)), position
  ) normalized;

  if cardinality(v_skills) > 20 then
    raise exception using errcode = '22023', message = 'skills may contain no more than 20 entries';
  end if;

  if p_profile_type in ('seafarer', 'maritime_professional') then
    v_rank := nullif(btrim(p_rank), '');
    v_current_company := nullif(btrim(p_current_company), '');
    v_current_vessel := nullif(btrim(p_current_vessel), '');
    v_sailing_experience_years := p_sailing_experience_years;
    v_shore_career_preference := coalesce(p_shore_career_preference, false);
    v_availability := nullif(btrim(p_availability), '');

    if p_profile_type = 'seafarer' and coalesce(char_length(v_rank), 0) < 2 then
      raise exception using errcode = '22023', message = 'rank is required for seafarers';
    end if;
    if v_rank is not null and char_length(v_rank) > 100 then
      raise exception using errcode = '22023', message = 'rank must be 100 characters or fewer';
    end if;
    if v_current_company is not null and char_length(v_current_company) > 160 then
      raise exception using errcode = '22023', message = 'current company must be 160 characters or fewer';
    end if;
    if v_current_vessel is not null and char_length(v_current_vessel) > 160 then
      raise exception using errcode = '22023', message = 'current vessel must be 160 characters or fewer';
    end if;
    if v_sailing_experience_years is not null
      and (v_sailing_experience_years < 0 or v_sailing_experience_years > 70)
    then
      raise exception using errcode = '22023', message = 'sailing experience must be between 0 and 70 years';
    end if;
    if v_availability is not null and char_length(v_availability) > 100 then
      raise exception using errcode = '22023', message = 'availability must be 100 characters or fewer';
    end if;

    if exists (
      select 1
      from unnest(coalesce(p_vessel_types, '{}'::text[])) as entry(value)
      where value is null
        or char_length(btrim(value)) not between 1 and 80
    ) then
      raise exception using errcode = '22023', message = 'vessel types contain an invalid entry';
    end if;
    if exists (
      select 1
      from unnest(coalesce(p_trading_areas, '{}'::text[])) as entry(value)
      where value is null
        or char_length(btrim(value)) not between 1 and 80
    ) then
      raise exception using errcode = '22023', message = 'trading areas contain an invalid entry';
    end if;

    select coalesce(array_agg(term order by first_position), '{}'::text[])
    into v_vessel_types
    from (
      select distinct on (lower(btrim(value)))
        btrim(value) as term,
        position as first_position
      from unnest(coalesce(p_vessel_types, '{}'::text[])) with ordinality as entry(value, position)
      order by lower(btrim(value)), position
    ) normalized;

    select coalesce(array_agg(term order by first_position), '{}'::text[])
    into v_trading_areas
    from (
      select distinct on (lower(btrim(value)))
        btrim(value) as term,
        position as first_position
      from unnest(coalesce(p_trading_areas, '{}'::text[])) with ordinality as entry(value, position)
      order by lower(btrim(value)), position
    ) normalized;

    if cardinality(v_vessel_types) > 20 then
      raise exception using errcode = '22023', message = 'vessel types may contain no more than 20 entries';
    end if;
    if cardinality(v_trading_areas) > 20 then
      raise exception using errcode = '22023', message = 'trading areas may contain no more than 20 entries';
    end if;
  end if;

  if p_profile_type not in ('seafarer', 'maritime_professional') then
    delete from public.maritime_profiles where user_id = v_user_id;
  end if;

  update public.profiles
  set profile_type = p_profile_type,
      full_name = v_full_name,
      slug = v_slug,
      location = v_location,
      headline = v_headline,
      summary = v_summary,
      contact_visibility = p_contact_visibility,
      onboarding_completed_at = now()
  where id = v_user_id
    and account_status = 'active'
    and onboarding_completed_at is null;

  get diagnostics v_row_count = row_count;
  if v_row_count <> 1 then
    raise exception using errcode = 'P0001', message = 'onboarding is unavailable';
  end if;

  if p_profile_type in ('seafarer', 'maritime_professional') then
    insert into public.maritime_profiles (
      user_id, rank, current_company, current_vessel, sailing_experience_years,
      vessel_types, trading_areas, shore_career_preference, availability
    ) values (
      v_user_id, v_rank, v_current_company, v_current_vessel, v_sailing_experience_years,
      v_vessel_types, v_trading_areas, v_shore_career_preference, v_availability
    )
    on conflict (user_id) do update set
      rank = excluded.rank,
      current_company = excluded.current_company,
      current_vessel = excluded.current_vessel,
      sailing_experience_years = excluded.sailing_experience_years,
      vessel_types = excluded.vessel_types,
      trading_areas = excluded.trading_areas,
      shore_career_preference = excluded.shore_career_preference,
      availability = excluded.availability;
  end if;

  delete from public.profile_skills where user_id = v_user_id;
  insert into public.profile_skills (user_id, skill)
  select v_user_id, skill
  from unnest(v_skills) as skill;
end;
$$;

revoke all on function public.complete_onboarding(
  public.profile_type, text, text, text, text, text, public.contact_visibility,
  text[], text, text, text, numeric, text[], text[], boolean, text
) from public, anon, authenticated;

grant execute on function public.complete_onboarding(
  public.profile_type, text, text, text, text, text, public.contact_visibility,
  text[], text, text, text, numeric, text[], text[], boolean, text
) to authenticated;
