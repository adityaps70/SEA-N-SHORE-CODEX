create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  target_type text not null,
  target_id uuid not null,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null,
  details text,
  status text not null default 'open',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  reviewer_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_reports_target_type_check check (
    target_type in ('post', 'comment', 'job', 'event')
  ),
  constraint content_reports_reason_check check (
    reason in (
      'spam',
      'scam',
      'misinformation',
      'harassment',
      'hate_or_abuse',
      'unsafe_or_illegal',
      'recruitment_fee',
      'fake_company',
      'misleading_salary',
      'false_vacancy',
      'suspicious_communication',
      'inappropriate_content',
      'other'
    )
  ),
  constraint content_reports_details_check check (
    details is null or char_length(details) <= 4000
  ),
  constraint content_reports_status_check check (
    status in ('open', 'reviewing', 'resolved', 'dismissed')
  ),
  constraint content_reports_reviewer_note_check check (
    reviewer_note is null or char_length(reviewer_note) <= 4000
  ),
  unique (target_type, target_id, reporter_id)
);
-- statement-breakpoint

create index if not exists content_reports_queue_idx
  on public.content_reports (status, updated_at desc, target_type, target_id);
-- statement-breakpoint

create index if not exists content_reports_target_idx
  on public.content_reports (target_type, target_id, status, updated_at desc);
-- statement-breakpoint

create table if not exists public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  target_type text not null,
  target_id uuid not null,
  report_id uuid references public.content_reports(id) on delete set null,
  action text not null,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint moderation_actions_target_type_check check (
    target_type in ('post', 'comment', 'job', 'event')
  ),
  constraint moderation_actions_action_check check (
    action in ('reviewing', 'dismiss', 'resolve', 'remove', 'restore')
  ),
  constraint moderation_actions_note_check check (
    note is null or char_length(note) <= 4000
  )
);
-- statement-breakpoint

create index if not exists moderation_actions_target_idx
  on public.moderation_actions (target_type, target_id, created_at desc, id desc);
-- statement-breakpoint

insert into public.content_reports (
  id,
  target_type,
  target_id,
  reporter_id,
  reason,
  details,
  status,
  reviewed_by,
  reviewed_at,
  reviewer_note,
  created_at,
  updated_at
)
select
  jr.id,
  'job',
  jr.job_id,
  jr.reporter_id,
  jr.reason,
  jr.details,
  jr.status,
  jr.reviewed_by,
  jr.reviewed_at,
  null,
  jr.created_at,
  coalesce(jr.reviewed_at, jr.created_at)
from public.job_reports jr
on conflict (target_type, target_id, reporter_id) do nothing;
