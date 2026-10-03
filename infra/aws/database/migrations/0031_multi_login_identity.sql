alter table public.identity_accounts
  add column if not exists provider_username text,
  add column if not exists email_verified boolean not null default false,
  add column if not exists phone_number text,
  add column if not exists phone_number_verified boolean not null default false;
-- statement-breakpoint
alter table public.identity_accounts
  drop constraint if exists identity_accounts_profile_id_provider_key;
-- statement-breakpoint
alter table public.identity_accounts
  drop constraint if exists identity_accounts_provider_username_check,
  add constraint identity_accounts_provider_username_check check (
    provider_username is null
    or (
      provider_username = btrim(provider_username)
      and char_length(provider_username) between 1 and 255
    )
  ),
  drop constraint if exists identity_accounts_phone_number_check,
  add constraint identity_accounts_phone_number_check check (
    phone_number is null
    or phone_number ~ '^\+[1-9][0-9]{7,14}$'
  ),
  drop constraint if exists identity_accounts_email_verified_check,
  add constraint identity_accounts_email_verified_check check (
    email_verified = false or email is not null
  ),
  drop constraint if exists identity_accounts_phone_verified_check,
  add constraint identity_accounts_phone_verified_check check (
    phone_number_verified = false or phone_number is not null
  );
-- statement-breakpoint
update public.identity_accounts
set email_verified = true
where provider = 'cognito'
  and email is not null
  and email_verified = false;
-- statement-breakpoint
create index if not exists identity_accounts_profile_provider_idx
  on public.identity_accounts (profile_id, provider);
-- statement-breakpoint
create index if not exists identity_accounts_verified_email_idx
  on public.identity_accounts (lower(email))
  where email_verified = true and email is not null;
-- statement-breakpoint
create index if not exists identity_accounts_verified_phone_idx
  on public.identity_accounts (phone_number)
  where phone_number_verified = true and phone_number is not null;
