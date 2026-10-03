-- Sea N Shore round 7: tell attendees when an event is cancelled because its organiser
-- deleted their account. Additive and safe to run more than once.
-- Kept apart from 0051 because a new enum value cannot be used in the transaction that
-- adds it.

alter type public.network_notification_type add value if not exists 'event_cancelled';
-- statement-breakpoint
