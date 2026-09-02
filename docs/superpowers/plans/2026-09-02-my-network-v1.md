# My Network v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Sea N Shore’s existing maritime profile directory into a secure professional social graph with instant follows, request-based connections, blocking, in-app notifications, deterministic recommendations, and relationship-aware Home feed behavior.

**Architecture:** Supabase remains the source of truth. New graph tables and narrowly scoped authenticated RPCs own multi-row relationship transitions; RLS protects exposed graph data and enforces authenticated block-aware profile/feed visibility. Next.js server actions validate inputs and call generated Supabase APIs. Focused `network` and `notifications` feature modules drive `/network`, profile controls, Bell notifications, recommendations, and a bounded relationship priority inside each existing recency-based feed page.

**Tech Stack:** Next.js 16.3.4 App Router, React 19.2.8, TypeScript 5, Tailwind CSS 4, Supabase/Postgres/RLS, `@supabase/ssr` 0.12.5, `@supabase/supabase-js` 2.112.4, Zod 4.5.4, Vitest 4.1.11, Testing Library, Playwright 1.62.1, pgTAP/Supabase DB tests.

**Spec:** `docs/superpowers/specs/2026-09-02-my-network-v1-design.md`

## Release verification snapshot — 2026-09-02

- Application CI passes lint, TypeScript checks, unit tests, and the Next.js production build on the latest feature branch head.
- Live Supabase migrations are synchronized through `20260902185658_add_network_notification_actor_index`.
- Network relationship and block behavior has been exercised with rollback-only multi-user database checks against the live Supabase project.
- Supabase security advisor shows no Network-specific findings; remaining notices pre-date My Network.
- The Network-specific unindexed `notifications.actor_id` foreign key was fixed and now has a covering index.
- Playwright browser specs exist for signed-out and authenticated Network/notification smoke flows, but authenticated browser execution still requires dedicated `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` credentials.
- Vercel Preview is currently blocked by missing Preview environment values for `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Production environment configuration is unaffected.
- Keep PR #2 in draft until Preview deployment and browser smoke QA are complete. Do not merge or deploy this feature solely from CI evidence.

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
- Create: `supabase/tests/network_indexes.test.sql`.
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

Implementation details and task-by-task history continue in the Git history for this plan; the release snapshot above is the authoritative current verification state.
