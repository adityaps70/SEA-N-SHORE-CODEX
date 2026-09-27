-- Sea N Shore profile documents and automatic usernames.
-- Safe to apply more than once.
--
-- 1. public.profile_documents stores metadata for private member documents
--    (today: the seafarer's DG Shipping profile PDF). The file itself stays in
--    the private AWS media bucket; it is only ever served through an
--    authorised route that issues a short-lived signed URL.
-- 2. profiles.username_auto_generated marks handles that Sea N Shore created
--    during onboarding, so the member's first change does not use one of the
--    two limited username changes.

create table if not exists public.profile_documents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes integer not null,
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- statement-breakpoint

alter table public.profile_documents
  drop constraint if exists profile_documents_kind_check,
  add constraint profile_documents_kind_check check (kind in ('dg_profile'));
-- statement-breakpoint

alter table public.profile_documents
  drop constraint if exists profile_documents_metadata_check,
  add constraint profile_documents_metadata_check check (
    mime_type = 'application/pdf'
    and size_bytes between 1 and 10485760
    and char_length(storage_path) between 1 and 1024
    and char_length(file_name) between 1 and 255
  );
-- statement-breakpoint

create unique index if not exists profile_documents_profile_kind_key
  on public.profile_documents (profile_id, kind);
-- statement-breakpoint

create unique index if not exists profile_documents_storage_path_key
  on public.profile_documents (storage_path);
-- statement-breakpoint

alter table public.profiles
  add column if not exists username_auto_generated boolean not null default false;
