-- Sea N Shore site fixes round F: the in-app notification sent to an organization's owners and
-- administrators when a member leaves. Additive and safe to run more than once.
-- Kept apart from 0082 because a new enum value cannot be used in the transaction that adds it.

alter type public.network_notification_type add value if not exists 'organization_member_left';
-- statement-breakpoint
