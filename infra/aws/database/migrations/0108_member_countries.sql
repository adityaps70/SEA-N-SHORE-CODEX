-- Round GP (Global Partners), Part A: a country on every member and organization, for Admin › Members by country.
--
-- 1. public.profiles.country_of_residence and public.profiles.nationality: ISO 3166-1 alpha-2 codes the member chose
--    themselves (profile edit, onboarding, or the one-time prompt). Both optional; country of residence is the main
--    country. Admin may show an estimate for members who have not chosen one (from their location text, phone dialling
--    code or sign-up country), but an estimate is worked out when Admin reads it and never written into these columns.
--    profiles.country_prompt_dismissed_at: when the member closed the "add your country" prompt, so it never returns.
-- 2. public.companies.country: the organization's country (ISO 3166-1 alpha-2). New organization applications and claims
--    require it; existing pages stay null ("Country not set") until the organization or a platform administrator sets it.
-- 3. public.member_signup_countries: the country CloudFront reported (its viewer-country header) when a new account was
--    created. The two-letter code only: no IP address, no city. One row per member, written once.
--
-- Additive and safe to run more than once. No existing row is rewritten. Reversible: drop table
-- public.member_signup_countries; alter table public.profiles drop column country_of_residence, drop column
-- nationality, drop column country_prompt_dismissed_at; alter table public.companies drop column country (the app
-- built before this release never reads them).
-- statement-breakpoint
alter table public.profiles
  add column if not exists country_of_residence text null
    constraint profiles_country_of_residence_check check (country_of_residence is null or country_of_residence ~ '^[A-Z]{2}$'),
  add column if not exists nationality text null
    constraint profiles_nationality_check check (nationality is null or nationality ~ '^[A-Z]{2}$'),
  add column if not exists country_prompt_dismissed_at timestamptz null;
-- statement-breakpoint
alter table public.companies
  add column if not exists country text null
    constraint companies_country_check check (country is null or country ~ '^[A-Z]{2}$');
-- statement-breakpoint
create table if not exists public.member_signup_countries (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  country_code text not null constraint member_signup_countries_code_check check (country_code ~ '^[A-Z]{2}$'),
  recorded_at timestamptz not null default now()
);
