-- Round DB (Deploy B): the final-reminder summary looks legacy claims up by lower(email) for claimed rows and counts
-- every claim of an email, but the only lower(email) index on legacy_profile_claims is partial (unclaimed rows only),
-- so each invite read the whole table (837M rows read over 180k scans in the 11 Nov report, 82% of 7-day DB load).
-- This index serves all three lookups; profile_id and claimed_at let the count and the claimed check read the index
-- alone. Built concurrently by the guarded concurrent-index step (round-db-indexes-migration), outside a transaction.
-- Reversible: drop index concurrently public.legacy_profile_claims_email_lookup_idx.
-- statement-breakpoint
create index concurrently if not exists legacy_profile_claims_email_lookup_idx
  on public.legacy_profile_claims (lower(email), claimed_at, profile_id);
