-- Round 14 (3.10): the outbox worker claims a batch with a short lease (claimed_until) in its own
-- short statement, calls EventBridge with no transaction or connection held, then marks the
-- results. A row whose lease has lapsed (a worker died mid-batch) becomes claimable again.
-- Additive only: one nullable column with no default, so the ALTER is a metadata-only change.
-- The existing partial index event_outbox_unpublished_idx (occurred_at, id) where published_at is
-- null already serves the claim query, so no new index is needed.
alter table public.event_outbox add column if not exists claimed_until timestamptz;
