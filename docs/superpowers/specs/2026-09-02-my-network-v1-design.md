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

## 2. Product Decisions

The following decisions are fixed for v1:

1. **Follow is instant.** No approval is required.
2. **Connection requires approval.** A member sends a request; the recipient accepts or declines it.
3. **Accepted connection creates mutual follows.** Both directions are inserted automatically.
4. **Unfollow does not disconnect.** Connection and follow are related but independent concepts after acceptance.
5. **Blocking is included.** Blocking removes follows and any connection/request between the pair and prevents future interaction until unblocked.
6. **Basic notifications are included.** Notification types are connection request, connection accepted, and new follower.
7. **Report/moderation is not included in v1.** Blocking provides immediate member-level safety while a full moderation workflow remains a separate release.
8. **Recommendation logic is deterministic, not ML.** It uses existing maritime/profile signals and can later evolve without changing the social graph schema.
9. **Home feed uses soft prioritization.** Connections/follows rank higher, but broader maritime content remains discoverable.

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

Suggested columns:

- `follower_id uuid not null references profiles(id) on delete cascade`
- `following_id uuid not null references profiles(id) on delete cascade`
- `created_at timestamptz not null default now()`

Primary key:

- `(follower_id, following_id)`

Constraints:

- `follower_id <> following_id`

Indexes:

- `following_id, created_at desc`
- `follower_id, created_at desc`

Semantics:

- inserting the row means the follower follows the target;
- deleting the row means unfollow;
- duplicate follows are impossible via the primary key.

### 4.2 `connections`

Represents one canonical relationship row for a pair of users.

Suggested columns:

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

Canonical pair rule:

- `user_low_id` is always the lower UUID;
- `user_high_id` is always the higher UUID;
- unique constraint on `(user_low_id, user_high_id)`;
- `requested_by` must equal either member of the pair;
- self-connections are impossible.

Why declined is not persisted:

- declining removes the pending row;
- cancelling removes the pending row;
- removing an accepted connection removes the row;
- a future request can therefore be sent cleanly without accumulating historical relationship state in the operational graph.

Historical moderation/audit requirements can be handled separately through existing audit patterns if needed later.

### 4.3 `user_blocks`

Represents a directional block.

Suggested columns:

- `blocker_id uuid not null references profiles(id) on delete cascade`
- `blocked_id uuid not null references profiles(id) on delete cascade`
- `created_at timestamptz not null default now()`

Primary key:

- `(blocker_id, blocked_id)`

Constraint:

- `blocker_id <> blocked_id`

Blocking semantics:

When A blocks B, one transaction must:

1. insert `A -> B` into `user_blocks`;
2. delete `A -> B` and `B -> A` follows;
3. delete any pending or accepted connection between A and B;
4. prevent either side from following or connecting while the block exists;
5. hide the pair from each other in network discovery, profile access, feed content, and people suggestions.

Unblocking only removes the block. It does **not** restore follows or a prior connection.

### 4.4 `notifications`

Stores durable in-app notifications for the recipient.

Suggested columns:

- `id uuid primary key default gen_random_uuid()`
- `recipient_id uuid not null references profiles(id) on delete cascade`
- `actor_id uuid null references profiles(id) on delete set null`
- `notification_type notification_type not null`
- `connection_id uuid null references connections(id) on delete cascade`
- `created_at timestamptz not null default now()`
- `read_at timestamptz null`

Enum:

- `connection_request`
- `connection_accepted`
- `new_follower`

Rules:

- recipients can only read their own notifications;
- recipients can only mark their own notifications read;
- ordinary clients cannot insert arbitrary notifications for another user;
- relationship side effects create notifications atomically through tightly scoped database logic.

Deduplication:

- one follow action should create at most one `new_follower` notification for the current follow lifecycle;
- mutual follows created automatically from accepting a connection should **not** generate redundant new-follower notifications for both users; the `connection_accepted` notification is sufficient.

## 5. Relationship Operations

Relationship mutations must be atomic. Prefer narrow database functions for multi-table state transitions while keeping ordinary reads in typed Supabase queries and all user-facing entry points in Next.js server actions.

Functions must use least privilege, explicit `search_path`, strict caller checks, and controlled `EXECUTE` grants. Avoid exposing broad SECURITY DEFINER functions in `public`; if elevated database authority is required for atomic cross-table work, keep helper functions in a private/unexposed schema and expose only a narrowly scoped authenticated RPC with explicit checks.

### 5.1 Follow

Input: target profile ID.

Validation:

- caller is authenticated;
- caller profile is active and onboarded;
- target is active and onboarded;
- caller is not target;
- neither side has blocked the other.

Effect:

- insert follow if absent;
- create `new_follower` notification for target when the follow is newly created.

Idempotency:

- following an already-followed profile returns the current state without duplicate rows or notifications.

### 5.2 Unfollow

Effect:

- remove the caller’s follow row only;
- do not alter accepted connection status.

### 5.3 Send Connection Request

Validation:

- same active/onboarded/self/block checks as Follow;
- no accepted connection already exists;
- no pending request already exists in either direction.

Effect:

- insert canonical pending connection row with `requested_by = auth.uid()`;
- create `connection_request` notification for the recipient.

### 5.4 Cancel Connection Request

Allowed only when:

- connection is pending;
- caller is `requested_by`.

Effect:

- delete pending connection row;
- delete or invalidate the associated unread request notification so stale actionable notifications do not remain.

### 5.5 Accept Connection Request

Allowed only when:

- connection is pending;
- caller belongs to the pair;
- caller is not `requested_by`;
- neither side currently blocks the other.

Atomic effect:

1. update connection to `accepted`;
2. set response/update timestamps;
3. insert follow A -> B if absent;
4. insert follow B -> A if absent;
5. remove/invalidate the original actionable request notification;
6. create `connection_accepted` notification for the original requester.

### 5.6 Decline Connection Request

Allowed only for the recipient of a pending request.

Effect:

- delete pending connection;
- remove/invalidate the request notification;
- no decline notification in v1.

### 5.7 Remove Connection

Allowed only for either member of an accepted pair.

Effect:

- delete the connection row;
- existing follows remain unchanged.

This preserves the product rule that connection and follow can diverge after acceptance.

### 5.8 Block

Atomic effect described in section 4.3.

Blocking should also make existing actionable notifications involving that pair non-actionable or remove them where appropriate.

### 5.9 Unblock

Effect:

- delete caller-owned block row;
- do not automatically re-follow or reconnect.

## 6. Row Level Security

RLS must be enabled on every exposed social table.

### 6.1 `follows`

Read access should be limited to authenticated active/onboarded members only where the data is required for relationship state, counts, or recommendations.

Mutation rules:

- INSERT: `auth.uid() = follower_id`, valid target, no self-follow, no block in either direction;
- DELETE: `auth.uid() = follower_id`.

No member may create a follow on behalf of another user.

### 6.2 `connections`

Read:

- only members belonging to the pair should directly read raw connection rows;
- discovery/profile queries should return derived relationship state without exposing unrelated private connection rows.

Mutations:

- sending requires caller ownership of `requested_by` and membership in pair;
- accept/decline restricted to recipient;
- cancel restricted to requester;
- remove accepted connection restricted to either member.

Where direct table policies become too complex for atomic status transitions, use narrowly scoped authenticated RPCs with explicit checks rather than broad client UPDATE grants.

### 6.3 `user_blocks`

Read:

- blocker can read their own block list;
- blocked users do not need to be told who blocked them.

Mutation:

- blocker can create/delete only rows where `blocker_id = auth.uid()`.

All discovery/feed/profile queries must apply block filtering in both directions without exposing the block reason/source.

### 6.4 `notifications`

- SELECT only where `recipient_id = auth.uid()`;
- UPDATE only recipient-owned rows and only read state fields;
- no ordinary direct client INSERT/DELETE privileges;
- notification generation occurs through controlled relationship transitions.

## 7. Block-Aware Visibility

A block between A and B must affect all relevant user-facing queries in both directions.

When either `A blocks B` or `B blocks A` exists:

- neither appears in the other’s Network Discover results;
- neither appears in the other’s Connections/Following lists;
- direct professional-profile lookup for the other returns not found/unavailable behavior rather than revealing block metadata;
- posts by the other are excluded from Home feed results;
- the other is excluded from Home “People you may know”;
- follow/connect mutations fail with a generic interaction-unavailable message.

Blocking does not delete historical posts or comments globally; it changes what the pair can see/interact with.

## 8. Network Page UX

`/network` becomes a four-tab hub.

### 8.1 Discover

Purpose: find relevant professionals.

Card content reuses the current directory foundation:

- avatar/initials;
- name;
- profile type;
- headline;
- location;
- rank/company where relevant;
- up to three skills;
- professional profile link.

Relationship controls:

- `Connect` when no connection exists;
- `Pending` with cancel capability for outgoing request;
- `Respond` for incoming request, leading to accept/decline controls;
- `Connected` for accepted relationships;
- `Follow` / `Following` independently of connection state;
- overflow menu includes Block.

Blocked/current-user/ineligible profiles never appear.

### 8.2 Connections

Shows accepted connections ordered by useful recent activity/profile update, with search/filter refinement deferred unless existing global search work can be reused trivially.

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

The navigation/tab should display received pending count when non-zero.

### 8.4 Following

Shows profiles the user follows, including connected and non-connected members.

Actions:

- open profile;
- unfollow;
- connection state/action where appropriate;
- block.

## 9. Professional Profile Integration

Public professional profiles should gain relationship-aware controls for authenticated members:

- Follow / Following;
- Connect / Pending / Respond / Connected;
- overflow Block action.

For the owner’s own profile, these controls are absent.

Blocked-pair profile access returns unavailable/not-found semantics.

## 10. Recommendation Engine v1

Recommendations are deterministic and explainable.

Candidate pool:

- active;
- onboarding complete;
- not current user;
- no block in either direction;
- not already an accepted connection for Discover recommendation slots;
- optionally down-rank or exclude profiles with an outgoing/incoming pending request depending on UI placement.

Suggested scoring signals:

- shared vessel type: strong positive weight;
- shared trading area: medium positive weight;
- shared skill: strong positive weight;
- compatible/similar maritime profile type: medium weight;
- same location: small positive weight;
- rank/domain relevance: medium weight;
- recent profile update/activity: small recency weight.

The first implementation should use a simple weighted score in SQL/application query logic rather than opaque ML.

Tie-breakers:

1. score descending;
2. profile recently updated descending;
3. stable ID ordering for deterministic pagination.

The exact numeric weights belong in implementation constants/tests and can be tuned without a schema migration.

## 11. Home Feed Integration

Home feed remains broad maritime discovery, but posts from members the viewer follows or is connected to receive a modest ranking boost.

Recommended ordering model:

- keep existing eligibility/category/deletion/block filters;
- apply relationship boost before/alongside recency;
- never hard-filter to connections/following only;
- avoid allowing very old connected posts to dominate much newer relevant maritime content.

A simple v1 approach is a bounded relationship priority bucket combined with normal post recency.

Example conceptual priority:

1. followed/connected recent posts;
2. broader recent maritime posts;
3. older posts according to existing pagination.

Exact SQL ordering must remain stable and cursor-safe.

### 11.1 People You May Know

Home adds a compact recommendation module using the same recommendation service as `/network`.

Rules:

- 3–5 profiles maximum per module;
- exclude blocked/current/connected profiles;
- relationship controls available inline;
- do not place the module so frequently that it overwhelms feed content.

## 12. Notification Centre

### 12.1 Desktop

The existing Bell becomes interactive.

Behavior:

- unread badge with bounded count display (for example `9+` if needed);
- click opens a compact recent-notification panel;
- each item includes actor identity, event text, timestamp, and read state;
- clicking marks read and navigates to the relevant profile or Requests tab;
- “View all” opens the full notifications route.

### 12.2 Mobile

Use a dedicated notifications page accessible from mobile navigation/header affordance rather than forcing a desktop dropdown pattern onto a small screen.

### 12.3 Notification destinations

- connection request -> `/network?tab=requests` or equivalent received-request view;
- connection accepted -> actor professional profile;
- new follower -> actor professional profile.

### 12.4 Read state

Support:

- mark one notification read when opened;
- mark all read from full notifications page.

Realtime push/websocket delivery is not required for v1. Server-rendered/fetched unread counts are sufficient; realtime can be layered later.

## 13. Server/Application Architecture

Introduce a focused social/network feature module rather than adding logic to profile files indefinitely.

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

Server actions should:

- validate input through schemas;
- require authenticated user;
- invoke typed Supabase mutations/RPCs;
- map database errors into safe user-facing states;
- revalidate `/network`, affected profile route, `/home`, and notification surfaces as appropriate.

## 14. Error and Race Handling

Expected races must be treated as normal state reconciliation, not generic 500s.

Examples:

- two users send requests at nearly the same time;
- user follows while connection acceptance auto-follows;
- target blocks caller while caller sends request;
- request is cancelled just as recipient accepts;
- a profile becomes inactive between render and action.

The database is the source of truth. Unique constraints and transaction checks resolve races.

User-facing errors should be safe and concise:

- “Request already sent.”
- “You’re already connected.”
- “This member is no longer available.”
- “This interaction is not available.”

Do not reveal that a specific user blocked the caller.

## 15. Database Migration Strategy

Create dedicated migration(s) for:

1. enums/tables/indexes/constraints;
2. RLS/grants;
3. private helper functions / narrow RPCs / triggers for atomic transitions;
4. any block-aware helper used consistently by feed/network/profile policies or queries.

Migrations must:

- use explicit grants;
- enable RLS on all exposed tables;
- revoke unsafe default function execution where applicable;
- use explicit `search_path` on database functions;
- avoid hard-coded generated IDs;
- align remote migration history exactly with committed filenames.

After migration:

- regenerate `src/lib/supabase/database.types.ts`;
- run Supabase security advisor;
- verify no new social-graph security findings.

## 16. Security Verification

Release verification must include direct abuse attempts under simulated authenticated users.

Required cases:

- cannot follow as another user;
- cannot follow self;
- cannot follow blocked pair;
- cannot create duplicate follow;
- cannot read arbitrary raw connection rows outside own pair;
- cannot accept someone else’s incoming request;
- requester cannot accept their own request;
- recipient cannot cancel as requester;
- unrelated user cannot remove an accepted connection;
- cannot block on behalf of another user;
- blocked user cannot infer blocker from exposed block-table reads;
- cannot read or mark another user’s notifications;
- ordinary authenticated role cannot manufacture notifications for arbitrary recipients;
- block filters profile/network/feed visibility in both directions.

## 17. Tests

### Database/RLS tests

Cover:

- follow/unfollow;
- duplicate follow prevention;
- connection send/cancel;
- accept/decline;
- connection canonical pair uniqueness;
- auto-follow both directions on accept;
- automatic follows do not create redundant follower notifications;
- unfollow preserves connection;
- remove connection preserves independent follow state;
- block deletes both follow directions and connection/request;
- unblock does not restore prior relationships;
- block prevents follow/connect;
- notification ownership/read restrictions;
- all cross-user abuse cases from section 16.

### Application tests

Cover:

- Discover relationship states;
- Connections tab;
- Requests Received/Sent flows;
- Following tab;
- profile relationship controls;
- Bell unread count and list;
- mark-read behavior;
- people recommendations exclude blocked/current/connected users;
- Home feed applies relationship priority without excluding broader content;
- safe action error messages;
- mobile/desktop navigation behavior.

### Release verification

Run the project’s existing verification pipeline, including:

- unit/component tests;
- TypeScript/typecheck;
- production Next.js build;
- CI;
- Supabase RLS/security tests;
- database type regeneration/diff check;
- Vercel production deployment;
- authenticated production smoke test for `/network`, `/home`, profile relationship controls, and notifications.

## 18. Seed/Demo Data

The existing synthetic maritime profiles can be used to demonstrate the social graph.

After the schema is live, seed a small set of relationships that makes the UI visibly testable without compromising security:

- at least one non-connected followed profile;
- at least one accepted connection;
- at least one incoming pending request;
- at least one outgoing pending request;
- at least one notification of each supported type where feasible.

Do not seed a block involving the primary real test account unless explicitly needed for a reversible verification case, because blocking intentionally hides content and could confuse product review.

## 19. Explicitly Out of Scope for v1

The following are intentionally deferred:

- direct messaging/chat;
- connection request notes/messages;
- report-user workflow;
- admin moderation queue;
- endorsements;
- profile verification badges;
- ML/embedding recommendation engine;
- importing external contacts;
- email/push notification delivery;
- realtime notification subscriptions;
- private-account/follow-approval mode;
- connection-degree graph (2nd/3rd degree);
- follower/following privacy controls beyond the current member visibility model.

## 20. Success Criteria

My Network v1 is complete when:

1. an onboarded member can instantly follow/unfollow eligible members;
2. an onboarded member can send, cancel, accept, decline, and remove connection relationships correctly;
3. accepting a connection reliably creates mutual follows;
4. either connected user can later unfollow without disconnecting;
5. blocking immediately severs social relationships and removes cross-visibility across Network, profile, feed, and recommendations;
6. users receive and can read basic relationship notifications;
7. `/network` provides Discover, Connections, Requests, and Following states with accurate counts/actions;
8. professional profiles expose relationship-aware controls;
9. Home feed lightly prioritizes connected/followed professionals while retaining broader maritime discovery;
10. people recommendations use existing maritime data and exclude ineligible relationships;
11. RLS prevents cross-user relationship/notification abuse;
12. CI, production build, Supabase security verification, and production smoke tests pass.

## 21. Implementation Sequence

The implementation plan should preserve this order:

1. social graph schema, constraints, RLS, RPC/transaction helpers;
2. generated Supabase types;
3. network domain types/queries/actions with tests;
4. `/network` tabs and relationship controls;
5. professional profile integration;
6. notification centre and Bell unread state;
7. recommendations and Home “People you may know”;
8. block-aware feed/profile/network filtering;
9. relationship-aware Home feed ordering;
10. demo relationship seed for review;
11. full security/CI/build verification;
12. production deployment and smoke test.

This sequence keeps security and domain correctness ahead of UI polish and prevents the social graph from being implemented as client-only state.