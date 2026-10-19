-- Recruiter messaging exception (Oct 2026, approved by the owner). A verified recruiter, or a hiring member of a
-- verified organization, may start a conversation with a member on "connections only" when the member applied to
-- one of their jobs (about that application) or switched on "open to recruiters". A block and "Nobody" still refuse.
--
-- One row per conversation started that way: who started it, with whom, why, and for which application. The app
-- counts a recruiter's rows of the last 24 hours to cap new recruiter conversations at 20 a day, shows the reason
-- line ("Sent because you applied to ..." / "Sent because you're open to recruiters") above the recruiter's first
-- message, and lets either side keep writing in that conversation.
--
-- Additive only: one new table and one index; nothing existing is changed or deleted.
create table if not exists public.recruiter_conversations (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  recruiter_profile_id uuid not null references public.profiles(id) on delete cascade,
  member_profile_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (reason in ('applied', 'open_to_recruiters')),
  job_application_id uuid null references public.job_applications(id) on delete set null,
  job_id uuid null references public.jobs(id) on delete set null,
  created_at timestamptz not null default now(),
  check (recruiter_profile_id <> member_profile_id)
);
-- statement-breakpoint
create index if not exists recruiter_conversations_recruiter_created_idx
  on public.recruiter_conversations (recruiter_profile_id, created_at desc);
