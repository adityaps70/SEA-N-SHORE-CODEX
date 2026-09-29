-- Sea N Shore round 9A: the in-app "your free trial ends soon" reminder (7 days and 1 day
-- before a trial ends). Additive and safe to run more than once.
-- Kept apart from 0053 because a new enum value cannot be used in the transaction that
-- adds it.

alter type public.network_notification_type add value if not exists 'plan_trial_ending';
-- statement-breakpoint
