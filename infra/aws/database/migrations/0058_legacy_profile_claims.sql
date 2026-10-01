-- Legacy Beaufort Marine profile-claim bridge.
-- Imported legacy profiles stay restricted and non-public until the owner signs
-- in with a verified current identity. No legacy passwords, memberships, job
-- applications or payment history are stored here.

create table if not exists public.legacy_profile_claims (
  id uuid primary key default gen_random_uuid(),
  source_system text not null,
  legacy_object text not null,
  legacy_id bigint not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  email text,
  phone_number text,
  claimed_at timestamptz,
  claimed_by_provider_subject text,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint legacy_profile_claims_source_check check (
    source_system = btrim(source_system)
    and char_length(source_system) between 2 and 80
  ),
  constraint legacy_profile_claims_object_check check (
    legacy_object = btrim(legacy_object)
    and char_length(legacy_object) between 2 and 80
  ),
  constraint legacy_profile_claims_email_check check (
    email is null
    or (
      email = lower(btrim(email))
      and char_length(email) between 3 and 320
    )
  ),
  constraint legacy_profile_claims_phone_check check (
    phone_number is null
    or phone_number ~ '^\\+[1-9][0-9]{7,14}$'
  ),
  constraint legacy_profile_claims_claimed_by_check check (
    claimed_by_provider_subject is null
    or char_length(claimed_by_provider_subject) between 1 and 255
  ),
  unique (source_system, legacy_object, legacy_id)
);
-- statement-breakpoint

create index if not exists legacy_profile_claims_email_idx
  on public.legacy_profile_claims (lower(email))
  where claimed_at is null and email is not null;
-- statement-breakpoint

create index if not exists legacy_profile_claims_phone_idx
  on public.legacy_profile_claims (phone_number)
  where claimed_at is null and phone_number is not null;
-- statement-breakpoint

create index if not exists legacy_profile_claims_profile_idx
  on public.legacy_profile_claims (profile_id, claimed_at);
