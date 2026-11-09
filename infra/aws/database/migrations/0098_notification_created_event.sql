-- Round ARCH (Phase 5): every new notification also queues a notification.created event in the outbox, in the same
-- transaction, whichever of the app's paths wrote it. The outbox publisher adds the recipient's unread count, and the
-- realtime fan-out pushes it to the recipient's open connections only, so the bell no longer polls while connected.
--
-- Additive only: one function and one trigger. The event carries ids only (recipient and notification); never content.
-- An upsert that hits an existing row (ON CONFLICT DO NOTHING / DO UPDATE) inserts nothing and queues nothing.
create or replace function public.enqueue_notification_created() returns trigger
language plpgsql
as $$
begin
  insert into public.event_outbox (id, aggregate_type, aggregate_id, event_type, schema_version, payload, occurred_at)
  values (
    gen_random_uuid(),
    'notification',
    new.id,
    'notification.created',
    1,
    jsonb_build_object('eventType', 'notification.created', 'recipientId', new.recipient_id, 'notificationId', new.id),
    now()
  );
  return null;
end
$$;
-- statement-breakpoint
create or replace trigger notifications_enqueue_created
  after insert on public.notifications
  for each row execute function public.enqueue_notification_created();
