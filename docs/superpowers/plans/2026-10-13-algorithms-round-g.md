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

## Release 1, PR 1: G0 foundation and the release 1 migration

**Migration `0083_algorithms_round_g`** (one guarded runner, `round-g-release-1-migration`). It is additive only: new
tables, functions, triggers, indexes, nullable columns and seed rows. Backfills run in the app, never in the migration.

- **Taxonomy (G0.1)**:
  - `maritime_ranks` (100 rows, seeded word for word from the round-12 role list in `features/roles/taxonomy.ts`),
    `vessel_types` (22) and `certificate_types` (34, including COC grades with the rank each allows).
  - A contract test keeps the seed identical to the code.
  - `taxonomy_normalize()` (case, dot and space insensitive, the same as the app's matcher), the `taxonomy_terms` view,
    and `taxonomy_code()` / `taxonomy_codes()`.
  - Nullable code columns:
    - `maritime_profiles.vessel_type_codes` and `available_from` (G3);
    - `profile_experiences.rank_code` and `vessel_type_code`;
    - `profile_credentials.certificate_type_code`;
    - `jobs.vessel_type_codes`;
    - `job_certificate_requirements.certificate_type_code`.
  - Rank codes already exist as `profiles.role_key` and `jobs.accepted_role_keys`.
  - BEFORE triggers fill codes from the text on every insert and edit.
  - The outbox worker backfills older rows once a day in batches of 500 (`taxonomy/backfill.ts`).
  - Unmapped values are listed (value and count only) on Admin › Ranking. The runner's apply run prints their totals.
- **Signals (G0.2)**:
  - `post_impressions`: primary key (viewer, post), at most one update per hour, no IP or user agent, 180-day
    retention.
  - `suggestion_dismissals` (180 days), `user_mutes`, `feed_feedback`, and `search_queries` (90 days).
  - `post_stats` (reactions, comments, reposts, last engaged), kept by triggers and backfilled once in the
    migration.
- **Switches and preferences**:
  - `ranking_settings`: one row per area, `off | admins | everyone`. Feed and people start as `admins`.
  - `member_preferences`: feed mode, visits, and the two privacy switches.
  - `feed_sessions`, `people_suggestions` and `ranking_metrics_daily`. Indexes for reposts, reactions by member,
    institute and company text.
- **Runner**:
  - The plan run (read only) prints `ROUND_G_SIZING` (member, post, job, connection, reaction and comment counts)
    and `ROUND_G_HOTFIX_ADMIN_ELIGIBLE_SUGGESTIONS` (per administrator, numbered, counts only).
  - The apply run checks 14 tables, the taxonomy counts, 8 triggers, the `post_stats` backfill and the switches. It
    then prints `ROUND_G_UNMAPPED_TAXONOMY_VALUES`.

**Code**:

- **Ranking module** `src/features/ranking/`:
  - weights per area (`feed-weights.ts`, `people-weights.ts`, each with a version);
  - `switches.ts`: reads `ranking_settings` every 30 s and fails closed to `off`; `admins` means `user_roles`
    administrator;
  - Admin › Ranking: the switches (audited `ranking.mode_changed`) and the unmapped taxonomy values;
  - scorers return `{ score, reasons, parts }`; administrators see the parts with `?rankdebug=1`.
- **Impressions**:
  - `POST /api/feed/impressions` (same-origin, 60 a minute per member);
  - `ImpressionTracker`: ≥50% visible for ≥1 s, sent in about 5 s batches, and always flushed with `sendBeacon` on
    `pagehide` and when the tab is hidden;
  - every feed list tracks.
- **Taxonomy pickers**:
  - experience title and vessel type, and credential name, use a native searchable list that still accepts other
    text;
  - profile vessel types become chips picked from the list (same comma field, so validation is unchanged).
- **Settings**: Settings › Blocked & muted lists muted members and organizations with Unmute.
- **Worker**: the outbox worker runs the ranking sweeps (signal retention hourly, taxonomy backfill daily). They wait
  until migration 0083 exists.

## Release 1, PR 2: G1 Top for you and G2 People you may know

**G1 Top for you**:

- **Candidate query** (`ranking/feed-candidates.ts`, one statement):
  - network posts (connections, people and organizations followed, communities, own post pinned 10 minutes);
  - 2nd-degree posts (posts connections commented on or reposted);
  - discovery: well-engaged posts by members in the same department, rank band, vessel group or persona;
  - the feed's visibility rules, hides and mutes;
  - seen or engaged content (impressions, reactions, comments, reposts, poll votes, saves, hides) is excluded at
    the content level, so a repost and its original count as one.
- **Scoring** (`ranking/feed-scorer.ts`):
  - score = relationship (+ up to 0.5 for authors engaged with in 30 days: reactions, comments, direct messages)
    × (0.6 + relevance) × engagement quality × freshness × penalties;
  - diversity, repost collapse with "X and N others reposted", and pinning the member's own new post.
- **Snapshots** (`ranking/top-feed.ts`, `feed_sessions`):
  - one snapshot per visit, 120 posts, 15 minutes; the cursor is a position in it;
  - a reload starts a new visit; a new snapshot in the same visit leaves out what was already served;
  - posts served last visit but not seen drop below position 5;
  - fallback order: 7 → 14 → 30 days, then 90 and 180 days, then a weighted-random mix from outside the network
    (a different shuffle per visit), then "caught up".
- **Home page** (`HomeFeed`):
  - a "Top for you · Recent" switch, remembered in `member_preferences`;
  - Top for you loads in the browser, so the page refresh after a reaction never builds a new snapshot;
  - "N new posts" is a count every 60 s, paused while the tab is hidden, never a page refetch;
  - stage dividers, the cold-start card and the "You're all caught up" card (switch to Recent, find pages, join
    communities).
  - Recent is newest first with mutes, repost collapse and a "New since your last visit ends here" divider.
- **Post ⋯ menu**: "Why am I seeing this?" (one or two plain reasons), "Show less like this", "Mute <name>" (Undo),
  and "Hide post".
- **Performance**:
  - feed pages load the top 2 comments, with "View all N comments" on demand;
  - comment counts come from `post_stats`;
  - media is signed only for the returned posts.
- **Switch**: `ranking_settings.feed` = `off` restores the old order (v1) exactly.
- **Not applicable**:
  - posts have no jobs category, so the "jobs posts only for find_jobs" rule does not apply;
  - there is no connections-only audience (only `anyone | members`);
  - profile visits are not tracked, so the engaged-author bonus uses reactions, comments and messages.
- **Release 2 items**: the "Jobs for you" card (G3) and the page and community suggestions in the cold-start and
  caught-up cards (G5).

**G2 People you may know** (`ranking/people-*.ts`):

- **Precompute**:
  - `people_suggestions` holds up to 60 rows per member;
  - sources: mutual connections (4 each, capped at 24), shipmates (18; same normalised vessel name and overlapping
    dates; there is no IMO number), current company (12) and past company (6, +2 for overlapping years), institute
    (8; there is no graduation year), shared communities and organizations (4), events (3), courses (1), and
    profile match on rank within 1 or 2 ladder steps, vessel group, trading area, city and country;
  - cadets also see a few trainers and recruiters;
  - multipliers for activity, profile quality and new members.
- **Exclusions**: everything from the hotfix, plus dismissals (180 days) and the opt-out. They are re-checked live
  when the list is read.
- **Reasons**:
  - one line per card: "12 mutual connections", "Sailed on <vessel> together", "Also at <company>", "Same
    institute: …";
  - the vessel is named only when both sea-service records show one, otherwise "You may have sailed together";
  - events and courses add points but are never the reason (attendance and enrolment are not always visible).
- **Diversity**: in the top 5, at most 2 from one company and at least two sources.
- **Refresh**:
  - nightly from the outbox worker at 02:00 IST, 25 members per loop pass, and straight away when the table is
    empty;
  - also right after accepting a connection, finishing onboarding, or saving the rank or maritime section;
  - Connect, follow, block and X delete the row at once.
- **Fill**: the list is always filled; live profile matching tops it up when the precomputed rows run out.
- **Cards**:
  - the X on every card persists a dismissal for 180 days (and comes back with an error if the save fails);
  - /network Discover is grouped: Mutual connections · Shipmates · From your company · From your institute ·
    Similar rank, each with "See all", then "More people you may know" and a link to People you follow;
  - member profiles show "People similar to <name>" (same rank band, vessel group or company).
- **Privacy**: Settings › Privacy has "Show me in People you may know" (default on; turning it off removes the
  member from every list at once) and "Let recruiters find me as open to work" (default off; seafarers and shore
  professionals only; used by G3).
- **Switch**: `ranking_settings.people` = `off` restores the hotfix behaviour.

**Performance** (local Postgres 16, 5,000 members, 51,800 posts, 259k reactions, 60k comments, 36k connections, 15k
sea-service records; no production data):

- **Feed** (query layer, 50 members):
  - Top first page (new snapshot): p50 130 ms, p95 193 ms;
  - next pages: p50 12 ms, p95 16 ms;
  - Recent: p50 111 ms, p95 145 ms;
  - target: under 400 ms;
  - the candidate query went from 4.7 s to 155 ms after materialising the pool.
- **Browser check**:
  - 23 posts were seen while scrolling;
  - none came back over 5 reloads or on a second ("phone") browser context.
- **PYMK precompute**:
  - 82 ms p50 and 115 ms p95 per member (it was 4.2 s before a regex pre-check and a partial-index predicate);
  - the full nightly run for 5,000 members took 401 s (77 ms p50, 107 ms p95, 300,000 rows stored); at 25 members
    per loop pass the worker finishes well inside the night.

## Release 2, PR 3: G3 jobs and job alerts, G4 search, and the release 2 migration

**Migrations `0084_algorithms_round_g_release_2_types` and `0085_algorithms_round_g_release_2`** (one guarded runner,
`round-g-release-2-migration`; 0084 only adds the `job_alert_match` notification type, because a new enum value
cannot be used in the transaction that adds it). Additive only.

- **G3**:
  - `job_alerts.last_checked_at`;
  - `job_alert_deliveries` (a job is sent once per alert);
  - `member_email_topics` (`job_alerts`, `weekly_digest`; a missing row means on);
  - `ranking_emails` (the send queue; the row id is the unsubscribe token).
- **G4**:
  - `pg_trgm` (already on since 0063; `create extension if not exists` is a no-op);
  - `search_documents` (kind, entity, name, normalised name, subtitle, `tsvector`, popularity, visibility, owner,
    organisation, community, slug, avatar);
  - indexes: btree `(kind, normalized_name text_pattern_ops)`, GIN trigram on `normalized_name`, GIN on `tsv`;
  - one set-based refresh function per kind, triggers on profiles, maritime profiles, companies, communities, jobs,
    courses, events, posts and post hashtags, and a one-time backfill (4.6 s for 5,000 members and 51,800 posts
    locally);
  - a removed or hidden source keeps its row as `hidden` (excluded everywhere); the worker clears those after a day.
- **Switches**: `jobs`, `job_alerts`, `search`, `suggestions`, `notifications` and `weekly_digest` start at `admins`.

**G3 jobs** (`ranking/job-weights.ts`, `ranking/job-scorer.ts`; `ranking_settings.jobs`):

- **Score**:
  - only criteria the job specifies count;
  - score = points earned / points possible × 100 × specificity (1 criterion 0.75, 2 → 0.9, 3+ → 1), so a job with
    0 or 1 criteria is never Strong;
  - shown as Strong, Good or Partial match, with no %.
- **Criteria**:
  - rank 25 (exact or between accepted ranks), 15 at one ladder step;
  - vessel type 20 (half for the same vessel group), from the profile and sea-service history;
  - certificates 20 by taxonomy code (verified 1, self-reported 0.75; a higher COC grade covers a lower one);
  - sea time 15 in rank or on the vessel type;
  - availability 10 (the new "Available from" date against the joining window);
  - skills 10 and location 5 for shore jobs;
  - visas 10 (proportional);
  - trading area 5.
- **Not eligible** (ordered below every eligible job, labelled "Not eligible: needs X", never hidden): a rank more than
  one step away or in another department, a required COC missing or expired, a required visa missing.
- **Jobs for you**:
  - the SQL prefilter (department, then rank band, then vessel group, then newest) scores up to 300 open jobs;
  - match × freshness (half-life 14 days);
  - applied jobs move to an "Applied" section; "Not interested" (with Undo) hides a job for 180 days;
  - 20 per page with Previous and Next; other sorts page in SQL.
- **Apply gate**: the employer's minimum-match gate keeps using the round-12 score that the server enforces. A job that
  gate refuses is shown as "Not eligible: below this job's minimum match (N%)" and sorts with the not-eligible jobs, so
  a card never says Strong match next to a button the member cannot use. Alerts, the digest and suggested candidates
  leave such jobs out (`ranking/job-match.ts`).
- **Job alerts** (`ranking/job-alerts.ts`, from the outbox worker every 15 minutes, from 02:00 UTC):
  - daily (the old "instant" is treated as daily) or weekly on Mondays;
  - new jobs since the last email that match the alert's filters and that the member is eligible for, best first, at
    most 10;
  - nothing new, no email;
  - one transaction queues the email, records each job as delivered, adds the `job_alert_match` notification (the
    Notifications Jobs chip now shows these) and moves the pointers;
  - sent through the existing Resend client with suppression, a "Job alerts" topic, one-click unsubscribe
    (`/api/email/unsubscribe`) and a Settings toggle.
- **Strong-match push**: not built, because the site has no web push.
- **Recruiters**:
  - applicants sort by Best match (default; eligible first) or Newest, with reason chips;
  - "Suggested candidates" lists only members who turned on "Let recruiters find me as open to work", scored without
    their visas (visas never show on a profile), with Connect or Message (messaging is for connections only; no contact
    details).

**G4 search** (`features/search/`; `ranking_settings.search`):

- **Relevance**:
  - exact name, then name starts with the query, then a typo match on the name (pg_trgm word similarity 0.5), then
    full text (headline, rank, company, vessel types, descriptions, post text in `english`, names and codes in
    `simple`);
  - rank and vessel synonyms ("2/O", "C/E", "ETO") match through code tokens;
  - then boosts for connections, 2nd degree, verified and recently active.
- **Privacy in the same statement**:
  - every candidate is re-checked against its source's own visibility (open jobs, listable organisations, published
    courses, upcoming events, the feed's post rules including private communities, hides and mutes);
  - blocked members never appear, in either direction.
- **One statement per keystroke**:
  - bounded LATERAL branches per kind;
  - a prepared statement (planning cost more than running);
  - JIT off (JIT compile was about 300 ms);
  - `statement_timeout` 300 ms; a timeout returns what is ready (`partial`), never a 500.
- **Dropdown** (`GET /api/search/suggest`):
  - up to 3 people, 2 organisations, 2 communities, 2 jobs and 1 course or event;
  - organisations, communities and courses are cached per query for 45 s;
  - 10 a second and 120 a minute per member, 429 above that;
  - queries up to 80 characters.
- **Client** (`search-client.ts`): 120 ms debounce, AbortController, a sequence number, the last 20 queries kept in
  memory, quiet back-off on 429.
- **UI**:
  - the top bar is an ARIA combobox: highlighted matches, up/down/Enter/Esc, the count announced, recent searches with
    Clear all;
  - /search tabs (People, Posts, Jobs, Organizations, Communities, Courses, Events) update as you type (250 ms,
    `router.replace`), with old results kept while loading, 20 per page, and the same view on phones.
- **Admin**: "Searches with no results" (query and count, 30 days) on Admin › Ranking.
- **Load test** (local; see the PR for numbers).

## Release 2, PR 4: G5 suggestions, G6 notifications and digest, Ranking health

**G5** (`ranking/suggestion-weights.ts`; `ranking_settings.suggestions`):

- **Discover organizations**:
  - sources: current and past companies, where connections work, what they follow, open jobs for your rank band,
    training institutes for cadets, verified as the fallback;
  - one reason line and an X (Undo);
  - excludes followed, member and dismissed organisations.
- **Organization pages**: "People who follow this page also follow" (at least 3 shared followers), else "Similar
  pages" (same type, overlapping vessel group).
- **Communities**:
  - sources: persona, department or rank (Family Anchor is matched once it exists; it does not yet), connections who
    are members, communities of organisations you follow, size;
  - private communities by name, description and size only;
  - joined, requested and dismissed ones are excluded.
- **Events**:
  - a "For you" tab next to All, covering the next 60 days;
  - signals: host you follow or know, connections attending (a count), a category for your department, the same city
    or country for in-person events (online always eligible), soonest first;
  - registered, cancelled, full and dismissed events are excluded; "Full" now shows in All.
- **Courses**:
  - "Recommended for you" on Learn: a refresher for your own certificate expiring within 6 months ("Your AFF expires on
    …"), department or rank band, next rank, popular in your rank band (90 days); free courses get no boost;
  - "Learners also took" on course pages (at least 3 shared learners).

**G6** (`ranking_settings.notifications`, `ranking_settings.weekly_digest`):

- **Grouping**:
  - reactions or comments on the same post within 24 h merge ("<name> and 5 others reacted to your post"), newest avatar,
    opening the post;
  - mentions, tags, connection requests, job matches and event changes are never merged and show "Important" until
    read;
  - there are no reaction emails or push today, so there is nothing to batch.
- **Weekly digest** (`ranking/weekly-digest.ts`, from the outbox worker):
  - Monday from 08:00 in the member's time zone (IST if unknown), plus a fixed per-member 0–59 minute offset;
  - contents:
    - up to 5 unseen public posts ranked by the G1 scorer (audience "anyone", not in a community, first line only);
    - 5 eligible jobs;
    - 3 people you may know;
    - 2 events;
    - 1 course;
  - skipped below 3 items;
  - `?src=digest` links and no pixel;
  - one per member per week (dedupe key and a recorded skip);
  - a "Weekly digest" topic with one-click unsubscribe and a Settings toggle.

**MEASURE**:

- Admin › Ranking health shows 7 and 28 days of totals only:
  - feed impressions, reactions and comments per 100 impressions, and the Top or Recent split;
  - PYMK requests and dismissals per 100 listed;
  - applications by source (`?src=for_you|search|job_alert|digest`);
  - alert and digest emails sent, and visits from them;
  - the search zero-result rate.
- Test job alert and test digest buttons on Admin › Ranking.

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
