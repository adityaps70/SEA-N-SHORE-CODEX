-- Sea N Shore round 9B: notification types for community groups and tagging.
-- Additive and safe to run more than once. Kept apart from 0055 because a new enum value
-- cannot be used in the transaction that adds it.

alter type public.network_notification_type add value if not exists 'group_join_request';
-- statement-breakpoint
alter type public.network_notification_type add value if not exists 'group_join_approved';
-- statement-breakpoint
alter type public.network_notification_type add value if not exists 'group_post';
-- statement-breakpoint
alter type public.network_notification_type add value if not exists 'organization_mention';
-- statement-breakpoint
alter type public.network_notification_type add value if not exists 'photo_tag';
-- statement-breakpoint
