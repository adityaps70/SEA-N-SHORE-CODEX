-- Algorithms round G, release 2: the in-app notification for job alert matches (G3), so the Jobs chip on
-- Notifications has something to show. Additive and safe to run more than once.
-- Kept apart from 0085 because a new enum value cannot be used in the transaction that adds it.

alter type public.network_notification_type add value if not exists 'job_alert_match';
-- statement-breakpoint
