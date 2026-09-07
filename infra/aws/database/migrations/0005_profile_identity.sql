alter table public.profiles
  add column if not exists identity_root text,
  add column if not exists primary_identity text,
  add column if not exists primary_identity_family text,
  add column if not exists secondary_identities text[] not null default '{}'::text[],
  drop constraint if exists profiles_full_name_check,
  add constraint profiles_full_name_check check (
    full_name = btrim(full_name) and char_length(full_name) between 2 and 160
  ),
  drop constraint if exists profiles_identity_root_check,
  add constraint profiles_identity_root_check check (
    identity_root is null or identity_root in ('professional', 'organisation')
  ),
  drop constraint if exists profiles_primary_identity_check,
  add constraint profiles_primary_identity_check check (
    primary_identity is null
    or (primary_identity = btrim(primary_identity) and char_length(primary_identity) between 2 and 120)
  ),
  drop constraint if exists profiles_primary_identity_family_check,
  add constraint profiles_primary_identity_family_check check (
    primary_identity_family is null
    or (
      primary_identity_family = btrim(primary_identity_family)
      and char_length(primary_identity_family) between 2 and 120
    )
  ),
  drop constraint if exists profiles_secondary_identities_check,
  add constraint profiles_secondary_identities_check check (
    cardinality(secondary_identities) <= 10
  ),
  drop constraint if exists profiles_identity_shape_check,
  add constraint profiles_identity_shape_check check (
    num_nonnulls(identity_root, primary_identity, primary_identity_family) in (0, 3)
  ),
  drop constraint if exists profiles_completed_identity_check,
  add constraint profiles_completed_identity_check check (
    onboarding_completed_at is null
    or (
      profile_type is not null
      and slug is not null
      and (
        (
          identity_root is not null
          and primary_identity is not null
          and primary_identity_family is not null
          and headline is not null
          and char_length(headline) between 2 and 160
        )
        or (
          headline is not null
          and char_length(headline) between 4 and 160
          and summary is not null
          and char_length(summary) between 20 and 2000
        )
      )
    )
  );
