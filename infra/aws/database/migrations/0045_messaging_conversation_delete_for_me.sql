-- Sea N Shore messaging: "Delete conversation" for one participant only.
-- Safe to apply more than once. Adds a per-participant marker; nothing is
-- removed from existing conversations or messages.
--
-- cleared_before: when set, messages created at or before this moment are
-- hidden from this participant only (thread, catch-up, inbox preview, unread
-- counts). The conversation stays hidden from their inbox until a newer
-- message arrives. The other participant keeps the full history.

alter table public.conversation_participants
  add column if not exists cleared_before timestamptz;
-- statement-breakpoint
