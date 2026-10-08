-- Sea N Shore learning round A: in-app notification types for learning events.
-- Additive and safe to run more than once.
-- Kept apart from 0070 because a new enum value cannot be used in the transaction that
-- adds it.

alter type public.network_notification_type add value if not exists 'learning_enrolled';
-- statement-breakpoint

alter type public.network_notification_type add value if not exists 'learning_lessons_released';
-- statement-breakpoint

alter type public.network_notification_type add value if not exists 'learning_assignment_graded';
-- statement-breakpoint

alter type public.network_notification_type add value if not exists 'learning_certificate_issued';
-- statement-breakpoint

alter type public.network_notification_type add value if not exists 'learning_course_approved';
-- statement-breakpoint

alter type public.network_notification_type add value if not exists 'learning_course_changes_requested';
-- statement-breakpoint

alter type public.network_notification_type add value if not exists 'learning_submissions_to_grade';
