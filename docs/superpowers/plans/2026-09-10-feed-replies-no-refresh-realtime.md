# Feed Replies, No-Refresh Interactions & Realtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Sea N Shore comments/replies visually LinkedIn-like, prevent reaction/comment mutations from refreshing the feed, and add lightweight realtime notification/feed freshness plus infinite scroll.

**Architecture:** Keep Aurora and the existing social-event pipeline as the source of truth. Use client-local optimistic/confirmed state for feed interactions, small authenticated polling actions for notification/feed freshness, and preserve the existing cursor pagination. No new vendor, websocket stack, media CDN migration, or database migration is planned.

**Tech Stack:** Next.js 16.3.4, React 19.2.8, TypeScript, Vitest/Testing Library, PostgreSQL/Aurora, AWS EventBridge/SQS, existing CloudFront/S3 setup.

**Spec:** `docs/superpowers/specs/2026-09-10-feed-replies-no-refresh-realtime-design.md`

## Global Constraints

- Branch `feat/aws-native-phase-0-1` only.
- Never touch `main`, merge, or create a PR.
- Fetch live branch head immediately before each write and do not overwrite unknown concurrent movement.
- Keep `scripts/aws/staging-deploy-action.txt`, `scripts/aws/edge-recovery-action.txt`, and `scripts/aws/github-deploy-iam-action.txt` at `plan` during development.
- Preserve existing reactions: Like, Support, Respect, On Point.
- Preserve comment owner-only delete and strict 15-minute edit eligibility.
- Personalized feed/notification HTML remains uncached at shared CloudFront level.
- No Stage-B media CDN migration in this plan.

---

### Task 1: LinkedIn-style reply threads and compact metrics

**Files:**
- Modify: `src/features/feed/components/comment-thread.tsx`
- Test: `src/features/feed/components/comment-thread-social-metrics.test.tsx`

**Interfaces:**
- Consumes: existing `FeedComment`, `ReactionSummary`, `ReactionPicker`, `ReactionDetailsModal`.
- Produces: `CommentItem` presentation with `replyCount: number`, compact reaction cluster/count, reply icon/count, and LinkedIn-style reply rail/elbow.

- [ ] **Step 1: Write the failing component test**

Test one root with two replies and assert the root renders a reaction metric such as `3`, a reply metric `2`, reply rows carry a reply-thread marker/test id, and zero reply counts are not rendered on leaf replies.

- [ ] **Step 2: Run test to verify RED**

Run: `npm test -- src/features/feed/components/comment-thread-social-metrics.test.tsx`
Expected: FAIL because current comment action row renders textual `reactions` and has no explicit reply-count metric/rail marker.

- [ ] **Step 3: Implement minimal presentation change**

Compute replies by root, pass `replyCount` to the root `CommentItem`, render active reaction emoji cluster + total count on the left, render `MessageCircle` + reply count next to it when non-zero, keep ReactionPicker/Reply controls, and use a vertical rail plus curved elbow pseudo-element/absolute element for reply rows.

- [ ] **Step 4: Run focused test GREEN, then exact-head CI**

Run focused test, then repository CI. Preserve all existing comment management/mention tests.

- [ ] **Step 5: Commit**

Commit message: `feat: clarify threaded reply metrics`

### Task 2: Stop reaction mutations from invalidating the full feed

**Files:**
- Modify: `src/features/feed/actions.ts`
- Modify/Test: `src/features/feed/actions.test.ts`
- Test: `src/features/feed/components/post-card-reaction.test.tsx` if an existing equivalent does not cover optimistic state.

**Interfaces:**
- Consumes: `setPostReactionWithAurora`, `setCommentReactionWithAurora`.
- Produces: reaction actions that persist and return `{ ok: true }` without calling broad `revalidateSocialFeed()`.

- [ ] **Step 1: Write failing action tests**

Mock `revalidatePath`; call `setPostReaction(postId, 'like')` and `setCommentReaction(commentId, 'support')`; assert service mutation succeeds and `revalidatePath` is not called.

- [ ] **Step 2: Verify RED**

Expected: FAIL because both current actions call `revalidateSocialFeed()`.

- [ ] **Step 3: Remove only reaction-route invalidation**

Keep optimistic client rollback behavior unchanged. Do not remove revalidation from create/delete post or unrelated actions in this task.

- [ ] **Step 4: Verify GREEN and exact-head CI**

Ensure post/card reaction tests prove local count/reaction changes remain immediate while media-bearing post components are not refreshed through router APIs.

- [ ] **Step 5: Commit**

Commit message: `fix: keep feed mounted during reactions`

### Task 3: Local comment/reply create, edit and delete without router refresh

**Files:**
- Modify: `src/features/feed/mappers.ts`
- Modify: `src/features/feed/queries.ts`
- Modify: `src/features/feed/actions.ts`
- Modify: `src/features/feed/components/comment-thread.tsx`
- Modify: `src/features/feed/components/post-card.tsx`
- Modify/Test: `src/features/feed/actions.test.ts`
- Modify/Test: `src/features/feed/components/comment-thread-management.test.tsx`

**Interfaces:**
- Produce exported `mapFeedComment(row, signedUrls)` helper.
- Produce `getCommentById(postId: string, commentId: string): Promise<FeedComment | null>` using `repository.getComments([postId], viewerId)`, resolving only comment-author avatar paths.
- `addComment` success becomes `{ ok: true, comment: FeedComment }`.
- `updateComment` success becomes `{ ok: true, comment: FeedComment }`.
- `deleteComment` success includes `{ ok: true, deleted: { id, postId, parentCommentId } }`.
- `CommentThread` owns `threadComments` local state and exposes comment-count delta callback to `PostCard`.

- [ ] **Step 1: Write failing action/component tests**

Assert add/update actions return hydrated comments; assert reply submission inserts the returned comment locally and never calls `router.refresh`; assert edit replaces local body; assert delete removes a reply/standalone root or renders `Comment deleted` for a root with live replies.

- [ ] **Step 2: Verify intended RED**

Current actions return only `{ ok: true }` and current component calls `router.refresh()`, so tests must fail for those reasons only.

- [ ] **Step 3: Add the minimal comment hydration query and richer action results**

Export `mapFeedComment`; hydrate only comments for the affected post, select the created/updated id, resolve author avatar paths, and return the mapped comment. Keep server-side validation and notification events unchanged.

- [ ] **Step 4: Move thread mutations to local state**

On confirmed add: append comment and increment local post comment count. On edit: replace matching comment. On delete: remove leaf; tombstone a root with live replies; decrement local count for the deleted live comment. Remove `router.refresh()` from these flows.

- [ ] **Step 5: Focused GREEN + exact-head CI, then commit**

Commit message: `feat: update comment threads without reload`

### Task 4: Live notifications without page reload

**Files:**
- Modify: `src/features/notifications/actions.ts`
- Modify: `src/features/notifications/components/notification-bell.tsx`
- Modify: `src/features/notifications/components/notification-list.tsx`
- Test: `src/features/notifications/components/notification-bell-live.test.tsx`
- Modify/Test: `src/features/notifications/components/notification-list.test.tsx`

**Interfaces:**
- Produce `loadNotificationChrome()` server action returning `{ ok: true, chrome: NotificationChrome } | { ok: false, error: string }`.
- Produce `loadNotifications(limit?: number)` for the notifications page if needed.
- Poll every 8 seconds only while `document.visibilityState === 'visible'`.

- [ ] **Step 1: Write failing polling/local-read tests**

Fake timers; mock live-load action; advance 8 seconds and assert bell unread count/new notification updates without `router.refresh()`. Assert successful read/mark-all updates local state immediately and navigation semantics stay intact.

- [ ] **Step 2: Verify RED**

Current bell is prop-static and calls `router.refresh()` after read operations.

- [ ] **Step 3: Implement minimal polling/local state**

Initialize local `recent`/`unreadCount`, poll on visible intervals, replace with newer server chrome on success, ignore transient poll failure without clearing existing UI, and update read state locally after successful mutation.

- [ ] **Step 4: Apply same behavior to notifications page**

Keep relative-time `<time dateTime title>` semantics from the previous notification-time work.

- [ ] **Step 5: GREEN + exact-head CI, then commit**

Commit message: `feat: live-update notifications`

### Task 5: Feed freshness indicator and infinite-scroll cursor pagination

**Files:**
- Modify: `src/features/feed/repository.ts`
- Modify: `src/features/feed/queries.ts`
- Modify: `src/features/feed/actions.ts`
- Modify: `src/features/feed/components/feed-list.tsx`
- Test: `src/features/feed/feed-freshness.test.ts`
- Test: `src/features/feed/components/feed-list-live.test.tsx`

**Interfaces:**
- Produce `FeedHeadMarker = { id: string; createdAt: string }`.
- Produce repository `getLatestVisiblePostMarker({ viewerProfileId, category? })` using lightweight SQL (`id`, `created_at` only) and the existing visibility rules.
- Produce `loadFeedHeadMarker({ category? })` server action.
- Poll marker every 8 seconds while visible; if marker differs from local head, display `New posts available` without auto-jumping.

- [ ] **Step 1: Write failing repository/component tests**

Assert marker SQL applies deleted/visibility/category rules. In the component, fake timers to surface `New posts available`; clicking it loads the latest first page and merges/de-duplicates new posts. Mock IntersectionObserver and assert intersecting the sentinel loads the next cursor page.

- [ ] **Step 2: Verify RED**

Current repository has no marker query, FeedList has no freshness polling, and pagination requires manual click.

- [ ] **Step 3: Implement lightweight marker action and UI polling**

Do not hydrate comments/media during the 8-second freshness check.

- [ ] **Step 4: Add IntersectionObserver with accessible fallback**

Observe a sentinel only while a cursor exists and no load is pending; keep the Load more button available as a fallback. Continue de-duplicating posts by id.

- [ ] **Step 5: GREEN + exact-head CI, then commit**

Commit message: `feat: add live feed freshness and infinite scroll`

### Task 6: Final verification and guarded staging rollout

**Files:**
- No production-code changes unless verification identifies a defect.
- Temporarily modify only `scripts/aws/staging-deploy-action.txt` for the existing one-time deployment workflow.

- [ ] **Step 1: Run fresh exact-head application/infra CI and AWS Remote Verify**

All jobs must be green at the exact code head.

- [ ] **Step 2: Verify all three guards are `plan` and branch has not moved**

Abort/inspect if unknown concurrent movement appears.

- [ ] **Step 3: Arm only staging deploy as `deploy-once`**

Pin deployment to the armed SHA; do not commit while deployment is active.

- [ ] **Step 4: Wait for full staging deployment success and verify public staging availability**

Do not claim interactive browser verification unless actually available.

- [ ] **Step 5: Restore staging guard to `plan`, then run exact-head safe-state CI/Remote Verify**

Final state must have all three guards at `plan`; no second deployment.
