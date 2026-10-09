-- Sea N Shore learning round B: in-app notification types for graded quiz answers and expiring certificates.
-- Additive and safe to run more than once.
-- Kept apart from 0073 because a new enum value cannot be used in the transaction that
-- adds it.

alter type public.network_notification_type add value if not exists 'learning_quiz_graded';
-- statement-breakpoint

alter type public.network_notification_type add value if not exists 'learning_certificate_expiring';
