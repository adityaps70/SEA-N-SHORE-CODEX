# Sea N Shore — My Network v1 Design

**Date:** 2026-09-02  
**Status:** Approved design, implementation pending  
**Branch:** `feature/my-network-v1`

## 1. Purpose

My Network v1 turns Sea N Shore’s existing maritime profile directory into a real professional social graph.

The release must let authenticated, onboarded members:

- follow another active completed member instantly;
- unfollow without affecting connection status;
- send a connection request;
- accept, decline, or cancel a pending connection request;
- automatically follow each other when a connection is accepted;
- remove an accepted connection;
- block and unblock another member;
- receive basic notifications for connection requests, accepted connections, and new followers;
- discover relevant maritime professionals using deterministic profile-based recommendations;
- see connected/followed people prioritized lightly in the Home feed without turning the feed into a closed network.

The design extends the existing `/network`, profile, feed, navigation, server-action, and Supabase RLS patterns rather than introducing a separate social application layer.

## 2. Fixed Product Decisions

1. **Follow is instant.** No approval is required.
2. **Connection requires approval.** A member sends a request; the recipient accepts or declines it.
3. **Accepted connection creates mutual follows.** Both directions are inserted automatically.
4. **Unfollow does not disconnect.** Connection and follow can diverge after acceptance.
5. **Removing a connection does not force unfollow.** Existing follow rows remain unless a user chooses to unfollow.
6. **Blocking is included.** Blocking removes follows and any connection/request between the pair and prevents future interaction until unblocked.
7. **Basic notifications are included.** Initial notification types are connection request, connection accepted, and new follower.
8. **Report/moderation is not included in v1.** Blocking provides immediate member-level safety while a full moderation workflow remains a later release.
9. **Recommendation logic is deterministic, not ML.** It uses existing maritime/profile signals and can evolve later without changing the graph schema.
10. **Home feed uses soft prioritization.** Connections/follows rank higher, but broader maritime content remains discoverable.
11. **Realtime notifications are not required in v1.** Server-rendered/fetched unread state is sufficient.

## 3. Existing Foundation

The current application already provides:

- authenticated app routes;
- active/completed professional profiles;
- `maritime_profiles` with rank, company, vessel, experience, vessel types, trading areas, availability, and shore-career preference;
- profile skills;
- `/network` directory cards;
- public professional profile routes;
- `/home` feed with posts, reactions, comments, saves, polls, and categories;
- desktop and mobile application navigation;
- a Bell control in the desktop header that is not yet backed by notifications;
- Supabase RLS and server-action patterns.

My Network v1 should follow those conventions and avoid unrelated refactoring.

## 4. Data Model

### 4.1 `follows`

Represents a one-way professional follow.

Columns:

- `follower_id uuid not null references profiles(id) on delete cascade`
- `following_id uuid not null references profiles(id) on delete cascade`
- `created_at timestamptz not null default now()`

Primary key:

- `(follower_id, following_id)`

Constraints:

- `follower_id <> following_id`

Indexes:

- `(following_id, created_at desc)`
- `(follower_id, created_at desc)`

Semantics:

- insert = follow;
- delete = unfollow;
- duplicate follows are impossible through the primary key.

### 4.2 `connections`

Represents one canonical relationship row for a pair of users.

Columns:

- `id uuid primary key default gen_random_uuid()`
- `user_low_id uuid not null references profiles(id) on delete cascade`
- `user_high_id uuid not null references profiles(id) on delete cascade`
- `requested_by uuid not null references profiles(id) on delete cascade`
- `status connection_status not null default 'pending'`
- `created_at timestamptz not null default now()`
- `responded_at timestamptz null`
- `updated_at timestamptz not null default now()`

Enum:

- `connection_status = pending | accepted`

Canonical pair rules:

- `user_low_id` is always the lower UUID;
- `user_high_id` is always the higher UUID;
- unique constraint on `(user_low_id, user_high_id)`;
- `requested_by` must equal one member of the pair;
- self-connections are impossible.

Declined/cancelled/removed relationships are not retained in this operational table:

- decline removes the pending row;
- cancel removes the pending row;
- remove connection deletes the accepted row;
- a future request can be sent cleanly.

Historical/audit requirements remain separate from the live social graph.

### 4.3 `user_blocks`

Represents a directional block.

Columns:

- `blocker_id uuid not null references profiles(id) on delete cascade`
- `blocked_id uuid not null references profiles(id) on delete cascade`
- `created_at timestamptz not null default now()`

Primary key:

- `(blocker_id, blocked_id)`

Constraint:

- `blocker_id <> blocked_id`

When A blocks B, one transaction must:

1. insert `A -> B` into `user_blocks` if absent;
2. delete `A -> B` and `B -> A` follows;
3. delete any pending or accepted connection between A and B;
4. remove/invalidate actionable relationship notifications between the pair;
5. prevent either side from following or connecting while the block exists;
6. hide the pair from one another in authenticated Network discovery, profile access, feed content, and people suggestions.

Unblocking removes only the block. It does **not** restore follows or a prior connection.

### 4.4 `notifications`

Stores durable in-app notification history for the recipient.

Columns:

- `id uuid primary key default gen_random_uuid()`
- `recipient_id uuid not null references profiles(id) on delete cascade`
- `actor_id uuid null references profiles(id) on delete set null`
- `notification_type notification_type not null`
- `connection_id uuid null references connections(id) on delete set null`
- `created_at timestamptz not null default now()`
- `read_at timestamptz null`

Enum:

- `connection_request`
- `connection_accepted`
- `new_follower`

Rules:

- recipients can only read their own notifications;
- recipients can only change their own `read_at` state;
- ordinary clients cannot insert arbitrary notifications for another user;
- relationship side effects create notifications atomically through tightly scoped database logic;
- deleting a connection does not erase historical accepted/follower notifications because `connection_id` uses `ON DELETE SET NULL`;
- actionable pending-request notifications are explicitly removed or invalidated when the request is cancelled, declined, accepted, or destroyed by a block.

Deduplication:

- one newly-created follow produces at most one `new_follower` notification for that follow lifecycle;
- repeated idempotent follow calls do not create duplicate notifications;
- mutual follows created automatically by accepting a connection do **not** create redundant new-follower notifications; the `connection_accepted` notification is sufficient.

## 5. Relationship Operations

Relationship mutations must be atomic. User-facing entry points remain Next.js server actions. Multi-table transitions should use narrow authenticated database functions/RPCs when a single SQL transaction is necessary.

Database functions must use least privilege, explicit `search_path`, strict caller validation, and controlled `EXECUTE` grants. Do not solve permission problems by broadly exposing `SECURITY DEFINER` functions in `public`. If elevated helper logic is genuinely required, keep helper functions in a private/unexposed schema and expose only a narrow authenticated entry point with explicit `auth.uid()` checks.

### 5.1 Follow

Input: target profile ID.

Validation:

- caller authenticated;
- caller active and onboarded;
- target active and onboarded;
- caller is not target;
- no block exists in either direction.

Effect:

- insert follow if absent;
- create `new_follower` notification only when a new follow row is actually created.

Idempotency:

- following an already-followed profile returns current state without duplicate rows or notifications.

### 5.2 Unfollow

Effect:

- delete caller-owned follow row;
- do not alter accepted connection status.

### 5.3 Send Connection Request

Validation:

- same active/onboarded/self/block checks as Follow;
- no accepted connection exists;
- no pending request exists in either direction.

Effect:

- insert canonical pending connection with `requested_by = auth.uid()`;
- create `connection_request` notification for recipient.

### 5.4 Cancel Connection Request

Allowed only when:

- connection is pending;
- caller is `requested_by`.

Effect:

- delete pending row;
- remove/invalidate associated actionable request notification.

### 5.5 Accept Connection Request

Allowed only when:

- connection is pending;
- caller belongs to the pair;
- caller is not `requested_by`;
- no block exists in either direction.

Atomic effect:

1. update connection to `accepted`;
2. set response/update timestamps;
3. insert follow A -> B if absent;
4. insert follow B -> A if absent;
5. remove/invalidate original actionable request notification;
6. create `connection_accepted` notification for original requester;
7. suppress new-follower notifications for the two automatic follow inserts.

### 5.6 Decline Connection Request

Allowed only for the recipient of a pending request.

Effect:

- delete pending connection;
- remove/invalidate request notification;
- no decline notification in v1.

### 5.7 Remove Connection

Allowed only for either member of an accepted pair.

Effect:

- delete connection row;
- existing follows remain unchanged.

### 5.8 Block

Atomic effect follows section 4.3. The operation must be idempotent.

### 5.9 Unblock

Effect:

- delete caller-owned block row;
- do not automatically re-follow or reconnect.

## 6. Row Level Security and Grants

RLS must be enabled on every exposed social table. Grants and RLS are designed together.

### 6.1 `follows`

Read access:

- authenticated active/onboarded members only where relationship state/counts/recommendations require it.

Mutation:

- INSERT only where `auth.uid() = follower_id`, target is eligible, no self-follow, and no block exists in either direction;
- DELETE only where `auth.uid() = follower_id`.

No user may follow on behalf of another user.

### 6.2 `connections`

Read:

- only members belonging to the pair can directly read raw connection rows;
- discovery/profile queries return derived relationship state without exposing unrelated connection rows.

Mutations:

- send restricted to requester;
- accept/decline restricted to recipient;
- cancel restricted to requester;
- remove accepted connection restricted to either pair member.

Prefer narrow RPCs for atomic status transitions instead of broad client UPDATE privileges.

### 6.3 `user_blocks`

Read:

- blocker can read their own block list;
- blocked user does not get direct read access to rows revealing who blocked them.

Mutation:

- caller may create/delete only rows where `blocker_id = auth.uid()`.

Block filtering must be applied in both directions in authenticated discovery/feed/profile queries without revealing which side initiated the block.

### 6.4 `notifications`

- SELECT only where `recipient_id = auth.uid()`;
- authenticated recipient receives a column-level UPDATE grant for `read_at`, not a broad UPDATE grant over notification identity/recipient/actor/type fields;
- RLS UPDATE policy still requires `recipient_id = auth.uid()` in both `USING` and `WITH CHECK` as applicable;
- ordinary authenticated/anon roles have no direct INSERT/DELETE grant;
- generation/removal of actionable notifications occurs through controlled relationship transitions.

## 7. Block-Aware Visibility

For an authenticated viewer, a block in either direction between A and B means:

- neither appears in the other’s Network Discover results;
- neither appears in the other’s Connections/Following lists;
- direct professional-profile lookup for the other returns unavailable/not-found semantics rather than revealing block metadata;
- posts by the other are excluded from Home feed results;
- the other is excluded from Home “People you may know”;
- follow/connect mutations return a generic interaction-unavailable state.

Existing unauthenticated public-profile visibility remains governed by the application’s existing public-profile rules because an anonymous viewer has no identity against which to evaluate a user-to-user block.

Blocking does not globally delete historical posts/comments; it changes cross-visibility and interaction for the blocked pair.

## 8. Network Page UX

`/network` becomes a four-tab hub.

### 8.1 Discover

Purpose: find relevant professionals.

Reuse the current profile directory visual foundation:

- avatar/initials;
- name;
- profile type;
- headline;
- location;
- rank/company where relevant;
- up to three skills;
- profile link.

Relationship controls:

- `Connect` when no connection exists;
- `Pending` + cancel for outgoing request;
- `Respond` for incoming request, exposing Accept/Decline;
- `Connected` for accepted relationship;
- independent `Follow` / `Following` control;
- overflow menu includes Block.

Blocked/current/ineligible profiles never appear.

### 8.2 Connections

Shows accepted connections.

Each card can:

- open profile;
- show Follow/Following state;
- remove connection;
- block.

### 8.3 Requests

Two sections:

- Received;
- Sent.

Received actions:

- Accept;
- Decline.

Sent action:

- Cancel.

The Requests tab displays received pending count when non-zero.

### 8.4 Following

Shows profiles the user follows, whether connected or not.

Actions:

- open profile;
- unfollow;
- connection state/action where appropriate;
- block.

## 9. Professional Profile Integration

Authenticated professional-profile views gain relationship controls:

- Follow / Following;
- Connect / Pending / Respond / Connected;
- overflow Block action.

Controls are absent on the viewer’s own profile.

Authenticated blocked-pair profile access returns unavailable/not-found semantics.

## 10. Recommendation Engine v1

Recommendations are deterministic and explainable.

Candidate pool:

- active;
- onboarding complete;
- not current user;
- no block in either direction;
- not already an accepted connection for Discover recommendation slots;
- pending relationship can be excluded or represented explicitly rather than recommended as a fresh Connect candidate.

Scoring signals:

- shared vessel type: strong positive weight;
- shared trading area: medium positive weight;
- shared skill: strong positive weight;
- compatible/similar maritime profile type: medium weight;
- same location: small positive weight;
- rank/domain relevance: medium weight;
- recent profile update/activity: small recency weight.

Use a simple weighted score in SQL/application query logic rather than ML.

Tie-breakers:

1. score descending;
2. profile updated time descending;
3. stable profile ID ordering.

Numeric weights belong in implementation constants/tests and can be tuned without schema change.

## 11. Home Feed Integration

Home remains broad maritime discovery. Posts from followed/connected members receive a modest boost.

Rules:

- retain existing eligibility/category/deletion filters;
- add block filtering;
- apply relationship boost alongside recency;
- never hard-filter to connections/following only;
- avoid allowing very old connected posts to dominate much newer relevant content;
- preserve deterministic, cursor-safe ordering.

Implementation should use a bounded relationship-priority value combined with the existing recency/cursor model, not an unbounded score that makes pagination unstable.

### 11.1 People You May Know

Home gains one compact recommendation module using the same recommendation service as `/network`.

Rules:

- 3–5 profiles maximum;
- exclude blocked/current/connected profiles;
- relationship controls available inline;
- avoid repeated placement that overwhelms feed content.

## 12. Notification Centre

### 12.1 Desktop

Upgrade the existing Bell:

- unread badge with bounded count display;
- click opens recent-notification panel;
- each item shows actor, event text, timestamp, read state;
- click marks read and navigates to destination;
- “View all” opens full notifications route.

### 12.2 Mobile

Provide a dedicated notifications page reachable from a mobile notification affordance rather than forcing the desktop popover pattern onto a small screen.

### 12.3 Destinations

- connection request -> `/network?tab=requests` (received section);
- connection accepted -> actor professional profile;
- new follower -> actor professional profile.

### 12.4 Read State

Support:

- mark one read on open;
- mark all read from the full notifications page.

Realtime subscriptions, email, and push are out of scope for v1.

## 13. Server/Application Architecture

Introduce focused feature modules rather than overloading profile files.

Suggested structure:

```text
src/features/network/
  actions.ts
  queries.ts
  mappers.ts
  schemas.ts
  types.ts
  components/
    network-tabs.tsx
    network-profile-card.tsx
    relationship-controls.tsx
    connection-request-card.tsx
    people-you-may-know.tsx

src/features/notifications/
  actions.ts
  queries.ts
  types.ts
  components/
    notification-bell.tsx
    notification-list.tsx
```

Existing profile mapping remains the authority for professional profile presentation data.

Server actions must:

- validate input through schemas;
- require authenticated user;
- invoke typed Supabase mutations/RPCs;
- map database errors to safe user-facing states;
- revalidate `/network`, affected profile route, `/home`, and notification surfaces as appropriate.

## 14. Error and Race Handling

Expected races are normal state reconciliation, not generic 500s.

Examples:

- two users send requests at nearly the same time;
- user manually follows while connection acceptance auto-follows;
- target blocks caller while caller sends a request;
- request is cancelled as recipient accepts;
- profile becomes inactive between render and action.

The database remains the source of truth. Unique constraints and transaction checks resolve races.

Safe messages include:

- “Request already sent.”
- “You’re already connected.”
- “This member is no longer available.”
- “This interaction is not available.”

Do not reveal that a specific user blocked the caller.

## 15. Database Migration Strategy

Create dedicated migration(s) for:

1. enums/tables/indexes/constraints;
2. RLS/grants;
3. private helpers / narrow RPCs / triggers for atomic transitions;
4. block-aware helpers required consistently by feed/network/profile behavior.

Migrations must:

- use explicit grants;
- enable RLS on all exposed tables;
- revoke unsafe default function execution where applicable;
- use explicit `search_path` on functions;
- avoid hard-coded generated IDs;
- align remote migration history exactly with committed filenames.

After migration:

- regenerate `src/lib/supabase/database.types.ts`;
- run Supabase security advisor;
- verify no new social-graph security findings.

## 16. Security Verification

Required abuse tests:

- cannot follow as another user;
- cannot follow self;
- cannot follow when blocked in either direction;
- cannot create duplicate follow;
- cannot read arbitrary raw connections outside own pair;
- cannot accept someone else’s incoming request;
- requester cannot accept their own request;
- recipient cannot cancel as requester;
- unrelated user cannot remove accepted connection;
- cannot block on behalf of another user;
- blocked user cannot directly read a block row revealing blocker identity;
- cannot read or mark another user’s notifications;
- cannot change notification recipient/actor/type via UPDATE;
- ordinary authenticated role cannot manufacture notifications;
- block filters authenticated profile/network/feed visibility in both directions.

## 17. Tests

### Database/RLS

Cover:

- follow/unfollow;
- duplicate follow prevention;
- send/cancel connection request;
- accept/decline;
- canonical connection-pair uniqueness;
- mutual auto-follow on accept;
- automatic follows do not create redundant follower notifications;
- unfollow preserves connection;
- remove connection preserves independent follows;
- block removes both follow directions and connection/request;
- unblock does not restore relationships;
- block prevents follow/connect;
- notification ownership and read-state restrictions;
- notification column update restrictions;
- cross-user abuse cases from section 16.

### Application

Cover:

- Discover relationship states;
- Connections tab;
- Requests Received/Sent flows;
- Following tab;
- professional-profile relationship controls;
- Bell unread count/list;
- mark-one and mark-all read;
- recommendations exclude blocked/current/connected users;
- Home feed applies relationship priority without excluding broader content;
- safe action errors;
- mobile/desktop notification navigation.

### Release Verification

Run the project’s existing verification pipeline, including:

- unit/component tests;
- TypeScript/typecheck;
- production Next.js build;
- CI;
- Supabase RLS/security tests;
- generated database type diff check;
- Vercel production deployment;
- authenticated production smoke tests for `/network`, `/home`, professional-profile controls, and notifications.

## 18. Seed/Demo Data

Use the existing synthetic maritime profiles to demonstrate the social graph after the schema is deployed.

Seed a small reviewable set:

- at least one non-connected followed profile;
- at least one accepted connection;
- at least one incoming pending request;
- at least one outgoing pending request;
- at least one notification of each supported type where feasible.

Do not leave the primary real test account blocked from a demo profile after verification because that intentionally hides content and can confuse product review.

## 19. Explicitly Out of Scope

- direct messaging/chat;
- connection request notes;
- report-user workflow;
- admin moderation queue;
- endorsements;
- profile verification badges;
- ML/embedding recommendations;
- contact importing;
- email/push notifications;
- realtime notification subscriptions;
- private follow-approval mode;
- 2nd/3rd-degree graph;
- new follower/following privacy controls beyond the existing member visibility model.

## 20. Success Criteria

My Network v1 is complete when:

1. an onboarded member can instantly follow/unfollow eligible members;
2. an onboarded member can send, cancel, accept, decline, and remove connection relationships;
3. accepting a connection reliably creates mutual follows;
4. either connected user can later unfollow without disconnecting;
5. removing a connection does not unexpectedly remove follows;
6. blocking immediately severs social relationships and removes authenticated cross-visibility across Network, profile, feed, and recommendations;
7. users receive and can read basic relationship notifications;
8. `/network` provides Discover, Connections, Requests, and Following states with accurate actions/counts;
9. professional profiles expose relationship-aware controls;
10. Home feed lightly prioritizes connected/followed professionals while retaining broader maritime discovery;
11. recommendations use existing maritime data and exclude ineligible relationships;
12. RLS prevents cross-user relationship/notification abuse;
13. CI, production build, Supabase security verification, and production smoke tests pass.

## 21. Implementation Sequence

The implementation plan should preserve this order:

1. social graph schema, constraints, RLS, RPC/transaction helpers;
2. generated Supabase types;
3. network domain types/queries/actions with tests;
4. `/network` tabs and relationship controls;
5. professional-profile integration;
6. notification centre and Bell unread state;
7. recommendations and Home People You May Know;
8. block-aware feed/profile/network filtering;
9. relationship-aware Home feed ordering;
10. demo relationship seed for review;
11. full security/CI/build verification;
12. production deployment and smoke test.

This sequence keeps security and domain correctness ahead of UI polish and prevents the social graph from becoming client-only state.