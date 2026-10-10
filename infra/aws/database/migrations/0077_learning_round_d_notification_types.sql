-- Sea N Shore learning round D: the in-app notification type for live session reminders.
-- Additive and safe to run more than once.
-- Kept apart from 0078 because a new enum value cannot be used in the transaction that
-- adds it.

alter type public.network_notification_type add value if not exists 'learning_session_reminder';
-- statement-breakpoint
