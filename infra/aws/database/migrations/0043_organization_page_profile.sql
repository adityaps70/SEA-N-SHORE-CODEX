-- Sea N Shore organization page profile fields.
-- Additive and safe to run more than once.
--
-- The organization page now follows a company-page layout: a wide cover image,
-- a short tagline under the name, a company size band and a list of
-- specialities. All columns are optional; existing organizations keep working
-- with the gradient cover, the first line of their description as tagline and
-- no size shown. No existing value is rewritten.

alter table public.companies
  add column if not exists cover_path text,
  add column if not exists tagline text,
  add column if not exists company_size text,
  add column if not exists specialties text[] not null default '{}';
-- statement-breakpoint

alter table public.companies
  drop constraint if exists companies_cover_path_check,
  add constraint companies_cover_path_check check (
    cover_path is null
    or (cover_path = btrim(cover_path) and char_length(cover_path) between 1 and 512)
  ),
  drop constraint if exists companies_tagline_check,
  add constraint companies_tagline_check check (
    tagline is null
    or (tagline = btrim(tagline) and char_length(tagline) between 1 and 160)
  ),
  drop constraint if exists companies_company_size_check,
  add constraint companies_company_size_check check (
    company_size is null
    or company_size in (
      '1-10',
      '11-50',
      '51-200',
      '201-500',
      '501-1000',
      '1001-5000',
      '5001-10000',
      '10001+'
    )
  ),
  drop constraint if exists companies_specialties_check,
  add constraint companies_specialties_check check (cardinality(specialties) <= 20);
-- statement-breakpoint

-- Follower counts are shown on every organization card and page.
create index if not exists organization_follows_company_idx
  on public.organization_follows (company_id);
