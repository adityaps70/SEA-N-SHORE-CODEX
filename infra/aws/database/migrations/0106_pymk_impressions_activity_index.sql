-- Finding 7 (owner-approved, ₹0): the people-you-may-know candidate build reads each candidate's latest impression
-- (max(last_seen_at) for viewer_id = candidate). With only the global last_seen_at index, the planner walks that index
-- backwards looking for the candidate's rows and, for a member with no impressions, reads all of it: in a 3,000-member
-- test community that was 28 million buffer reads per build (142 million at 4x the impressions), almost all of the
-- statement's cost. This index makes each lookup one short index probe: about 6,500 buffer reads per build at either
-- size, with the same rows returned. The query itself is unchanged. Built concurrently by the guarded
-- concurrent-index step (pymk-index-migration), outside a transaction.
-- Reversible: drop index concurrently public.post_impressions_viewer_last_seen_idx.
-- statement-breakpoint
create index concurrently if not exists post_impressions_viewer_last_seen_idx
  on public.post_impressions (viewer_id, last_seen_at desc);
