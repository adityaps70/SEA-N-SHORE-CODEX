-- Round I (I1): job share images and "Share to feed".
--
-- 1. job_shares: one row each time a job's poster (or a platform administrator) downloads, copies or shares the
--    job's share image (channel 'image') or posts it to the feed (channel 'feed', with the post). For the share
--    counts, and the feed rule: one feed share per job every 7 days (the app locks the job row, checks the last
--    feed share and inserts in one transaction). as_org: posted from the organization page.
-- 2. job_applications.source: where an application came from (job_page, search, share_image, feed_share, ...), so
--    the poster can see how many applies came from shares. Null for applications made before this release.
--
-- Additive only: one new table with two indexes, and one nullable column with an index. No existing row changes.
-- Reversible: drop table public.job_shares; alter table public.job_applications drop column source (the app built
-- before this release never reads either).
create table if not exists public.job_shares (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  shared_by uuid null references public.profiles(id) on delete set null,
  as_org boolean not null default false,
  channel text not null check (channel in ('image', 'feed')),
  post_id uuid null references public.posts(id) on delete set null,
  created_at timestamptz not null default now()
);
-- statement-breakpoint

create index if not exists job_shares_job_channel_created_idx
  on public.job_shares (job_id, channel, created_at desc);
-- statement-breakpoint

create index if not exists job_shares_post_idx
  on public.job_shares (post_id) where post_id is not null;
-- statement-breakpoint

alter table public.job_applications
  add column if not exists source text null check (source is null or source ~ '^[a-z_]{1,32}$');
-- statement-breakpoint

create index if not exists job_applications_job_source_idx
  on public.job_applications (job_id, source) where source is not null;
