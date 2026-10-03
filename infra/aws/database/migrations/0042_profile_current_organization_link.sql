-- Sea N Shore profile current organization link.
-- Additive and safe to run more than once.
--
-- maritime_profiles.current_company keeps the free-text organization name members
-- type (and that search, cards and older screens read). current_company_id links the
-- profile to a real organization page on Sea N Shore when the member picks one from
-- the organization picker. The application only stores ids of organizations that are
-- listed on Sea N Shore (verified, or public legacy pages; never rejected, suspended
-- or still-pending applications) and keeps current_company set to that
-- organization's name. If an organization is removed the link clears and the typed
-- name stays, so no profile loses its current organization text.

alter table public.maritime_profiles
  add column if not exists current_company_id uuid references public.companies(id) on delete set null;
-- statement-breakpoint

create index if not exists maritime_profiles_current_company_id_idx
  on public.maritime_profiles (current_company_id)
  where current_company_id is not null;
