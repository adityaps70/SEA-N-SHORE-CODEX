# Feed Social Interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Sea N Shore posts and comments with structured mentions, one-level replies, four reactions on posts and comments, in-app social notifications, LinkedIn-style default comment visibility, emoji insertion, profile avatars, and category-free-looking post UI.

**Architecture:** Extend the existing Aurora feed repository/service and current event-outbox/notification pipeline rather than adding a second social subsystem. Apply one additive Aurora migration (`0009_feed_social_interactions.sql`), preserve existing post `like` rows as the `like` reaction, keep `technical_discussion` only as internal post metadata, and reuse shared `PostCard`/comment components across Home, Activities and public profiles. Social mutations write their feed state and outbox event atomically; in-app notification persistence follows the existing direct-notification + shadow-event parity model until the current notification worker is deliberately cut over.

**Tech Stack:** Next.js 16.3.4, React 19.2.8, TypeScript 5, PostgreSQL/Aurora, `pg`, Zod 4, Vitest 4, Testing Library, Lucide React, AWS EventBridge/SQS/ECS, GitHub Actions + SSM guarded migrations.

**Spec:** `docs/superpowers/specs/2026-09-10-feed-social-interactions-design.md`

## Global Constraints

- Work only on `feat/aws-native-phase-0-1`; do not touch `main`, merge, or create a PR.
- Reactions on **both posts and comments** are exactly: `like` (Like 👍), `support` (Support ❤️), `respect` (Respect 🫡), `on_point` (On Point ⚓).
- Existing post reaction rows remain valid and continue as `like`.
- Comments support one top-level nesting level only; reply-to-reply normalizes to the root parent comment.
- Mentions are structured profile-ID references, never notification logic inferred only from display text.
- Notifications are in-app only; no email or OS push in this phase.
- Feed shows one top-level comment by default when comments exist and an inline `View N more comments` control for the remainder.
- Post category remains internal for compatibility but is removed from the normal composer/header UI.
- Database change is additive and guarded.
- Use TDD: create/commit RED tests first, verify expected failure, then implement minimum GREEN behavior.
- Existing AWS deployment guards must remain safe. `scripts/aws/staging-deploy-action.txt`, `scripts/aws/github-deploy-iam-action.txt`, and `scripts/aws/edge-recovery-action.txt` must finish as `plan`.
- Any new migration one-shot action must also finish as `plan`.

---

### Task 1: Establish RED social-interaction contracts

**Files:**
- Create: `src/feed-social-interactions-contract.test.tsx`
- Modify: `src/features/feed/components/post-card.test.tsx`
- Modify: `src/features/feed/components/post-composer.test.tsx`
- Create: `src/features/feed/components/comment-thread.test.tsx`

- [ ] Add contract assertions that normal posts no longer render the category badge, composer renders avatar when available, Emoji exists, four reaction labels exist, one comment is initially visible, `View N more comments` appears, and Reply is available.
- [ ] Add action-facing test fixtures that expect structured mention IDs and non-boolean reaction types.
- [ ] Commit RED tests before production code.
- [ ] Run exact-head AWS Infrastructure CI and record the expected test failure while lint/typecheck/guard contracts remain structurally valid.

**Focused command:**
```bash
npm test -- src/feed-social-interactions-contract.test.tsx src/features/feed/components/post-card.test.tsx src/features/feed/components/post-composer.test.tsx src/features/feed/components/comment-thread.test.tsx
```

**Commit:** `test: require feed social interactions`

---

### Task 2: Add the additive Aurora social schema and guarded migration

**Files:**
- Create: `infra/aws/database/migrations/0009_feed_social_interactions.sql`
- Create: `scripts/aws/feed-social-interactions-schema.test.mjs`
- Create: `scripts/aws/feed-social-interactions-migration.sh`
- Create: `scripts/aws/feed-social-interactions-migration-action.txt`
- Create: `.github/workflows/aws-feed-social-interactions-migration.yml`
- Modify: `.github/workflows/aws-infra-ci.yml`

**Schema requirements:**
- Extend `public.post_reaction_type` with `support`, `respect`, `on_point`; preserve `like`.
- Add nullable `parent_comment_id` to `public.post_comments`.
- Add a uniqueness target `(id, post_id)` and composite FK `(parent_comment_id, post_id) -> post_comments(id, post_id)` so a reply cannot point to a comment on another post.
- Add `public.comment_reactions` with `(comment_id, user_id)` uniqueness/primary key and the same reaction type enum.
- Add `public.content_mentions` with target kind (`post`/`comment`), target IDs, actor ID, mentioned profile ID, timestamps and uniqueness preventing duplicate same-member mentions per target.
- Extend `public.network_notification_type` (or migrate to a compatibly named broader enum if PostgreSQL constraints require it) with social types for post comment, comment reply, post reaction, comment reaction, post mention and comment mention.
- Add notification target fields required for deep links and dedupe (`post_id`, `comment_id`, `reaction_type`, `dedupe_key` or equivalent), with indexes for recipient chronology and logical deduplication.
- Keep existing network notifications readable without rewriting them.

**Guard requirements:**
- Migration action accepts only `plan|apply-once`.
- Verify account `310356785722`, exact SHA, exact branch/repo, Aurora cluster, and additive schema shape.
- Reuse the jobs-activities migration workflow/SSM pattern rather than inventing a new privileged path.
- Schema contract must reject destructive SQL and verify the four exact reaction values and new constraints/tables.

- [ ] Write schema contract first and confirm RED because `0009` does not exist.
- [ ] Add migration + guard script/workflow.
- [ ] Keep migration action at `plan` during application development.
- [ ] Run `npm test -- scripts/aws/feed-social-interactions-schema.test.mjs` and full CI contracts.

**Commit:** `feat: add feed social interaction schema contract`

---

### Task 3: Extend event contracts for feed social actions

**Files:**
- Modify: `src/features/events/types.ts`
- Modify: `src/features/events/validation.ts`
- Modify: `src/features/events/validation.test.ts`
- Modify: `src/features/events/outbox-publisher.test.ts` if its accepted event set is explicit
- Modify: `infra/aws/app/social-events.tf`
- Modify/create the existing Terraform/social-event contract test that validates EventBridge detail types

**Event types:**
- `post.commented`
- `comment.replied`
- `post.reacted`
- `comment.reacted`
- `post.mentioned`
- `comment.mentioned`

Each payload carries stable `actorId`, recipient/target ID, `postId`, optional `commentId`, and optional `reactionType`; aggregate types expand to `post` and `comment`.

- [ ] Write validation tests for all six events and rejection of malformed reaction/target payloads.
- [ ] Extend event type union/Zod schemas.
- [ ] Extend EventBridge notification rule detail-type list so shadow notification workers receive the new events.
- [ ] Run `npm test -- src/features/events/validation.test.ts src/features/events/outbox-publisher.test.ts` and Terraform validation.

**Commit:** `feat: define feed social domain events`

---

### Task 4: Build feed repository primitives for reactions, replies and mentions

**Files:**
- Modify: `src/features/feed/types.ts`
- Modify: `src/features/feed/mappers.ts`
- Modify: `src/features/feed/mappers.test.ts`
- Modify: `src/features/feed/repository.ts`
- Modify: `src/features/feed/repository.test.ts`

**Interfaces:**
- Add `POST_REACTIONS`/`PostReactionType` with the four approved values and label/emoji metadata.
- Replace viewer `likedPostIds` with viewer reaction state keyed by post while retaining compatibility helpers only where needed.
- Feed rows expose post reaction summary by type, total reaction count, and viewer reaction.
- Comment rows expose `parent_comment_id`, reaction summary, viewer reaction, author avatar and structured mentions.

**Repository mutations:**
- `setPostReaction(actorId, postId, reaction: PostReactionType | null)` performs atomic upsert/delete on `(post_id,user_id)`.
- `getCommentForInteraction(commentId, viewerId)` returns post/root-parent/author data with block/visibility checks.
- `addComment(...)` returns the new comment ID and accepts optional normalized parent ID.
- `setCommentReaction(actorId, commentId, reaction | null)` upserts/deletes one reaction per actor/comment.
- mention insert/list helpers validate target IDs and use `on conflict` semantics to dedupe repeated same-member mentions.
- add a paginated `listComments(postId, viewerId, {after/limit})` or equivalent so feed cards do not hydrate unbounded threads.

- [ ] Write RED repository/mapping tests for four-valued reactions, replacement/toggle persistence, reply composite-parent behavior, mention uniqueness, summaries and viewer reaction.
- [ ] Implement minimum SQL/mappers to satisfy them.
- [ ] Preserve all current media/poll/save/ownership tests.

**Focused command:**
```bash
npm test -- src/features/feed/repository.test.ts src/features/feed/mappers.test.ts
```

**Commit:** `feat: add feed reaction reply and mention persistence`

---

### Task 5: Make feed service mutations atomic and emit notifications/events

**Files:**
- Modify: `src/features/feed/service.ts`
- Modify: `src/features/feed/service.test.ts`
- Modify: `src/features/events/outbox-repository.ts` only if a small helper is needed
- Add a focused feed notification writer/repository helper if keeping notification SQL inside feed repository would blur boundaries

**Architecture:** Change `FeedTransaction` from a feed-repository-only callback to a context containing `feed`, `outbox`, and a minimal notification writer built from the same transaction client. Mirror the existing network-service pattern: immediate in-app notification + outbox event in the same database transaction; EventBridge notification consumer remains shadow parity until separately cut over.

**Rules:**
- Post reaction: notify post author unless actor is author. Change/remove reaction updates/removes the logical notification instead of inserting spam.
- Comment: notify post author unless self.
- Reply: normalize parent to root and notify root comment author unless self.
- Mentions: validate active/unblocked target profiles, persist unique mentions, notify each mentioned user at most once per target, suppress self.
- Comment reaction: notify comment author unless self.
- Successful primary social mutation must not depend on external EventBridge availability because outbox publishing is asynchronous.

- [ ] Write RED service tests for recipient rules, self suppression, root-parent normalization, reaction replacement, duplicate mention dedupe and outbox payloads.
- [ ] Implement transactional context and service methods.
- [ ] Keep old `setLiked` compatibility only temporarily inside tests/actions if needed, then remove it once callers are migrated.

**Focused command:**
```bash
npm test -- src/features/feed/service.test.ts
```

**Commit:** `feat: emit feed social notifications transactionally`

---

### Task 6: Expose safe mention candidate search

**Files:**
- Modify: `src/features/profiles/repository.ts`
- Modify: `src/features/profiles/repository-search.test.ts`
- Modify: `src/features/profiles/aws-queries.ts`
- Modify: `src/features/feed/actions.ts`
- Modify: `src/features/feed/actions.test.ts`

**Behavior:**
- Reuse the current discovery candidate SQL/visibility rules.
- Add a small capped mention search (for example max 8 results) using authenticated viewer ID, active/onboarded profiles, bilateral block exclusion and search tokens.
- Return only fields required by autocomplete plus hydrated avatar URL.
- Expose a server action/query callable from the mention control after a short query; empty query may return a small recent/discovery set but must stay capped.
- Never trust client-submitted mention profile IDs without service-side member/visibility validation.

- [ ] RED tests for capped results, exclusion of self only if desired for suggestions (self mention may remain text-valid), blocked users, and authenticated profile UUID usage.
- [ ] Implement query/action.

**Commit:** `feat: add member mention lookup`

---

### Task 7: Upgrade schemas and server actions

**Files:**
- Modify: `src/features/feed/schemas.ts`
- Modify: `src/features/feed/schemas.test.ts`
- Modify: `src/features/feed/actions.ts`
- Modify: `src/features/feed/actions.test.ts`

**Behavior:**
- Add reaction schema using exact four values.
- Add structured mention input schema: bounded array of unique UUIDs associated with body submission.
- Extend comment input with optional `parentCommentId` and mention IDs.
- Add `setPostReaction(postId, reaction|null)`, `setCommentReaction(commentId, reaction|null)`, `addReply`/extended `addComment`, and comment-page loading action.
- Post creation still supplies internal category metadata. Remove dependence on a visible category form control; if caller-specific `defaultCategory` is required by existing community/category flows, preserve it as hidden metadata, otherwise default server-side to `technical_discussion`.
- Revalidate `/home`, `/activities`, `/profile`, `/people/[slug]`, `/posts/[id]`, and notification surfaces as appropriate.

- [ ] Add RED action/schema tests first.
- [ ] Implement action wrappers and error-preserving form state.

**Commit:** `feat: expose social feed actions`

---

### Task 8: Build reusable MentionInput and EmojiPicker

**Files:**
- Create: `src/features/feed/components/mention-input.tsx`
- Create: `src/features/feed/components/mention-input.test.tsx`
- Create: `src/features/feed/components/emoji-picker.tsx`
- Create: `src/features/feed/components/emoji-picker.test.tsx`

**MentionInput:**
- Controlled textarea-compatible component with current text + structured selected mention IDs.
- Detect the active `@query` around cursor, debounce/cap server lookup, render accessible listbox, insert selected display name, and expose hidden mention IDs to forms.
- Keyboard support: ArrowUp/ArrowDown, Enter/Tab selection, Escape dismiss.
- If lookup fails, typing/submission still works as plain text; stale structured IDs are revalidated server-side.

**EmojiPicker:**
- Small curated general emoji grid, not a third-party heavy dependency.
- Insert at current cursor/selection and return focus to textarea.

- [ ] RED interaction tests using Testing Library/user-event.
- [ ] Implement components independently before wiring them into composer/comments.

**Commit:** `feat: add mention and emoji composer controls`

---

### Task 9: Simplify the post composer and remove visible category UI

**Files:**
- Modify: `src/features/feed/components/post-composer.tsx`
- Modify: `src/features/feed/components/post-composer.test.tsx`

**Behavior:**
- Show real `profile.avatarUrl` when present; initials only as fallback.
- Use `MentionInput` for body and submit structured mention IDs.
- Add Emoji button next to Photo/Video and Poll.
- Keep existing media direct-upload, poll and accessibility behavior.
- No visible category selection/label.
- `technical_discussion` remains internal compatibility metadata unless an existing caller intentionally provides another hidden `defaultCategory`.

- [ ] Update RED tests for avatar, emoji insertion, mentions, no visible category.
- [ ] Implement without regressing direct S3 upload and poll mode.

**Commit:** `feat: simplify social post composer`

---

### Task 10: Add shared four-reaction UI and upgrade PostCard

**Files:**
- Create: `src/features/feed/components/reaction-picker.tsx`
- Create: `src/features/feed/components/reaction-picker.test.tsx`
- Modify: `src/features/feed/components/post-card.tsx`
- Modify: `src/features/feed/components/post-card.test.tsx`

**Behavior:**
- Reaction picker choices exactly: Like 👍, Support ❤️, Respect 🫡, On Point ⚓.
- Current reaction appears as the main action label/icon; activating same reaction removes it, choosing another replaces it.
- Summary displays total and compact reaction icons; avoid exposing only `N likes` when reactions differ.
- Remove `POST_CATEGORY_LABELS[post.category]` badge from normal post header.
- Keep Comment / Share / Save and ownership controls.
- Default comment preview is rendered whenever `commentCount > 0`, not gated behind clicking Comment.
- Clicking Comment focuses/opens the composer without hiding the default existing comment.

- [ ] RED picker/PostCard tests.
- [ ] Implement optimistic state with rollback on action failure.

**Commit:** `feat: add maritime post reactions`

---

### Task 11: Rebuild CommentThread with one visible comment, replies, mentions and reactions

**Files:**
- Modify: `src/features/feed/components/comment-thread.tsx`
- Modify/Create: `src/features/feed/components/comment-thread.test.tsx`
- Create: `src/features/feed/components/comment-item.tsx`
- Create: `src/features/feed/components/reply-composer.tsx`

**Behavior:**
- Exactly one top-level existing comment visible by default, preferably latest if query order has no ranking.
- `View N more comments` loads/reveals additional top-level comments inline.
- Comment item shows avatar, linked name, rank/headline, timestamp, mention-aware body, reaction summary/control, Reply.
- Reply composer appears below parent and can pre-seed the replied-to author as structured `@mention` when selected.
- Replies display one indentation level; reply-to-reply stays under the same root.
- Main comment composer is always available for authenticated non-read-only cards.
- Shared reaction picker uses all four approved reactions for comments.

- [ ] RED tests for initial one-comment view, view-more count/expansion, reply focus/submission, one-level rendering, reactions and mention selection.
- [ ] Implement on-demand comment loading for large threads; do not return every comment for every feed post.

**Commit:** `feat: add threaded social comments`

---

### Task 12: Hydrate minimal initial comments and deep-linked targets

**Files:**
- Modify: `src/features/feed/queries.ts`
- Modify: `src/features/feed/queries.test.ts`
- Modify: `src/features/feed/mappers.ts`
- Modify: `src/app/(app)/posts/[id]/page.tsx` only if route data needs an explicit target hint
- Modify: `src/features/feed/components/comment-thread.tsx`

**Behavior:**
- Feed hydration loads only the initial comment preview plus counts/reaction summaries; detail pages may load a bounded first page.
- CommentThread inspects `window.location.hash` (`#comment-{uuid}`) after mount. If target is hidden, load/reveal the page containing it, then `scrollIntoView` and briefly highlight it.
- Public profile read-only post rendering remains readable without exposing mutation controls to signed-out visitors.

- [ ] RED query/deep-link tests.
- [ ] Implement bounded pagination and target reveal.

**Commit:** `feat: add comment previews and deep links`

---

### Task 13: Extend in-app notification persistence, copy, dedupe and chrome

**Files:**
- Modify: `src/features/notifications/types.ts`
- Modify: `src/features/notifications/repository.ts`
- Modify: `src/features/notifications/repository.test.ts`
- Modify: `src/features/notifications/event-repository.test.ts`
- Modify: `src/features/notifications/event-consumer.ts`
- Modify: `src/features/notifications/event-consumer.test.ts`
- Modify: `src/features/notifications/queries.ts`
- Modify: `src/features/notifications/queries.test.ts`
- Modify: `src/features/notifications/components/notification-bell.tsx`
- Modify: `src/features/notifications/components/notification-bell.test.tsx`
- Modify: `src/features/notifications/components/notification-list.tsx`

**Notification copy/destinations:**
- comment: `Rahul commented on your post.` → `/posts/{postId}#comment-{commentId}`
- reply: `Rahul replied to your comment.` → exact reply/comment anchor
- post reaction: `Rahul reacted ⚓ to your post.` (emoji varies by reaction) → post
- comment reaction: `Rahul reacted ❤️ to your comment.` → exact comment
- post mention: `Rahul mentioned you in a post.` → post
- comment/reply mention: `Rahul mentioned you in a comment.` → exact comment

**Dedupe:**
- Event receipt remains idempotent by event ID.
- Logical reaction notification is unique by recipient + actor + target; changing reaction updates its `reaction_type`, timestamp/read state as defined rather than inserting unlimited rows.
- One mention notification per recipient per target publication.
- Existing connection/follower destinations/copy remain unchanged.

- [ ] RED repository/consumer/query tests for six new types, self suppression assumptions, exact destinations and logical dedupe/upsert.
- [ ] Implement generalized notification row target metadata and copy mapping.
- [ ] Update empty-state text to include social activity, not only network activity.

**Commit:** `feat: add feed social in-app notifications`

---

### Task 14: Full regression and accessibility pass

**Files:**
- Modify focused tests only as required by intentional type/model changes.

- [ ] Run targeted suite:
```bash
npm test -- src/features/feed src/features/events src/features/notifications src/features/profiles/repository-search.test.ts
```
- [ ] Run full verification:
```bash
npm run lint
npm run typecheck
npm run test
npm run build
```
- [ ] Confirm existing video autoplay, direct media upload, polls, save, post ownership, Activities, public-profile posts, active navigation, notification chrome and AWS guard contracts remain green.
- [ ] Verify keyboard semantics for mention listbox/reaction picker and mobile no-overflow behavior in component tests where practical.
- [ ] Commit any intentional compatibility fixture updates separately from feature logic.

**Commit:** `test: cover feed social interaction regressions`

---

### Task 15: Apply `0009` through the guarded staging migration

**Precondition:** exact application/schema head is green and the new migration action file is `plan`.

- [ ] Confirm account/role expectations and all existing one-shot controls are `plan`.
- [ ] Change only `scripts/aws/feed-social-interactions-migration-action.txt` from `plan` to `apply-once`; commit.
- [ ] Wait for exact-head AWS Infrastructure CI and guarded migration workflow.
- [ ] Verify live Aurora shape: reaction enum values, reply FK, comment reactions, mentions, notification columns/types/indexes.
- [ ] Immediately return the migration action to `plan`; commit.
- [ ] Re-run/confirm safe-head schema verification.

**Never** use an unguarded SQL session or mutate the existing three deployment controls for this database step.

---

### Task 16: Deploy the tested application/infrastructure to staging

- [ ] Ensure `scripts/aws/feed-social-interactions-migration-action.txt` and the existing three one-shot controls are all `plan`.
- [ ] Confirm exact-head AWS Infrastructure CI is green.
- [ ] Arm only `scripts/aws/staging-deploy-action.txt` as `deploy-once`; commit.
- [ ] Wait for exact-head gate, immutable ECR image push, Terraform/app reconciliation, EventBridge detail-type update, ECS task/service stability, and exact image/revision verification.
- [ ] Verify staging at `https://d3prih0q6jofyr.cloudfront.net` using the repository Remote Verify/browser workflows.
- [ ] Specifically exercise: post four-reaction picker, comment four-reaction picker, one visible comment + View more, reply, post mention, comment mention, notification badge/list and deep link.
- [ ] Review current-deployment CloudWatch errors. Distinguish stale Server Action requests from new repeating errors, but do not ignore new application failures.
- [ ] Immediately set staging deploy action back to `plan`; commit.
- [ ] Verify final disarmed head: full CI green, Remote Verify acceptable, staging workflow skips deployment in plan mode, ECS steady at one deployment with desired/running/pending `1/1/0`.
- [ ] Re-fetch and confirm all one-shot files, including the new migration action, are exactly `plan\n`.

## Definition of Done

Sea N Shore members can create category-free-looking posts using their profile photo, emoji and structured `@mentions`; both posts and comments support **Like 👍 · Support ❤️ · Respect 🫡 · On Point ⚓**; one existing top-level comment is visible by default with LinkedIn-style View More; comments support one-level replies and mentions; and in-app notifications are created/deduplicated for comments, replies, reactions and mentions with exact post/comment deep links. Existing feed functionality remains green, Aurora migration is verified, staging rollout is exact and healthy, and every one-shot control is returned to `plan`.