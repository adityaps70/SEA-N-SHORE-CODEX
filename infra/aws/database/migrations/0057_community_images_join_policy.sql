-- Sea N Shore round 9C: community profile photos, organization-owned communities and a
-- per-community join setting. Additive and safe to run more than once.
--
-- 1. community_groups.icon_path: the community profile photo (cover_path already holds the banner).
-- 2. community_groups.owner_company_id: set when an organization (Organization Pro) owns the
--    community; created_by stays the member who created it.
-- 3. community_groups.join_policy: 'open' (anyone joins instantly) or 'approval' (a moderator
--    approves requests). Existing private groups keep asking for approval.
-- Roles keep their stored values ('member' | 'admin' | 'owner'); 'admin' is shown as Moderator.

alter table public.community_groups add column if not exists icon_path text;
-- statement-breakpoint

alter table public.community_groups add column if not exists owner_company_id uuid references public.companies(id) on delete set null;
-- statement-breakpoint

alter table public.community_groups add column if not exists join_policy text not null default 'open';
-- statement-breakpoint

alter table public.community_groups
  drop constraint if exists community_groups_join_policy_check;
-- statement-breakpoint

alter table public.community_groups
  add constraint community_groups_join_policy_check check (join_policy in ('open', 'approval'));
-- statement-breakpoint

-- Private groups created before this round required a moderator's approval to join.
update public.community_groups
set join_policy = 'approval', updated_at = now()
where visibility = 'private'
  and join_policy = 'open'
  and not exists (
    select 1 from public.sea_n_shore_applied_migrations applied
    where applied.name = '0057_community_images_join_policy'
  );
-- statement-breakpoint

create index if not exists community_groups_owner_member_live_idx
  on public.community_groups (created_by) where archived_at is null and owner_company_id is null;
-- statement-breakpoint

create index if not exists community_groups_owner_company_live_idx
  on public.community_groups (owner_company_id) where archived_at is null and owner_company_id is not null;
-- statement-breakpoint
