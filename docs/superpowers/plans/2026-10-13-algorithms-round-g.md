# Algorithms round G: feed, people you may know, jobs and alerts, search, suggestions, notifications, digest

The owner read a late-September copy of the ranking code on 13 October. Everything is simple rules, nothing learns
from what members do, and nothing records what they see. This round keeps everything explainable and rule-based in
our own Postgres (no ML, no vector database, no paid search or recommendation service).

Delivery: hotfix (PR 0, deploy 0), Release 1 (PR 1 = G0, PR 2 = G1 + G2, deploy 1), Release 2 (PR 3 = G3 + G4,
PR 4 = G5 + G6 + Ranking health, deploy 2). At most one guarded migration per release.

## Step 0: findings checked against the code (HEAD `b4783f77`)

| Area | Finding | Verdict | Evidence |
| --- | --- | --- | --- |
| Feed | `order by p.created_at desc`; the only ranking is `prioritizeRecentFeedRows` inside each 12-post page | Still true | `feed/repository.ts:472` (`listFeedRows`, 422-476). `feed/ranking.ts:1-17`, applied per page in `feed/queries.ts:199-206`. Group and hashtag feeds skip it. |
| Feed | Reactions, comments and age unused; no impressions, seen tracking or mute table | Still true | No such tables. The only "mute" is `messaging` `muted_at` (`0014_messaging.sql:45`), a chat mute. |
| Feed | Reposts not de-duplicated | Still true | The client dedupes by post id (`feed-list.tsx:74-79`); `posts_active_repost_unique_idx` (`0015:32-34`) only stops one author reposting twice. |
| Feed | 4 reaction subqueries, comment count, poll counts per post; `getComments` loads every comment | Partly true | The 4 reaction counts are one `count(*) filter` pass now (`repository.ts:186-196`, round 14). Comment count (`:242`) and per-option poll counts (`:178`) are still correlated subqueries, plus media, mentions, hashtags and tags. `getComments` (`:801-872`) loads every comment of every post on the page with no limit. Side finding: it has no block filter on comment authors. |
| Feed | Page 1 rebuilt every 30 s, even in background tabs | Still true | `feed-list.tsx:112-138` (`setInterval(…, 30_000)`, full `loadFeedPage`), no visibility check. The realtime provider also calls `router.refresh()` on `feed.post_created` (`realtime/provider.tsx:150-158`). |
| Feed | No caching; the rule against old connection posts dominating is not implemented | Still true | The rule is in the My Network spec (`2026-09-02-my-network-v1-design.md:480-492`), not the home feed spec. |
| PYMK | Candidates are the 60 most recently updated profiles, scored in JS by yes/no matches | Still true | `profiles/repository.ts` `getDiscoveryCandidates` (`order by p.updated_at desc … limit 60`); weights vessel 6, skill 5, trading 4, rank 3, type 2, location 1 in `network/recommendations.ts`. |
| PYMK | Mutuals, companies, past vessels, institution unused | Still true | Same scorer. |
| PYMK | Pending requests and followed people still suggested; no dismiss | Still true (live bug) | `network/queries.ts` Discover only filtered `connected`. The X on a card hid it locally until reload. |
| PYMK | Organisation profiles take slots, filtered only in the UI | Still true | `feed-discovery-rail.tsx:5`, `feed-people-row.tsx:14`. |
| PYMK | Avatars and covers signed for all 60 candidates | Still true | `profiles/aws-queries.ts` `hydrateProfiles`. |
| Jobs | Only 60 jobs scored (urgent, verified, newest), offset always 0 | Still true | `jobs/queries.ts:24` `searchJobs(filters, 60, 0)`; order at `jobs/repository.ts:404-410`. |
| Jobs | Unspecified requirement gets full points; no-requirement job scores 100 | Fixed | `jobs/matching.ts:15-18`, `:284-286` (score is `null` with nothing specified). |
| Jobs | Availability gives everyone 10 points | Fixed | `MATCH_WEIGHTS` (`matching.ts:27-34`) has no availability weight. |
| Jobs | Skills fetched but ignored | Partly true | Used only for shore jobs without accepted roles (`matching.ts:188-206`). |
| Jobs | Rank matching exact string | Fixed | Ladder distance on taxonomy keys (`matching.ts:96-134`). |
| Jobs | Certificate matching exact string | Still true | `matching.ts:243` (case-insensitive equality). Vessel types, visas, regions too. |
| Jobs | Applied jobs not pushed down; `job_alerts` never sent | Still true | `jobs/queries.ts:43-49`; `job_alerts` (`0010:97-111`) has CRUD only, nothing reads `last_sent_at`. |
| Search | People: same 60 pool, `LIKE '%token%'`, sorted by PYMK score | Still true | The LIKE runs in SQL before the limit (`profiles.search_text`), then the 60 newest matches are re-sorted by the PYMK score. Side finding: a second JS filter (`network/queries.ts` `matchesNetworkSearch`) checks fewer fields than `search_text` and drops some matches. |
| Search | Orgs ilike by verified then name; courses ilike no limit; events ilike; jobs FTS `simple` | Still true | `organizations/repository.ts:542-553`; `learning/marketplace-repository.ts:186-221`; `events/calendar-repository.ts:322-364`; `jobs/repository.ts:350-358`. |
| Search | Posts not searchable; no typo tolerance; no search log | Still true | `search/search-filters.ts:4`. |
| Suggestions | Discover organizations same for everyone | Partly true | Global ranking (verified, `follower_count`), but it already leaves out member and followed orgs (`organizations/workspace-repository.ts:527-544`). |
| Suggestions | "Pages people also viewed" uses no viewing data and includes followed pages | Still true | `workspace-repository.ts:501-523`. |
| Suggestions | Events chronological; courses newest first | Still true | `calendar-repository.ts:362`; `marketplace-repository.ts:217`. |
| Notifications | Not grouped; Jobs chip always empty; nothing picks top content for email | Still true | `notifications/repository.ts:59-75`; `notifications/filters.ts:6-7,21`. |

**Communities now.** `community_groups` (`0055`) with `visibility` `public | private`, `join_policy` `open | approval`
(`0057`), `category` (8 values, `0061`) and `owner_company_id`. Membership is `community_group_memberships`
(role `member | admin | owner`, status `active | pending | removed`); a join request is a `pending` row. Suggestions
are fixed regex rules on rank, vessel type and persona (`community/suggestions.ts:18-28`). Private groups appear in
the directory and search, without their posts.

**Post visibility (Round F).** `posts.audience` `anyone | members` (default `members`, `0082`). Community posts are
always members only. Signed in, `visibilitySql` (`feed/repository.ts:312-335`) applies blocks, inactive authors,
private-community membership and repost sources; `audience` only gates signed-out access.

**Scheduled jobs today.** No scheduler infrastructure (no EventBridge Scheduler, no cron Lambda, no cron route). Every
periodic job is a time-gated sweep in the outbox worker's loop (`scripts/workers/publish-outbox.ts`, ECS service
`sea-n-shore-staging-outbox-worker`, one task): retention, newsletter, legacy invites and reminders, Resend
backfill, billing, learning emails, digest and session reminders, tax documents. There are no calendar event
reminders. G2, G3 and G6 add sweeps to the same loop.

**Flags.** No flag mechanism exists (only environment variables). Round G adds one DB settings table in PR 1.

**Email.** All app email goes through Resend (`src/lib/email/resend.ts`) with RFC 8058 one-click unsubscribe. SES is
used only for the legacy newsletter contact-list sync and the trial reminder. The SES sending quota is not recorded
in the repository.

## Hotfix (PR 0): People you may know shows people already asked

**Root cause.** Discover loaded the 60 most recently updated profiles, scored them in JS, and dropped only accepted
connections. Pending requests (either way), follows and organisations stayed, and they also used up the 60 slots.

**Fix** (no migration):

- One SQL query, `getPeopleSuggestions` (`profiles/repository.ts`), runs over every eligible member and excludes,
  before the limit: the viewer; any connection row with the viewer (accepted, or pending either way: received
  requests belong in Invitations); members the viewer follows; blocks either way; organisation and company
  profiles; inactive, not onboarded and synthetic test profiles (the `isSyntheticDiscoveryText` markers as a Postgres
  regex); and members whose request from the viewer is gone (declined or withdrawn) within 180 days.
- Declined requests: a declined request deletes its `connections` row, so the only record is the request event in
  `social_action_events`. Those rows were pruned after 8 days; connection-request rows are now kept 181 days
  (`CONNECTION_REQUEST_EVENT_RETENTION`, `social/quotas.ts`). The quota windows only count recent rows, so no limit
  changes. Requests declined more than 8 days before this deploy are already gone and are not hidden. There is no
  "ignore" action: an unanswered request stays pending and is excluded as pending. A withdrawn request is treated
  like a declined one (the two leave the same record).
- Order: the existing shared-attribute weights (now computed in SQL, `RECOMMENDATION_WEIGHTS`), then most recently
  updated. Only the returned cards' avatars are signed; covers are not signed for suggestion cards.
- Every list uses it: the Home rail, the phone feed row, /network Discover, and the rails on /profile, /activities
  and other members' profiles (which also leave out the member being viewed). A search on Discover and the search
  page's People results keep the search behaviour (they can find connections).
- Instant replacement: each surface loads spares (rail 12, feed row 20, Discover 40; `PEOPLE_SUGGESTION_LIMITS`).
  `useSuggestionDeck` removes a card the moment Connect (or X) is pressed and the next person slides in; a refused
  request brings the card back in place with the error. The rail cards gained a Connect button. Focus moves to the
  replacement card's Connect button, and a polite live region announces the change. The phone feed rows share one
  deck, so a person connected in one row leaves every row.
- Empty state: "You've seen everyone we can suggest for now", with Invite colleagues (shares the site link, like
  profile sharing) and Search people (`/search?type=people`). The phone feed shows it once.

**Tests.** `network/people-suggestions.integration.test.ts` (real schema in PGlite): a pending request either way
never appears; connections, follows, blocks either way and organisations never appear; declined within 180 days
hidden, older shown; inactive and synthetic excluded before the limit; after 5 requests the other 3 eligible
members fill the rail; nobody eligible returns nothing. Component tests: 5 Connects in a row still show 3 new
people; a refused request brings the card back with the error; the empty state; one shared deck across feed rows;
the Discover grid's Connect and X.

**Local check** (local Postgres 16 with every migration, placeholder members, stubbed sign-in): with 5 pending
requests, 1 follow and 1 connection, Home and Discover showed only the other 7; Connect replaced the rail card in
84 ms and moved focus to the next Connect; after connecting everyone, the empty state showed on /network and the
phone feed and stayed after a reload. axe (WCAG 2 A/AA) found no violations on /home and /network at 390 px and
1440 px. Screenshots: `round-g/hotfix-*.jpg`.

## Checklist

- [x] Step 0
- [ ] PR 0 hotfix: merged, deployed, rearmed, Remote Verify, live check
- [ ] PR 1: G0 + migration
- [ ] PR 2: G1 + G2
- [ ] Release 1: guarded migration, deploy, rearm, Remote Verify, flags admins → everyone
- [ ] PR 3: G3 + G4 + pg_trgm migration
- [ ] PR 4: G5 + G6 + Ranking health
- [ ] Release 2: guarded migration, deploy, rearm, Remote Verify, test alert and digest, flags
- [ ] Report
