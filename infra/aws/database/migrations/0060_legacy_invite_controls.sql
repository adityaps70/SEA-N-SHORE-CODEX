-- Add an explicit preparation/cancellation stage before legacy invitations can be sent.
-- Existing unsent zero-attempt queued records are moved back to prepared as a safety measure.

alter table public.legacy_profile_invites
  drop constraint if exists legacy_profile_invites_status_check;
-- statement-breakpoint

alter table public.legacy_profile_invites
  add constraint legacy_profile_invites_status_check
  check (status in ('prepared', 'queued', 'sending', 'sent', 'failed', 'skipped', 'cancelled'));
-- statement-breakpoint

alter table public.legacy_profile_invites
  alter column status set default 'prepared';
-- statement-breakpoint

update public.legacy_profile_invites
set status = 'prepared',
    next_attempt_at = now(),
    updated_at = now()
where status = 'queued'
  and attempts = 0
  and sent_at is null;
