-- Sea N Shore learning round C: the in-app notification type for course announcements.
-- Additive and safe to run more than once.
-- Kept apart from 0075 because a new enum value cannot be used in the transaction that
-- adds it.

alter type public.network_notification_type add value if not exists 'learning_announcement';
-- statement-breakpoint
