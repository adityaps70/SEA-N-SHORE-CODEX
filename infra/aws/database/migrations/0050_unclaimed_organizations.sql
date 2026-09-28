-- Sea N Shore unclaimed organizations.
-- Additive and safe to run more than once. No existing row is rewritten.
--
-- 1. companies.claim_status: 'claimed' (the default, every existing organization)
--    or 'unclaimed'. A member who "just works there" can add an organization that
--    is not on Sea N Shore yet. It gets a basic, unclaimed page that colleagues can
--    link to, but nobody manages it and it cannot publish jobs, events, courses or
--    organization posts. The member who added it is companies.created_by (the
--    existing creator column).
-- 2. companies.claimed_at / claimed_by_profile_id: when and by whom an unclaimed
--    page was claimed. Someone who owns or manages the organization claims the
--    page through the normal organization verification review
--    (public.organization_applications). When Sea N Shore approves that review the
--    organization becomes verified, and the trigger below marks it claimed.
-- 3. organization_applications.request_kind: 'registration' (a new organization,
--    the default for every existing application) or 'claim' (a claim of an
--    existing unclaimed page), so reviewers can tell the two apart.
-- 4. Two unclaimed organizations can never share a name (case-insensitive). The
--    application also refuses a new unclaimed organization when any organization
--    already has that name.

alter table public.companies
  add column if not exists claim_status text not null default 'claimed',
  add column if not exists claimed_at timestamptz,
  add column if not exists claimed_by_profile_id uuid references public.profiles(id) on delete set null;
-- statement-breakpoint

alter table public.companies
  drop constraint if exists companies_claim_status_check,
  add constraint companies_claim_status_check check (
    claim_status in ('claimed', 'unclaimed')
  ),
  drop constraint if exists companies_unclaimed_not_verified_check,
  add constraint companies_unclaimed_not_verified_check check (
    claim_status = 'claimed' or coalesce(is_verified, false) = false
  ) not valid;
-- statement-breakpoint

create index if not exists companies_unclaimed_idx
  on public.companies (created_at desc, id)
  where claim_status = 'unclaimed';
-- statement-breakpoint

create unique index if not exists companies_unclaimed_name_key
  on public.companies (lower(btrim(name)))
  where claim_status = 'unclaimed';
-- statement-breakpoint

-- Case-insensitive name lookups for duplicate checks and the type-ahead.
create index if not exists companies_lower_name_idx
  on public.companies (lower(btrim(name)));
-- statement-breakpoint

alter table public.organization_applications
  add column if not exists request_kind text not null default 'registration';
-- statement-breakpoint

alter table public.organization_applications
  drop constraint if exists organization_applications_request_kind_check,
  add constraint organization_applications_request_kind_check check (
    request_kind in ('registration', 'claim')
  );
-- statement-breakpoint

-- An unclaimed page becomes claimed the moment Sea N Shore verifies it (the claim
-- review is approved). The claimant is the member who submitted the review.
create or replace function public.mark_organization_claimed_on_verification()
returns trigger
language plpgsql
as $$
begin
  if new.claim_status = 'unclaimed'
     and coalesce(new.is_verified, false)
     and not coalesce(old.is_verified, false) then
    new.claim_status := 'claimed';
    new.claimed_at := coalesce(new.claimed_at, now());
    new.claimed_by_profile_id := coalesce(
      new.claimed_by_profile_id,
      (
        select application.submitted_by
        from public.organization_applications application
        where application.company_id = new.id
        limit 1
      )
    );
  end if;
  return new;
end;
$$;
-- statement-breakpoint

create or replace trigger companies_mark_claimed_on_verification
before update of is_verified on public.companies
for each row
execute function public.mark_organization_claimed_on_verification();
