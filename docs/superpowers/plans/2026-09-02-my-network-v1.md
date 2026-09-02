# My Network v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Sea N Shore’s existing maritime profile directory into a secure professional social graph with instant follows, request-based connections, blocking, in-app notifications, deterministic recommendations, and relationship-aware Home feed behavior.

**Architecture:** Supabase remains the source of truth. New graph tables and narrowly scoped authenticated RPCs own multi-row relationship transitions; RLS protects exposed graph data and enforces authenticated block-aware profile/feed visibility. Next.js server actions validate inputs and call generated Supabase APIs. Focused `network` and `notifications` feature modules drive `/network`, profile controls, Bell notifications, recommendations, and a bounded relationship priority inside each existing recency-based feed page.

**Tech Stack:** Next.js 16.3.4 App Router, React 19.2.8, TypeScript 5, Tailwind CSS 4, Supabase/Postgres/RLS, `@supabase/ssr` 0.12.5, `@supabase/supabase-js` 2.112.4, Zod 4.5.4, Vitest 4.1.11, Testing Library, Playwright 1.62.1, pgTAP/Supabase DB tests.

**Spec:** `docs/superpowers/specs/2026-09-02-my-network-v1-design.md`

## Release verification snapshot — 2026-09-02

- Latest feature-branch Application CI passed lint, typecheck, unit tests, and the Next.js production build.
- Live Supabase Network migrations are applied through `20260902185658_add_network_notification_actor_index`.
- Network relationship/block behavior was exercised with rollback-only multi-user checks against the live Supabase project.
- Supabase security advisor has no Network-specific findings; the remaining notices pre-date My Network.
- The Network-specific `notifications.actor_id` foreign key now has a covering index.
- Playwright smoke specs are committed, but authenticated browser execution still requires dedicated E2E credentials.
- Vercel Preview currently fails because Preview values are missing for `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- Keep PR #2 in draft until Preview deployment and browser smoke QA are complete.

## Global Constraints

- Follow is instant; Connect is request/accept; accepting creates mutual follows; unfollow does not disconnect; removing a connection does not force unfollow.
- Blocking removes both follow directions plus any connection/request and prevents interaction until explicitly unblocked; unblocking restores nothing automatically.
- Notification types are exactly `connection_request`, `connection_accepted`, and `new_follower`.
- Realtime, email, and push notifications remain out of scope.
- Report/moderation, messaging, endorsements, verification badges, connection notes, 2nd/3rd-degree graph, private follow approval, and ML recommendations remain out of scope.
- Every exposed table must have RLS and explicit grants. Ordinary clients receive no direct notification INSERT/DELETE privilege.
- SECURITY DEFINER RPCs must use `set search_path = ''`, validate `auth.uid()`, revoke default EXECUTE from `public`, `anon`, and `service_role`, and grant only the intended authenticated role.
- Never use user-editable metadata for authorization.
- Never reveal which side initiated a block. Return generic unavailable copy.
- Anonymous public-profile behavior stays unchanged; block-aware hiding applies to authenticated viewers.
- Home feed remains broad maritime discovery. Relationship priority is a soft boost, never a connections-only filter.
- Preserve `FeedCursor = { createdAt, id }`. The next cursor is calculated from the original recency-ordered page before display reordering.
- Node remains `>=22.0.0`; add no runtime dependency for this release.
- Generate migration filenames with the Supabase CLI; never invent timestamps manually.

---

## File Map

### Database
- Create via `npx supabase migration new create_network_graph`: enums, graph tables, indexes, RLS/grants, private helpers, authenticated graph RPCs.
- Create via `npx supabase migration new enforce_network_block_visibility`: authenticated block-aware profile/post policies if kept separate for reviewability.
- Create: `supabase/tests/network_rls.test.sql`.
- Modify: `supabase/tests/feed_rls.test.sql`.

### Network domain
- Create: `src/features/network/types.ts`
- Create: `src/features/network/schemas.ts`
- Create: `src/features/network/schemas.test.ts`
- Create: `src/features/network/recommendations.ts`
- Create: `src/features/network/recommendations.test.ts`
- Create: `src/features/network/queries.ts`
- Create: `src/features/network/queries.test.ts`
- Create: `src/features/network/actions.ts`
- Create: `src/features/network/actions.test.ts`
- Create: `src/features/network/components/network-tabs.tsx`
- Create: `src/features/network/components/network-profile-card.tsx`
- Create: `src/features/network/components/network-profile-card.test.tsx`
- Create: `src/features/network/components/relationship-controls.tsx`
- Create: `src/features/network/components/relationship-controls.test.tsx`
- Create: `src/features/network/components/connection-request-card.tsx`
- Create: `src/features/network/components/people-you-may-know.tsx`
- Create: `src/features/network/components/people-you-may-know.test.tsx`

### Notifications
- Create: `src/features/notifications/types.ts`
- Create: `src/features/notifications/queries.ts`
- Create: `src/features/notifications/actions.ts`
- Create: `src/features/notifications/actions.test.ts`
- Create: `src/features/notifications/components/notification-bell.tsx`
- Create: `src/features/notifications/components/notification-bell.test.tsx`
- Create: `src/features/notifications/components/notification-list.tsx`
- Create: `src/app/(app)/notifications/page.tsx`
- Create: `src/components/navigation/mobile-app-header.tsx`

### Existing files
- Modify: `src/lib/supabase/database.types.ts`
- Modify: `src/features/profiles/queries.ts`
- Modify: `src/features/profiles/components/profile-header.tsx`
- Create: `src/features/profiles/components/profile-header.test.tsx`
- Modify: `src/app/(public)/people/[slug]/page.tsx`
- Modify: `src/app/(app)/network/page.tsx`
- Modify: `src/components/navigation/app-header.tsx`
- Modify: `src/components/navigation/mobile-nav.tsx`
- Modify: `src/app/(app)/layout.tsx`
- Create: `src/features/feed/ranking.ts`
- Create: `src/features/feed/ranking.test.ts`
- Modify: `src/features/feed/queries.ts`
- Modify: `src/features/feed/queries.test.ts`
- Modify: `src/features/feed/components/feed-discovery-rail.tsx`
- Modify: `src/features/feed/components/feed-layout.tsx`
- Modify: `src/app/(app)/home/page.tsx`
- Create: `tests/e2e/network.spec.ts`
- Modify: `tests/e2e/home-feed.spec.ts`

---

### Task 1: Create the Secure Social Graph Database Contract

**Files:**
- Create: `supabase/tests/network_rls.test.sql`
- Create with CLI: migration from `npx supabase migration new create_network_graph`

**Interfaces:**
- Enum `public.connection_status`: `pending | accepted`.
- Enum `public.network_notification_type`: `connection_request | connection_accepted | new_follower`.
- Tables: `follows`, `connections`, `user_blocks`, `notifications`.
- RPCs:
  - `follow_profile(p_target_id uuid) returns boolean`
  - `unfollow_profile(p_target_id uuid) returns boolean`
  - `send_connection_request(p_target_id uuid) returns uuid`
  - `cancel_connection_request(p_connection_id uuid) returns boolean`
  - `accept_connection_request(p_connection_id uuid) returns boolean`
  - `decline_connection_request(p_connection_id uuid) returns boolean`
  - `remove_connection(p_connection_id uuid) returns boolean`
  - `block_profile(p_target_id uuid) returns boolean`
  - `unblock_profile(p_target_id uuid) returns boolean`
- Stable domain errors: `network_interaction_unavailable`, `network_self_interaction`, `network_request_exists`, `network_already_connected`, `network_action_not_allowed`.

- [ ] **Step 1: Write the failing pgTAP contract**

Use the same transaction/fixture pattern as `feed_rls.test.sql`: create four deterministic authenticated users, fill profile identity, insert maritime details, then set `onboarding_completed_at`.

Include concrete assertions such as:

```sql
select lives_ok(
  $$ select public.follow_profile('22222222-2222-4222-8222-222222222222') $$,
  'member A can follow member B'
);

select is(
  (select count(*) from public.follows
   where follower_id = '11111111-1111-4111-8111-111111111111'
     and following_id = '22222222-2222-4222-8222-222222222222'),
  1::bigint,
  'follow row belongs to caller'
);

select is(
  (select count(*) from public.notifications
   where recipient_id = '22222222-2222-4222-8222-222222222222'
     and actor_id = '11111111-1111-4111-8111-111111111111'
     and notification_type = 'new_follower'),
  1::bigint,
  'new follow creates one notification'
);
```

The suite must cover self-interaction, duplicate follow idempotency, pending-request uniqueness in either direction, requester cannot accept own request, unrelated user cannot accept/remove, acceptance creates two follows without `new_follower` notifications, unfollow preserves accepted connection, connection removal preserves follows, block deletes both follow directions + pair connection + actionable request notification, blocked pairs cannot follow/connect, unblock restores no relationship, direct notification INSERT fails, another user cannot read/update notifications, and an incoming block row is not directly readable by the blocked user.

- [ ] **Step 2: Run DB tests and verify failure**

```bash
npm run test:db
```

Expected: the new suite fails because graph tables/RPCs do not exist; existing feed suites remain green.

- [ ] **Step 3: Generate the migration**

```bash
npx supabase migration new create_network_graph
```

Use the exact generated path.

- [ ] **Step 4: Implement schema and constraints**

```sql
create type public.connection_status as enum ('pending', 'accepted');
create type public.network_notification_type as enum (
  'connection_request', 'connection_accepted', 'new_follower'
);

create table public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_not_self check (follower_id <> following_id)
);

create table public.connections (
  id uuid primary key default gen_random_uuid(),
  user_low_id uuid not null references public.profiles(id) on delete cascade,
  user_high_id uuid not null references public.profiles(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  status public.connection_status not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_low_id, user_high_id),
  constraint connections_canonical_pair check (user_low_id < user_high_id),
  constraint connections_requester_in_pair check (
    requested_by = user_low_id or requested_by = user_high_id
  )
);

create table public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_not_self check (blocker_id <> blocked_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  notification_type public.network_notification_type not null,
  connection_id uuid references public.connections(id) on delete set null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
```

Add indexes for both directions of follows/connections/blocks and `notifications(recipient_id, read_at, created_at desc)`.

- [ ] **Step 5: Add private eligibility/block helpers and atomic RPCs**

A helper follows this security shape:

```sql
create or replace function private.network_member_ready(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_user_id
      and p.account_status = 'active'
      and p.onboarding_completed_at is not null
  );
$$;

revoke all on function private.network_member_ready(uuid)
from public, anon, authenticated, service_role;
```

Create a second private boolean helper for a block in either direction. Public graph RPCs may be SECURITY DEFINER because they need atomic cross-table writes, but each must read `auth.uid()`, reject NULL callers, validate ownership/pair state, use fully qualified names, and expose no blocker identity.

`accept_connection_request` must update the connection, insert both follow directions with `on conflict do nothing`, remove the actionable request notification, and create exactly one `connection_accepted` notification. It must not call `follow_profile()`.

`block_profile` must insert the block idempotently, delete both follow directions, delete the pair connection, and remove pending actionable request notifications in one transaction.

For every RPC revoke default execution and grant only authenticated, for example:

```sql
revoke all on function public.follow_profile(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.follow_profile(uuid) to authenticated;
```

- [ ] **Step 6: Enable RLS and explicit grants**

Revoke default anon/authenticated privileges. Grant authenticated SELECT only where needed and `update (read_at)` on notifications. Do not grant direct graph mutations.

Policies:
- `connections`: caller can SELECT only when caller is either pair member.
- `user_blocks`: caller can SELECT only own outgoing block rows.
- `notifications`: recipient-only SELECT and recipient-only UPDATE with both `USING` and `WITH CHECK`.
- `follows`: active/onboarded authenticated members may SELECT relationship rows needed for graph state; mutations remain RPC-only.

- [ ] **Step 7: Run DB tests**

```bash
npm run test:db
```

Expected: all feed + network pgTAP tests PASS.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations supabase/tests/network_rls.test.sql
git commit -m "feat: add secure network social graph"
```

---

### Task 2: Enforce Authenticated Block Visibility on Profiles and Feed

**Files:**
- Create with CLI: migration from `npx supabase migration new enforce_network_block_visibility`
- Modify: `supabase/tests/network_rls.test.sql`
- Modify: `supabase/tests/feed_rls.test.sql`

**Interfaces:** authenticated users cannot SELECT the counterparty profile/post if either direction is blocked; anon public-profile policy is unchanged.

- [ ] **Step 1: Add failing visibility tests**

A blocks B. As B, assert A profile count is 0 and A post count is 0. As neutral C, assert both remain readable. As anon, assert A’s active/completed public profile remains readable.

- [ ] **Step 2: Run DB tests and confirm the new assertions fail**

```bash
npm run test:db
```

- [ ] **Step 3: Generate the policy migration**

```bash
npx supabase migration new enforce_network_block_visibility
```

- [ ] **Step 4: Add an authenticated-safe visibility function**

```sql
create or replace function public.network_profile_visible(p_target_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null then false
    when p_target_id = (select auth.uid()) then true
    else private.network_member_ready(p_target_id)
      and not private.network_pair_blocked((select auth.uid()), p_target_id)
  end;
$$;

revoke all on function public.network_profile_visible(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.network_profile_visible(uuid) to authenticated;
```

- [ ] **Step 5: Alter only authenticated profile/post SELECT policies**

Keep `public profiles are readable` for anon unchanged. Alter `members read their own profile` so self remains readable and other active/completed profiles require `network_profile_visible(id)`. Alter `active members read posts` to retain the existing viewer/deleted checks plus `network_profile_visible(author_id)`.

Do not duplicate block checks into comments/reactions/polls if their existing policies already require a readable underlying post; prove that with DB tests.

- [ ] **Step 6: Run DB tests and commit**

```bash
npm run test:db
git add supabase/migrations supabase/tests
git commit -m "feat: enforce network block visibility"
```

---

### Task 3: Regenerate Supabase Types and Define Network Domain Types

**Files:**
- Modify: `src/lib/supabase/database.types.ts`
- Create: `src/features/network/types.ts`
- Create: `src/features/network/schemas.ts`
- Create: `src/features/network/schemas.test.ts`
- Modify: `src/features/profiles/queries.ts`

**Interfaces:**
- `NetworkTab = 'discover' | 'connections' | 'requests' | 'following'`.
- `RelationshipState` contains `following` plus connection kind `none | incoming_pending | outgoing_pending | connected`.
- `NetworkProfile = PublicProfile & { relationship: RelationshipState }`.
- `getPublicProfilesByIds(ids: string[]): Promise<PublicProfile[]>`.
- `getNetworkProfiles(limit)` supports up to 60 candidates and is deterministically ordered by `updated_at desc, id asc`.

- [ ] **Step 1: Regenerate database types**

Use the project’s existing Supabase type-generation workflow after the graph schema is present. Replace the generated file; do not hand-edit table/RPC shapes. Verify it contains all four graph tables, two enums, and nine RPCs.

- [ ] **Step 2: Write failing schema tests**

```ts
import { describe, expect, it } from 'vitest'
import { networkTabSchema, targetProfileSchema } from './schemas'

describe('network schemas', () => {
  it('accepts known tabs only', () => {
    expect(networkTabSchema.safeParse('connections').success).toBe(true)
    expect(networkTabSchema.safeParse('random').success).toBe(false)
  })

  it('requires UUID profile ids', () => {
    expect(targetProfileSchema.safeParse({ targetId: '11111111-1111-4111-8111-111111111111' }).success).toBe(true)
    expect(targetProfileSchema.safeParse({ targetId: 'member-a' }).success).toBe(false)
  })
})
```

- [ ] **Step 3: Implement types and parsers**

```ts
export const NETWORK_TABS = ['discover', 'connections', 'requests', 'following'] as const
export type NetworkTab = (typeof NETWORK_TABS)[number]

export type ConnectionRelationship =
  | { kind: 'none'; connectionId: null }
  | { kind: 'incoming_pending'; connectionId: string }
  | { kind: 'outgoing_pending'; connectionId: string }
  | { kind: 'connected'; connectionId: string }

export type RelationshipState = {
  following: boolean
  connection: ConnectionRelationship
}
```

`parseNetworkTab(value)` returns `discover` when parsing fails.

- [ ] **Step 4: Extend profile queries without duplicating profile mapping**

Raise `getNetworkProfiles`’s maximum limit from 30 to 60 and add a deterministic secondary `.order('id', { ascending: true })` after `updated_at desc`.

Add `getPublicProfilesByIds` using the existing `normalizeProfileRow()` and `mapPublicProfile()`:

```ts
const profiles = (data ?? []).flatMap((row) => {
  const normalized = normalizeProfileRow(row)
  return normalized ? [mapPublicProfile(normalized)] : []
})
const byId = new Map(profiles.map((profile) => [profile.id, profile]))
return ids.flatMap((id) => {
  const profile = byId.get(id)
  return profile ? [profile] : []
})
```

- [ ] **Step 5: Run tests/typecheck and commit**

```bash
npm run test -- src/features/network/schemas.test.ts
npm run typecheck
git add src/lib/supabase/database.types.ts src/features/network src/features/profiles/queries.ts
git commit -m "feat: define network domain types"
```

---

### Task 4: Build Network Queries and Deterministic Recommendations

**Files:**
- Create: `src/features/network/recommendations.ts`
- Create: `src/features/network/recommendations.test.ts`
- Create: `src/features/network/queries.ts`
- Create: `src/features/network/queries.test.ts`

**Interfaces:**
- `getRelationshipState(targetId: string): Promise<RelationshipState>`.
- `getNetworkHub(tab: NetworkTab): Promise<NetworkHubData>`.
- `getPeopleYouMayKnow(limit?: number): Promise<NetworkProfile[]>`.
- `getPreferredFeedAuthorIds(): Promise<Set<string>>`.
- `scoreRecommendation(viewer: PublicProfile, candidate: PublicProfile): number`.

- [ ] **Step 1: Write recommendation tests**

Set exact weights:

```ts
export const RECOMMENDATION_WEIGHTS = {
  sharedVesselType: 6,
  sharedSkill: 5,
  sharedTradingArea: 4,
  rankMatch: 3,
  sameProfileType: 2,
  sameLocation: 1,
} as const
```

Use concrete PublicProfile fixtures and prove a vessel+skill match outranks location-only/no-overlap profiles. Normalize comparisons case-insensitively; no fuzzy matching.

- [ ] **Step 2: Write relationship assembly tests**

Test a pure helper:

```ts
relationshipFromRows(viewerId, targetId, followedIds, connections)
```

Cover none, incoming pending, outgoing pending, connected, and following independent from connection.

- [ ] **Step 3: Implement Discover and hub queries**

Discover loads `getNetworkProfiles(60)`, relies on RLS for block/ineligibility removal, hydrates relationship state, excludes accepted connections from fresh recommendations, calculates score, then performs a stable score-desc sort. Because the source query is `updated_at desc, id asc`, stable sorting preserves the spec’s recency/ID tie-break for equal scores. Cap Discover display at 30.

Connections uses accepted pair counterpart IDs. Following uses `following_id`. Requests partitions pair rows by `requested_by === viewer.id`, then hydrates counterpart profiles using `getPublicProfilesByIds`.

- [ ] **Step 4: Implement People You May Know and feed-preference IDs**

Suggestions reuse Discover scoring and clamp limit to `1..5`. Preferred feed authors are the union of direct follows and accepted connection counterparties, so a connected-but-unfollowed user still gets the connection boost.

- [ ] **Step 5: Run tests/typecheck and commit**

```bash
npm run test -- src/features/network/recommendations.test.ts src/features/network/queries.test.ts
npm run typecheck
git add src/features/network src/features/profiles/queries.ts
git commit -m "feat: add network queries and recommendations"
```

---

### Task 5: Implement Network Server Actions

**Files:**
- Create: `src/features/network/actions.ts`
- Create: `src/features/network/actions.test.ts`

**Interfaces:**
- `NetworkActionResult = { ok: true } | { ok: false; error: string }`.
- Actions: `followProfile`, `unfollowProfile`, `sendConnectionRequest`, `cancelConnectionRequest`, `acceptConnectionRequest`, `declineConnectionRequest`, `removeConnection`, `blockProfile`, `unblockProfile`.

- [ ] **Step 1: Write failing action tests**

Follow the feed action mocking pattern. Invalid UUIDs must return before Supabase is created. Correct RPC name and argument must be asserted. Known DB messages must map to safe copy.

```ts
expect(await followProfile('not-a-uuid')).toEqual({
  ok: false,
  error: 'Invalid member.',
})
```

- [ ] **Step 2: Implement stable safe error mapping**

```ts
function networkError(message?: string) {
  switch (message) {
    case 'network_request_exists': return 'Request already sent.'
    case 'network_already_connected': return 'You’re already connected.'
    case 'network_interaction_unavailable': return 'This interaction is not available.'
    case 'network_self_interaction': return 'You cannot perform this action on your own profile.'
    default: return 'We could not update this relationship. Please try again.'
  }
}
```

- [ ] **Step 3: Implement all RPC wrappers**

Use generated signatures, for example:

```ts
const { error } = await supabase.rpc('follow_profile', {
  p_target_id: parsed.data,
})
```

On success revalidate `/network`, `/home`, and `/notifications`. Profile-page client controls call `router.refresh()` after successful mutation, so actions do not accept or trust a slug merely for revalidation.

- [ ] **Step 4: Run tests/typecheck and commit**

```bash
npm run test -- src/features/network/actions.test.ts
npm run typecheck
git add src/features/network/actions.ts src/features/network/actions.test.ts
git commit -m "feat: add network relationship actions"
```

---

### Task 6: Build the Four-Tab My Network UI

**Files:**
- Create: network tab/card/control/request components and tests from File Map
- Modify: `src/app/(app)/network/page.tsx`
- Modify: `src/components/navigation/mobile-nav.tsx`

**Interfaces:** `/network?tab=discover|connections|requests|following` is canonical; Requests shows incoming count.

- [ ] **Step 1: Write relationship-control component tests**

Assert exact states: Follow + Connect; Pending + Cancel; incoming Accept + Decline; Connected; independent Following/Follow. Assert no fake verification/reputation copy.

- [ ] **Step 2: Implement `RelationshipControls`**

Follow the existing `PostCard` optimistic pattern: snapshot previous state, update UI, call server action in `startTransition`, restore and show `role="alert"` on failure. Acceptance sets `connected` and `following=true`. Connection removal keeps existing follow state. Successful block calls `router.refresh()` so the card disappears.

- [ ] **Step 3: Implement maritime network cards and request cards**

Reuse the current directory content: profile type, name, headline, location, rank/company, up to 3 skills, profile link. Add relationship controls and a Block action in an overflow/details affordance.

- [ ] **Step 4: Implement tab navigation and replace `/network`**

Parse `searchParams.tab`, call `getNetworkHub`, preserve the current maritime heading, and render tab-specific empty states.

- [ ] **Step 5: Add Network to mobile nav without removing current destinations**

Use seven items: Home, Network, Jobs, Community, Learn, Events, Profile. Change the grid to `grid-cols-7`; keep the existing minimum touch height.

- [ ] **Step 6: Run tests/build and commit**

```bash
npm run test -- src/features/network/components
npm run typecheck
npm run build
git add src/features/network/components src/app/'(app)'/network/page.tsx src/components/navigation/mobile-nav.tsx
git commit -m "feat: build My Network hub"
```

---

### Task 7: Integrate Relationships into Professional Profiles

**Files:**
- Modify: `src/features/profiles/components/profile-header.tsx`
- Create: `src/features/profiles/components/profile-header.test.tsx`
- Modify: `src/app/(public)/people/[slug]/page.tsx`

**Interfaces:** `ProfileHeader` accepts optional `actions?: ReactNode`; anon and self views have no relationship controls.

- [ ] **Step 1: Write header slot tests**

Assert actions render only when provided and existing identity/availability content is unchanged.

- [ ] **Step 2: Add the presentation slot**

```ts
export function ProfileHeader({
  profile,
  actions,
}: {
  profile: PublicProfile
  actions?: ReactNode
})
```

Keep network logic outside the generic profile component.

- [ ] **Step 3: Add optional authenticated viewer behavior to the public profile route**

Use `getVerifiedUser()` rather than `requireUser()`. Load the profile normally. When a user exists and is not the owner, call `getRelationshipState(profile.id)` and render `RelationshipControls`. Authenticated blocked access naturally resolves to `notFound()` because RLS hides the profile row.

- [ ] **Step 4: Run tests/build and commit**

```bash
npm run test -- src/features/profiles
npm run typecheck
npm run build
git add src/features/profiles src/app/'(public)'/people/'[slug]'/page.tsx
git commit -m "feat: add relationships to professional profiles"
```

---

### Task 8: Build Notifications and Activate Desktop/Mobile Bell

**Files:**
- Create notification feature files/routes/mobile header from File Map
- Modify: `src/components/navigation/app-header.tsx`
- Modify: `src/app/(app)/layout.tsx`

**Interfaces:**
- `getNotificationChrome(): Promise<{ recent: NetworkNotification[]; unreadCount: number }>`.
- `getNotifications(limit=50)`.
- `markNotificationRead(id)` and `markAllNotificationsRead()`.
- `AppHeader` receives notification chrome data as props; it does not fetch independently.
- `MobileAppHeader` receives unread count.

- [ ] **Step 1: Write notification action tests**

Invalid UUID short-circuits. Single-read update must filter both id and authenticated recipient. Mark-all must filter `recipient_id=viewerId` and `read_at IS NULL`.

- [ ] **Step 2: Implement notification mapping and queries**

Map types to exact copy:
- request → “sent you a connection request”
- accepted → “accepted your connection request”
- follower → “started following you”

Destinations: request → `/network?tab=requests`; accepted/follower → actor profile.

- [ ] **Step 3: Implement read actions with direct RLS-protected UPDATE**

```ts
await supabase
  .from('notifications')
  .update({ read_at: new Date().toISOString() })
  .eq('id', parsed.data)
  .eq('recipient_id', user.id)
```

- [ ] **Step 4: Write and implement Bell tests**

Cover unread badge, `9+` cap, recent item copy, View all, and zero state. Opening the panel does not mark all read; item navigation marks one read; explicit Mark all read is available.

- [ ] **Step 5: Fetch notification chrome once in `(app)/layout.tsx`**

After `requireUser()`, call `getNotificationChrome()` once. Pass `{ recent, unreadCount }` to `AppHeader` and `unreadCount` to `MobileAppHeader`. Keep `AppHeader` a presentation/server component rather than duplicating queries.

- [ ] **Step 6: Add full notifications route and mobile header**

`/notifications` renders the reusable list plus mark-all action. `MobileAppHeader` is visible below `md`, with Wordmark and a Bell link/badge. No polling or realtime subscription.

- [ ] **Step 7: Run tests/build and commit**

```bash
npm run test -- src/features/notifications
npm run typecheck
npm run build
git add src/features/notifications src/app/'(app)'/notifications src/components/navigation src/app/'(app)'/layout.tsx
git commit -m "feat: add network notifications"
```

---

### Task 9: Add People You May Know and Soft Feed Priority

**Files:**
- Create: `src/features/feed/ranking.ts`
- Create: `src/features/feed/ranking.test.ts`
- Create: People You May Know component/test from File Map
- Modify feed queries/rail/layout/Home files from File Map

**Interfaces:**
- `prioritizeRecentFeedRows<T>(rows, preferredAuthorIds, authorId): T[]` stable-partitions one already-recency-bounded page.
- Feed cursor remains based on original `pageRows` tail.

- [ ] **Step 1: Write ranking tests**

With recency order `p1,p2,p3,p4` and preferred authors for p2/p4, expect display `p2,p4,p1,p3`. Assert input is not mutated.

- [ ] **Step 2: Implement stable partition**

```ts
export function prioritizeRecentFeedRows<T>(
  rows: readonly T[],
  preferredAuthorIds: ReadonlySet<string>,
  authorId: (row: T) => string,
): T[] {
  const preferred: T[] = []
  const other: T[] = []
  for (const row of rows) {
    if (preferredAuthorIds.has(authorId(row))) preferred.push(row)
    else other.push(row)
  }
  return [...preferred, ...other]
}
```

- [ ] **Step 3: Modify `getFeedPage()` while preserving pagination**

```ts
const pageRows = rows.slice(0, parsed.limit)
const tail = pageRows.at(-1)
const preferredAuthorIds = await getPreferredFeedAuthorIds()
const displayRows = prioritizeRecentFeedRows(
  pageRows,
  preferredAuthorIds,
  (row) => row.profiles.id,
)
const posts = await hydratePosts(displayRows, user.id, supabase)
```

Return cursor from `tail`. Blocked authors are already excluded by Task 2 RLS.

- [ ] **Step 4: Extend feed tests**

Keep the exact existing cursor-filter assertion and add proof that display prioritization never changes the cursor source.

- [ ] **Step 5: Build People You May Know**

Render 3–5 pre-fetched NetworkProfiles with compact identity, View profile, Follow, and Connect states. Accepted connections are already excluded by query logic.

- [ ] **Step 6: Integrate into existing right rail**

In Home, load initial feed and `getPeopleYouMayKnow(4)` in parallel after own profile/category resolution. Pass suggestions through `FeedLayout` to `FeedDiscoveryRail`; keep maritime topics and existing Network/Events/Jobs links.

- [ ] **Step 7: Run tests/build and commit**

```bash
npm run test -- src/features/feed src/features/network/components/people-you-may-know.test.tsx
npm run typecheck
npm run build
git add src/features/feed src/features/network/components/people-you-may-know* src/app/'(app)'/home/page.tsx
git commit -m "feat: personalize maritime discovery"
```

---

### Task 10: Seed a Reviewable Demo Social Graph

**Files:** no permanent schema/code file; use existing synthetic profiles and application RPCs after migration.

**Known demo slugs:**
- `demo-capt-aarav-sen`
- `demo-capt-meera-nair`
- `demo-ananya-rao`
- `demo-ce-rohan-menon`
- `demo-capt-kabir-malhotra`

- [ ] **Step 1: Resolve IDs from slugs and verify all five profiles are active/onboarded**

Stop if the expected synthetic profiles are missing; never hard-code their generated UUIDs into a migration.

- [ ] **Step 2: Create the review state through authenticated graph operations**

Target state:
- primary review account follows Aarav without connection;
- primary + Meera accepted connection with mutual follows;
- Kabir → primary incoming pending request;
- primary → Ananya outgoing pending request;
- request, accepted, and follower notification examples exist consistently with those actions.

Use controlled JWT/session impersonation in SQL only for demo setup; use the same public RPCs as the app.

- [ ] **Step 3: Verify no demo block remains**

Both block directions between primary account and every demo profile must have count 0 after verification.

- [ ] **Step 4: Verify counts as primary authenticated user**

At minimum: one non-connected follow, one accepted connection, one incoming request, one outgoing request, all three notification types, and existing demo feed posts visible.

---

### Task 11: Add E2E Network Smoke Coverage

**Files:**
- Create: `tests/e2e/network.spec.ts`
- Modify: `tests/e2e/home-feed.spec.ts`

**Interfaces:** uses existing `E2E_USER_EMAIL` / `E2E_USER_PASSWORD`; both desktop Chromium and mobile Safari projects.

- [ ] **Step 1: Add signed-out route protection**

```ts
test('signed-out visitor is redirected from network', async ({ page }) => {
  await page.goto('/network')
  await expect(page).toHaveURL(/\/auth\/sign-in/)
})
```

- [ ] **Step 2: Add authenticated hub smoke**

Sign in exactly as `home-feed.spec.ts` does. Assert Discover, Connections, Requests, Following tabs and at least one demo professional when seed state exists. Skip only when credentials are absent.

- [ ] **Step 3: Add notification and mobile navigation smoke**

Desktop: Bell visible and `/notifications` loads. Mobile: Network appears in bottom nav and notification Bell/link appears in mobile header.

- [ ] **Step 4: Extend Home smoke non-brittly**

Retain composer/Profile completeness checks and assert the desktop discovery surface contains People You May Know when seeded, while mobile still has Network navigation.

- [ ] **Step 5: Run and commit**

```bash
npm run test:e2e
git add tests/e2e
git commit -m "test: cover My Network flows"
```

Signed-out tests must always pass; authenticated tests may skip only when E2E credentials are absent.

---

### Task 12: Verify Security, CI, Remote Migrations, Merge, and Production

**Files:** change only files required by verification failures; no unrelated refactor.

**Release targets:** branch `feature/my-network-v1`, base `main`, Supabase project `rrxyiwajrzcepyvscidh`, existing Sea N Shore Vercel project.

- [ ] **Step 1: Run full application verification**

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:db
```

All must exit 0.

- [ ] **Step 2: Review generated type diff**

`database.types.ts` changes must be schema-derived graph/RPC additions only; no unrelated generated objects disappear.

- [ ] **Step 3: Run Supabase security advisor before remote rollout**

Record baseline findings. The graph release must introduce no new missing-RLS, exposed-function, or unsafe-search-path finding. Existing unrelated findings remain separate unless they directly block this release.

- [ ] **Step 4: Apply committed migrations to `rrxyiwajrzcepyvscidh` in filename order**

Use the exact committed SQL. Confirm remote migration history versions match the committed generated filenames; do not reapply an already-recorded migration.

- [ ] **Step 5: Regenerate remote database types and compare**

Expected: semantic match with committed `database.types.ts`. If different, replace with generated output and rerun typecheck/tests.

- [ ] **Step 6: Verify remote graph security explicitly**

Confirm RLS on all four tables; connections are pair-private; incoming blocks are not directly readable by blocked users; direct notification INSERT is unavailable; notification UPDATE is `read_at` only; graph RPCs are authenticated-only; SECURITY DEFINER functions use empty search path/auth checks; profile/post block-aware policies are active.

- [ ] **Step 7: Seed Task 10 review state and verify through RLS as the real review account**

Confirm `/network` will have visible data before product review.

- [ ] **Step 8: Open PR**

Title: `Build My Network social graph`.

Body: schema/security, Network UX, notifications, deterministic recommendations, feed integration, tests, and migration requirement.

- [ ] **Step 9: Wait for CI and review full diff**

CI lint/typecheck/unit/build must pass. Confirm no messaging, moderation/reporting, ML, badges, or unrelated refactors entered the diff. A Preview-only Vercel environment-variable failure is documented separately if Production configuration remains valid.

- [ ] **Step 10: Merge only after DB and CI evidence are green**

Verify resulting `main` SHA includes every task.

- [ ] **Step 11: Verify Vercel production deployment**

Wait for `READY`; ensure deployment metadata references the merged main SHA, not an old immutable deployment.

- [ ] **Step 12: Production smoke on stable domain**

Sign in; verify four Network tabs, Follow/Connect states, profile controls, Bell + `/notifications`, Home broader posts + People You May Know, and mobile Network/notification navigation. Test one temporary block against a demo profile, confirm Network/profile/feed cross-visibility disappears, then unblock and restore desired demo graph state. Check Vercel runtime errors for the deployment window.

- [ ] **Step 13: Record release evidence**

Record merged SHA, migration versions, advisor result, local verification results, CI conclusion, Vercel production deployment ID/state, stable-domain smoke result, and any non-production housekeeping issue.

---

## Self-Review Coverage

- Schema, constraints, RLS, atomic transitions: Task 1.
- Authenticated block-aware profile/feed visibility: Task 2.
- Generated types/domain contracts: Task 3.
- Deterministic maritime recommendations and graph queries: Task 4.
- Safe server actions/errors: Task 5.
- Discover / Connections / Requests / Following: Task 6.
- Professional-profile controls: Task 7.
- Bell, unread state, desktop panel, mobile/full notifications: Task 8.
- People You May Know + soft feed priority with cursor safety: Task 9.
- Reviewable synthetic graph: Task 10.
- E2E navigation/smoke: Task 11.
- Security advisor, remote migrations, CI, merge, Vercel, production smoke: Task 12.
- Every explicitly out-of-scope feature remains absent.
