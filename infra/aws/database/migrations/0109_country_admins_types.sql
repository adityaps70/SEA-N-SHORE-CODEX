-- Round GP (Global Partners), Part C: the in-app notification an organization's applicant gets when Sea N Shore (a
-- platform administrator or a country admin) approves, rejects or asks for changes to its verification.
-- Additive and safe to run more than once. Kept apart from 0110 because a new enum value cannot be used in the
-- transaction that adds it.
-- statement-breakpoint
alter type public.network_notification_type add value if not exists 'organization_review_decided';
