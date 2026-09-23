alter table public.content_reports
  drop constraint content_reports_target_type_check;
-- statement-breakpoint
alter table public.content_reports
  add constraint content_reports_target_type_check check (
    target_type in ('post', 'comment', 'job', 'event', 'profile')
  );
-- statement-breakpoint
alter table public.content_reports
  drop constraint content_reports_reason_check;
-- statement-breakpoint
alter table public.content_reports
  add constraint content_reports_reason_check check (
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
      'impersonation',
      'spam_or_scam',
      'fake_profile',
      'other'
    )
  );
-- statement-breakpoint
alter table public.moderation_actions
  drop constraint moderation_actions_target_type_check;
-- statement-breakpoint
alter table public.moderation_actions
  add constraint moderation_actions_target_type_check check (
    target_type in ('post', 'comment', 'job', 'event', 'profile')
  );
