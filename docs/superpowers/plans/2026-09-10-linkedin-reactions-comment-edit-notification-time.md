# LinkedIn-Style Reactions, Comment Editing, and Notification Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Sea N Shore feed reactions behave like LinkedIn, expose reactor identities on demand, add author-only comment/reply editing for 15 minutes and deletion anytime, and render notification age relatively.

**Architecture:** Extend the existing Aurora-backed feed repository/service/actions instead of introducing a second social subsystem. Feed hydration keeps aggregate reaction counts and viewer state only; reactor identities are fetched lazily when a shared reaction-details modal opens. Comment mutations remain server-authoritative for ownership and the 15-minute deadline, with soft-delete/tombstone rendering preserving reply threads.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, PostgreSQL/Aurora via `pg`, Zod, Tailwind CSS, lucide-react, Vitest + Testing Library, existing AWS guarded CI/deployment workflows.

**Spec:** `docs/superpowers/specs/2026-09-10-linkedin-reactions-comment-edit-notification-time-design.md`

## Global Constraints

- Work only on branch `feat/aws-native-phase-0-1`.
- Do not touch `main`, merge, or create a PR.
- Preserve reaction values exactly: `like`, `support`, `respect`, `on_point`.
- Feed hydration must not fetch full reactor identity lists.
- Comment/reply Edit is author-only and allowed strictly before `created_at + interval '15 minutes'`; at or after the cutoff it is rejected server-side.
- Comment/reply Delete is author-only and available anytime.
- Root comments with visible replies become tombstones after deletion; deleted bodies/mentions/reaction controls are never exposed.
- The existing schema already has `post_comments.created_at`, `updated_at`, `deleted_at`, and the `post_comments_set_updated_at` trigger in `infra/aws/database/migrations/0002_content_network.sql`. **No database migration is required for this feature.**
- Staging deployment must use `scripts/aws/staging-deploy-action.txt = deploy-once`, keep the branch pinned through exact deployment verification, then return it to `plan`.
- Keep `scripts/aws/edge-recovery-action.txt` and `scripts/aws/github-deploy-iam-action.txt` at `plan`.
- Correct AWS account is `310356785722`.

---

## File Structure

**Feed data/contracts**
- Modify `src/features/feed/types.ts` — reactor result types and comment ownership/edit/tombstone metadata.
- Modify `src/features/feed/mappers.ts` — map comment update/ownership/deletion metadata.
- Modify `src/features/feed/repository.ts` — lazy reactor reads and author-scoped comment update/delete SQL.
- Modify `src/features/feed/service.ts` — reactor reads, comment edit/delete, mention replacement, permission errors.
- Modify `src/features/feed/schemas.ts` — validate reaction-details queries and comment edit payloads.
- Modify `src/features/feed/actions.ts` — expose lazy reaction reads and comment edit/delete server actions.

**Feed UI**
- Modify `src/features/feed/components/reaction-picker.tsx` — neutral lucide thumbs-up when unreacted; selected emoji only when reacted.
- Create `src/features/feed/components/reaction-summary.tsx` — total-only summary + far-right unique reaction cluster trigger.
- Create `src/features/feed/components/reaction-details-modal.tsx` — shared post/comment reactor modal with tabs and lazy loading.
- Modify `src/features/feed/components/post-card.tsx` — one primary reaction icon and LinkedIn-style summary/modal behavior.
- Modify `src/features/feed/components/comment-thread.tsx` — total-only comment reactions, owner menu, inline edit, delete/tombstone behavior.

**Notifications**
- Create `src/lib/relative-time.ts` — deterministic relative-time formatter.
- Modify `src/features/notifications/components/notification-list.tsx` — relative visible age + precise timestamp metadata.

**Tests**
- Modify `src/features/feed/mappers.test.ts`.
- Modify `src/features/feed/repository.test.ts`.
- Modify `src/features/feed/service.test.ts`.
- Modify `src/features/feed/schemas.test.ts`.
- Modify `src/features/feed/actions.test.ts`.
- Modify `src/features/feed/components/reaction-picker-hover.test.tsx`.
- Create `src/features/feed/components/reaction-summary.test.tsx`.
- Create `src/features/feed/components/reaction-details-modal.test.tsx`.
- Modify `src/features/feed/components/post-card.test.tsx`.
- Modify `src/features/feed/components/post-card-owner.test.tsx` only for ownership regressions if required by changed props.
- Modify `src/features/feed/components/comment-thread-mentions.test.tsx`.
- Create `src/features/feed/components/comment-thread-management.test.tsx`.
- Create `src/features/notifications/components/notification-list.test.tsx`.
- Create `src/lib/relative-time.test.ts`.
- Run `src/feed-social-interactions-contract.test.tsx` as an integration regression guard.

---

### Task 1: Extend feed types and comment hydration metadata

**Files:**
- Modify: `src/features/feed/types.ts`
- Modify: `src/features/feed/mappers.ts`
- Modify: `src/features/feed/mappers.test.ts`
- Modify: `src/features/feed/repository.ts`
- Modify: `src/features/feed/repository.test.ts`

- [ ] **Step 1: Write failing mapper/repository tests for comment metadata.**

Require comment rows to expose `updated_at`, `deleted_at`, `viewer_owns`, and `can_edit`, with edit eligibility computed server-side in SQL using database time.

```ts
expect(post.comments[0]).toMatchObject({
  updatedAt: '2026-09-10T09:10:00.000Z',
  viewerOwns: true,
  canEdit: true,
  deleted: false,
})
```

- [ ] **Step 2: Run RED.**

```bash
npm test -- src/features/feed/mappers.test.ts src/features/feed/repository.test.ts
```
Expected: FAIL because the new metadata is not hydrated.

- [ ] **Step 3: Add exact types and query fields.**

Add:
```ts
export type ReactionTargetType = 'post' | 'comment'
export type ReactorProfile = FeedAuthor & {
  reaction: PostReactionType
  reactedAt: string
}
export type ReactionDetailsPage = {
  reactors: ReactorProfile[]
  nextCursor: string | null
}
```

Extend `FeedComment` with `updatedAt`, `viewerOwns`, `canEdit`, and `deleted`. In `getComments`, derive `viewer_owns` from `author_id = viewerProfileId` and `can_edit` from ownership plus `now() < c.created_at + interval '15 minutes'`. Do not derive permissions from browser/client time.

- [ ] **Step 4: Run GREEN.**

```bash
npm test -- src/features/feed/mappers.test.ts src/features/feed/repository.test.ts
npm run typecheck
```
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/features/feed/types.ts src/features/feed/mappers.ts src/features/feed/mappers.test.ts src/features/feed/repository.ts src/features/feed/repository.test.ts
git commit -m "feat: extend feed comment interaction metadata"
```

---

### Task 2: Add lazy reactor identity reads for posts and comments

**Files:**
- Modify: `src/features/feed/schemas.ts`
- Modify: `src/features/feed/schemas.test.ts`
- Modify: `src/features/feed/repository.ts`
- Modify: `src/features/feed/repository.test.ts`
- Modify: `src/features/feed/service.ts`
- Modify: `src/features/feed/service.test.ts`
- Modify: `src/features/feed/actions.ts`
- Modify: `src/features/feed/actions.test.ts`

- [ ] **Step 1: Write RED schema/repository tests.**

Cover both `post_reactions` and `comment_reactions`, optional reaction filter, stable pagination, active-profile filtering, and existing user-block visibility rules. The normal feed query must remain aggregate-only.

- [ ] **Step 2: Run RED.**

```bash
npm test -- src/features/feed/schemas.test.ts src/features/feed/repository.test.ts
```
Expected: FAIL because reaction-details read contracts do not exist.

- [ ] **Step 3: Implement schema and repository query.**

Use a Zod input with `targetType`, UUID `targetId`, optional reaction, cursor, and `limit` capped at 50. Query existing reaction tables and join `profiles`/`maritime_profiles`. Return profile identity, reaction type, and reaction created time. Fetch `limit + 1` to derive `nextCursor`.

- [ ] **Step 4: Write RED service/action tests.**

Cover invalid target IDs/reactions, authentication, successful post/comment reads, safe generic errors, and profile avatar URL hydration.

- [ ] **Step 5: Implement service/action.**

Expose:
```ts
export async function loadReactionDetails(input: {
  targetType: 'post' | 'comment'
  targetId: string
  reaction?: PostReactionType
  cursor?: string
  limit?: number
}): Promise<{ ok: true; page: ReactionDetailsPage } | { ok: false; error: string }>
```

Do not include aggregate summary in the lazy response; the modal receives the already-hydrated `ReactionSummary` from the feed/comment card for tab counts.

- [ ] **Step 6: Run GREEN.**

```bash
npm test -- src/features/feed/schemas.test.ts src/features/feed/repository.test.ts src/features/feed/service.test.ts src/features/feed/actions.test.ts
npm run typecheck
```
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add src/features/feed/schemas.ts src/features/feed/schemas.test.ts src/features/feed/repository.ts src/features/feed/repository.test.ts src/features/feed/service.ts src/features/feed/service.test.ts src/features/feed/actions.ts src/features/feed/actions.test.ts
git commit -m "feat: add lazy reaction detail reads"
```

---

### Task 3: Build reusable reaction summary and reaction-details modal

**Files:**
- Create: `src/features/feed/components/reaction-summary.tsx`
- Create: `src/features/feed/components/reaction-summary.test.tsx`
- Create: `src/features/feed/components/reaction-details-modal.tsx`
- Create: `src/features/feed/components/reaction-details-modal.test.tsx`

- [ ] **Step 1: Write RED summary tests.**

Require the left side to show only `N reaction(s)`, never an active-emoji string. Require the **extreme-right** trigger to show only unique active reaction types; the comment count sits immediately to its left. When total is zero, render a neutral lucide `ThumbsUp` affordance.

- [ ] **Step 2: Implement `ReactionSummary`.**

Expose a reusable component receiving `summary`, optional `commentCount`, and `onOpen`. The total text and far-right unique-type cluster both open the same modal. Keep cluster compact and Sea N Shore styled.

- [ ] **Step 3: Write RED modal tests.**

Mock `loadReactionDetails`. Require `All` plus only non-zero type tabs, tab counts from the passed aggregate summary, reactor rows with avatar/name/rank/company/exact reaction, profile links, loading/error/retry, close behavior, and a fresh lazy read when filters change.

- [ ] **Step 4: Implement modal.**

Use a centered rounded Sea N Shore modal with mobile-scrollable tabs and vertically scrollable reactor list. `All` loads all; type tabs pass the reaction filter. Preserve accessibility with dialog labelling and focusable close control.

- [ ] **Step 5: Run GREEN.**

```bash
npm test -- src/features/feed/components/reaction-summary.test.tsx src/features/feed/components/reaction-details-modal.test.tsx
npm run typecheck
```
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/features/feed/components/reaction-summary.tsx src/features/feed/components/reaction-summary.test.tsx src/features/feed/components/reaction-details-modal.tsx src/features/feed/components/reaction-details-modal.test.tsx
git commit -m "feat: add reaction summary and reactor modal"
```

---

### Task 4: Make post reaction controls single-icon and wire the modal

**Files:**
- Modify: `src/features/feed/components/reaction-picker.tsx`
- Modify: `src/features/feed/components/reaction-picker-hover.test.tsx`
- Modify: `src/features/feed/components/post-card.tsx`
- Modify: `src/features/feed/components/post-card.test.tsx`
- Modify: `src/features/feed/components/post-card-owner.test.tsx` only if changed props affect its fixture contract.

- [ ] **Step 1: Write RED reaction-picker test.**

Require unreacted state to render a neutral lucide thumbs-up icon and not the yellow `👍` emoji. Reacted state must render only the viewer's selected emoji. Preserve the fast custom top tooltip in the reaction tray.

- [ ] **Step 2: Implement neutral unreacted icon.**

Import `ThumbsUp` from `lucide-react`; use it only when `value === null`. Clicking unreacted still selects Like; clicking the selected reaction still removes it.

- [ ] **Step 3: Write RED `post-card.test.tsx` layout tests.**

Require one primary reaction control only, total-only left summary, comment count immediately left of the far-right unique reaction cluster, and modal opening from total/cluster.

- [ ] **Step 4: Wire `PostCard`.**

Remove the old `ReactionSummaryLine`, use the shared summary/modal components, and keep optimistic reaction count updates/rollback unchanged.

- [ ] **Step 5: Run GREEN.**

```bash
npm test -- src/features/feed/components/reaction-picker-hover.test.tsx src/features/feed/components/post-card.test.tsx src/features/feed/components/post-card-owner.test.tsx src/features/feed/components/reaction-summary.test.tsx src/features/feed/components/reaction-details-modal.test.tsx
npm run typecheck
```
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/features/feed/components/reaction-picker.tsx src/features/feed/components/reaction-picker-hover.test.tsx src/features/feed/components/post-card.tsx src/features/feed/components/post-card.test.tsx src/features/feed/components/post-card-owner.test.tsx
git commit -m "feat: align post reactions with linkedin behavior"
```

---

### Task 5: Add server-authoritative comment/reply edit and delete

**Files:**
- Modify: `src/features/feed/schemas.ts`
- Modify: `src/features/feed/schemas.test.ts`
- Modify: `src/features/feed/repository.ts`
- Modify: `src/features/feed/repository.test.ts`
- Modify: `src/features/feed/service.ts`
- Modify: `src/features/feed/service.test.ts`
- Modify: `src/features/feed/actions.ts`
- Modify: `src/features/feed/actions.test.ts`

**No migration:** `post_comments.updated_at`, `deleted_at`, and the update trigger already exist in migration `0002_content_network.sql`.

- [ ] **Step 1: Write RED schema/repository/service tests for ownership and timing.**

Test exact boundaries:
```ts
createdAt = now - 14m59s // edit succeeds
createdAt = now - 15m00s // edit rejected
```
Also require non-owner edit/delete rejection, deleted-target edit rejection, delete after 15 minutes success, and preservation of comment ID/post/parent relationship.

- [ ] **Step 2: Write RED mention-replacement tests.**

An edit replaces that comment's `content_mentions` in the same transaction, deduplicates mentions, validates visibility/blocking, and emits mention notification/event only for newly introduced mentionees. Removing a mention emits no notification.

- [ ] **Step 3: Implement repository/service mutations.**

Use server/database time for edit cutoff:
```sql
where id = $commentId
  and author_id = $viewerId
  and deleted_at is null
  and now() < created_at + interval '15 minutes'
```

Soft-delete:
```sql
update public.post_comments
set deleted_at = now()
where id = $1 and author_id = $2 and deleted_at is null
returning id, post_id, parent_comment_id;
```

- [ ] **Step 4: Hydrate root tombstones safely.**

Return a deleted root only when it has at least one non-deleted visible reply. For tombstone rows, map `deleted: true` and do not expose the deleted body/mentions/reaction state to UI rendering. Deleted replies and deleted roots without visible replies are excluded.

- [ ] **Step 5: Implement actions and safe errors.**

Expose `updateComment` and `deleteComment`. Expired edits return exactly: `Comments can only be edited for 15 minutes after posting.` Permission/not-found failures remain generic.

- [ ] **Step 6: Run GREEN.**

```bash
npm test -- src/features/feed/schemas.test.ts src/features/feed/repository.test.ts src/features/feed/service.test.ts src/features/feed/actions.test.ts
npm run typecheck
```
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add src/features/feed/schemas.ts src/features/feed/schemas.test.ts src/features/feed/repository.ts src/features/feed/repository.test.ts src/features/feed/service.ts src/features/feed/service.test.ts src/features/feed/actions.ts src/features/feed/actions.test.ts
git commit -m "feat: add controlled comment edit and delete"
```

---

### Task 6: Add comment/reply menus, inline editing, tombstones, and LinkedIn-style reactions

**Files:**
- Modify: `src/features/feed/components/comment-thread.tsx`
- Modify: `src/features/feed/components/comment-thread-mentions.test.tsx`
- Create: `src/features/feed/components/comment-thread-management.test.tsx`
- Modify: `src/features/feed/components/reaction-summary.tsx` only if comment-specific compact props are required.
- Modify: `src/features/feed/components/reaction-summary.test.tsx` for those compact props if required.

- [ ] **Step 1: Write RED management tests.**

Cover own fresh comment/reply showing `•••` with Edit + Delete, own expired item showing Delete only, non-owner no menu, inline `MentionInput` edit, successful save, stale save preserving draft/error, root tombstone preserving replies, deleted reply disappearing, and tombstone hiding body/mentions/reactions/management.

- [ ] **Step 2: Implement owner menu and inline editor.**

Use lucide `MoreHorizontal`, `Pencil`, `Trash2`. Edit is initially shown from server-hydrated `canEdit`; client may hide it as the deadline passes, but server remains authoritative. Preserve existing mention autocomplete.

- [ ] **Step 3: Replace comment reaction duplication.**

Show total count only plus unique-type cluster. The viewer action is one neutral thumbs-up or selected emoji. Clicking count/cluster opens `ReactionDetailsModal` with `targetType="comment"`.

- [ ] **Step 4: Render tombstones.**

A deleted root with visible replies shows only a muted `Comment deleted` shell and retains replies. A deleted standalone comment/reply is absent.

- [ ] **Step 5: Run GREEN.**

```bash
npm test -- src/features/feed/components/comment-thread-mentions.test.tsx src/features/feed/components/comment-thread-management.test.tsx src/features/feed/components/reaction-summary.test.tsx src/features/feed/components/reaction-details-modal.test.tsx
npm run typecheck
```
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/features/feed/components/comment-thread.tsx src/features/feed/components/comment-thread-mentions.test.tsx src/features/feed/components/comment-thread-management.test.tsx src/features/feed/components/reaction-summary.tsx src/features/feed/components/reaction-summary.test.tsx
git commit -m "feat: add comment management and reaction details"
```

---

### Task 7: Render notification age relatively

**Files:**
- Create: `src/lib/relative-time.ts`
- Create: `src/lib/relative-time.test.ts`
- Modify: `src/features/notifications/components/notification-list.tsx`
- Create: `src/features/notifications/components/notification-list.test.tsx`

- [ ] **Step 1: Write RED formatter tests with a fixed clock.**

Cover `just now`, minutes, hours, days, older compact dates, and small future-clock skew.

```ts
expect(relativeTimeFrom('2026-09-10T09:28:30Z', Date.parse('2026-09-10T09:29:00Z'))).toBe('just now')
expect(relativeTimeFrom('2026-09-10T09:27:00Z', Date.parse('2026-09-10T09:29:00Z'))).toBe('2m')
```

- [ ] **Step 2: Implement `relativeTimeFrom`.**

Keep it deterministic by accepting optional `now`; future-skewed recent timestamps return `just now` instead of negative age.

- [ ] **Step 3: Write RED notification-list component test.**

Require visible relative age while `<time dateTime>` and `title` retain the precise timestamp. Read/unread and navigation behavior must remain unchanged.

- [ ] **Step 4: Update `notification-list.tsx`.**

Remove visible absolute `UTC` formatting and use the shared relative-time helper.

- [ ] **Step 5: Run GREEN.**

```bash
npm test -- src/lib/relative-time.test.ts src/features/notifications/components/notification-list.test.tsx
npm run typecheck
```
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/relative-time.ts src/lib/relative-time.test.ts src/features/notifications/components/notification-list.tsx src/features/notifications/components/notification-list.test.tsx
git commit -m "feat: show relative notification time"
```

---

### Task 8: Full regression verification and guarded staging rollout

**Files:**
- Test-only fixes if a genuine regression is discovered.
- Temporarily modify then restore: `scripts/aws/staging-deploy-action.txt`.
- Verify unchanged at `plan`: `scripts/aws/edge-recovery-action.txt`, `scripts/aws/github-deploy-iam-action.txt`.

- [ ] **Step 1: Run full application regression.**

```bash
npm run lint
npm run typecheck
npm test
npm run build
```
Also explicitly require `src/feed-social-interactions-contract.test.tsx` to pass within the suite.

- [ ] **Step 2: Require exact-head AWS Infrastructure CI green.**

Require Application verify, Docker build, Terraform app/bootstrap validation, Terraform plan guard tests, and GitHub SSM execution contract.

- [ ] **Step 3: Confirm one-shot guard states before arming.**

```text
scripts/aws/staging-deploy-action.txt = plan
scripts/aws/edge-recovery-action.txt = plan
scripts/aws/github-deploy-iam-action.txt = plan
```

- [ ] **Step 4: Arm staging once.**

Change only `scripts/aws/staging-deploy-action.txt` from `plan` to `deploy-once`, commit on the feature branch, and **do not move the branch** until the deployment workflow completes exact ECS verification.

- [ ] **Step 5: Verify AWS deployment.**

Require correct AWS account `310356785722`, immutable image push, task-definition registration, ECS desired/running/pending `1/1/0`, rollout `COMPLETED`, and exact image/task-definition verification success.

- [ ] **Step 6: Disarm only after deployment completion.**

Return `scripts/aws/staging-deploy-action.txt` to `plan` and commit on the feature branch.

- [ ] **Step 7: Verify safe-head workflows and all guards.**

Require AWS Remote Verify success on the disarm head, exact-head CI green, and both edge-recovery/IAM guard files still `plan`.

- [ ] **Step 8: Manual staging acceptance at `https://d3prih0q6jofyr.cloudfront.net`.**

Verify:
1. unreacted post/comment action shows neutral thumbs-up matching Share/Save styling;
2. reacted action shows only the viewer's selected reaction;
3. left summary shows only total reaction count;
4. comment count is immediately left of the extreme-right unique reaction cluster;
5. clicking total or cluster opens the modal with All/type tabs and named reactors;
6. own fresh comment/reply offers Edit + Delete, Edit disappears after 15 minutes, and stale server saves reject;
7. Delete remains available; root tombstones preserve replies;
8. notifications show `just now` / `Xm` / `Xh` / `Xd` instead of visible UTC timestamps;
9. mentions, replies, save, share, polls, media, and read-only paths still work.

- [ ] **Step 9: Final safety report.**

Report safe-head SHA, deployed task definition/image digest, ECS status, Remote Verify result, all guard states, and explicitly state `main` was untouched and no merge/PR was created.
