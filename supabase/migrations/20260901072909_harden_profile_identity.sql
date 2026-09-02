-- Keep completed public identities valid and immutable through the Data API.
alter table public.profiles
add constraint profiles_completed_identity_check
check (
  onboarding_completed_at is null
  or (slug is not null and profile_type is not null)
);

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  resolved_full_name text;
  trimmed_phone text;
begin
  resolved_full_name := trim(new.raw_user_meta_data ->> 'full_name');

  if resolved_full_name is null or char_length(resolved_full_name) < 2 then
    resolved_full_name := trim(split_part(coalesce(new.email, ''), '@', 1));
  end if;

  if resolved_full_name is null or char_length(resolved_full_name) < 2 then
    trimmed_phone := trim(coalesce(new.phone, ''));

    if char_length(trimmed_phone) > 0 then
      resolved_full_name := 'Member ' || trimmed_phone;
    else
      resolved_full_name := 'Sea N Shore Member';
    end if;
  end if;

  resolved_full_name := left(resolved_full_name, 120);

  insert into public.profiles (id, full_name)
  values (new.id, resolved_full_name);

  insert into public.user_roles (user_id, role)
  values (new.id, 'member');

  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

create or replace function private.prevent_primary_profile_type_change()
returns trigger
language plpgsql
security invoker set search_path = ''
as $$
begin
  if old.onboarding_completed_at is not null
    and new.profile_type is distinct from old.profile_type
  then
    raise exception 'primary profile type requires support review';
  end if;

  if old.onboarding_completed_at is not null
    and new.onboarding_completed_at is distinct from old.onboarding_completed_at
  then
    raise exception 'onboarding completion state is immutable';
  end if;

  return new;
end;
$$;

drop trigger protect_primary_profile_type on public.profiles;

create trigger protect_primary_profile_type
before update of profile_type, onboarding_completed_at on public.profiles
for each row execute procedure private.prevent_primary_profile_type_change();

revoke all on function private.prevent_primary_profile_type_change() from public, anon, authenticated;
