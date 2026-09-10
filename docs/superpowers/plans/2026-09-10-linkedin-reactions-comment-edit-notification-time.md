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
- Staging deployment must use `scripts/aws/staging-deploy-action.txt = deploy-once`, keep the branch pinned through exact deployment verification, then return it to `plan`.
- Keep `scripts/aws/edge-recovery-action.txt` and `scripts/aws/github-deploy-iam-action.txt` at `plan`.
- Correct AWS account is `310356785722`.

---

## File Structure

**Feed data/contracts**
- Modify `src/features/feed/types.ts` — add reactor result types and comment ownership/edit/tombstone metadata.
- Modify `src/features/feed/mappers.ts` — map comment update/ownership/deletion metadata.
- Modify `src/features/feed/repository.ts` — add lazy reactor reads and author-scoped comment update/delete SQL.
- Modify `src/features/feed/service.ts` — orchestrate reactor reads, comment edit/delete, mention replacement, and permission errors.
- Modify `src/features/feed/schemas.ts` — validate reaction-details queries and comment edit payloads.
- Modify `src/features/feed/actions.ts` — expose lazy reaction reads and comment edit/delete server actions.

**Feed UI**
- Modify `src/features/feed/components/reaction-picker.tsx` — neutral lucide thumbs-up when unreacted; selected emoji only when reacted.
- Create `src/features/feed/components/reaction-summary.tsx` — reusable total-only summary + unique reaction cluster trigger.
- Create `src/features/feed/components/reaction-details-modal.tsx` — shared post/comment reactor modal with tabs and lazy loading.
- Modify `src/features/feed/components/post-card.tsx` — use total-only summary, far-right cluster, one primary reaction icon.
- Modify `src/features/feed/components/comment-thread.tsx` — total-only comment reactions, modal trigger, owner menu, inline edit, delete/tombstone behavior.

**Notifications**
- Create `src/lib/relative-time.ts` — one shared deterministic relative-time formatter.
- Modify `src/features/notifications/components/notification-list.tsx` — render relative notification age and retain precise accessible timestamp.

**Tests**
- Modify `src/features/feed/types.test.ts` only if existing type helper tests require extension; otherwise no new type-only test.
- Modify `src/features/feed/mappers.test.ts`.
- Modify `src/features/feed/repository.test.ts`.
- Modify `src/features/feed/service.test.ts`.
- Modify `src/features/feed/actions.test.ts`.
- Modify `src/features/feed/components/reaction-picker-hover.test.tsx`.
- Create `src/features/feed/components/reaction-summary.test.tsx`.
- Create `src/features/feed/components/reaction-details-modal.test.tsx`.
- Modify existing post-card reaction test(s) in `src/features/feed/components/`.
- Modify `src/features/feed/components/comment-thread-mentions.test.tsx` and add `src/features/feed/components/comment-thread-management.test.tsx`.
- Add or modify notification-list tests under `src/features/notifications/components/`.
- Create `src/lib/relative-time.test.ts`.

---

### Task 1: Extend feed types and comment hydration metadata

**Files:**
- Modify: `src/features/feed/types.ts`
- Modify: `src/features/feed/mappers.ts`
- Modify: `src/features/feed/mappers.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ReactionTargetType = 'post' | 'comment'
  export type ReactorProfile = FeedAuthor & {
    reaction: PostReactionType
    reactedAt: string
  }
  export type ReactionDetailsPage = {
    reactors: ReactorProfile[]
    summary: ReactionSummary
    nextCursor: string | null
  }
  ```
- Extends `FeedComment` with:
  ```ts
  updatedAt: string
  viewerOwns: boolean
  canEdit: boolean
  deleted: boolean
  ```

- [ ] **Step 1: Write failing mapper tests for comment metadata**

Add fixtures that include `updated_at`, `deleted_at`, and an author matching the viewer. Assert the mapped comment exposes `updatedAt`, `viewerOwns`, and `deleted`, and derives `canEdit` from an explicit row field rather than client time.

```ts
expect(post.comments[0]).toMatchObject({
  updatedAt: '2026-09-10T09:10:00.000Z',
  viewerOwns: true,
  canEdit: true,
  deleted: false,
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:
```bash
npm test -- src/features/feed/mappers.test.ts
```
Expected: FAIL because the new properties do not exist.

- [ ] **Step 3: Add exact types and mapper fields**

Extend `FeedCommentRow` with `updated_at`, `deleted_at`, and `can_edit`; map them directly. Do not calculate the 15-minute window in the mapper.

- [ ] **Step 4: Run focused tests and typecheck**

```bash
npm test -- src/features/feed/mappers.test.ts
npm run typecheck
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/feed/types.ts src/features/feed/mappers.ts src/features/feed/mappers.test.ts
git commit -m "feat: extend feed comment interaction metadata"
```

---

### Task 2: Add lazy reactor identity queries for posts and comments

**Files:**
- Modify: `src/features/feed/schemas.ts`
- Modify: `src/features/feed/repository.ts`
- Modify: `src/features/feed/repository.test.ts`
- Modify: `src/features/feed/service.ts`
- Modify: `src/features/feed/service.test.ts`
- Modify: `src/features/feed/actions.ts`
- Modify: `src/features/feed/actions.test.ts`

**Interfaces:**
- Produces server action:
  ```ts
  export async function loadReactionDetails(input: {
    targetType: 'post' | 'comment'
    targetId: string
    reaction?: PostReactionType
    cursor?: string
    limit?: number
  }): Promise<{ ok: true; page: ReactionDetailsPage } | { ok: false; error: string }>
  ```
- Repository method:
  ```ts
  listReactionDetails(input: {
    viewerProfileId: string
    targetType: ReactionTargetType
    targetId: string
    reaction?: PostReactionType
    cursor?: string
    limit: number
  }): Promise<{ rows: ReactorRow[]; nextCursor: string | null }>
  ```

- [ ] **Step 1: Write RED repository tests for post and comment reactors**

Assert generated SQL joins the appropriate reaction table to `profiles` and `maritime_profiles`, filters deleted/inactive/blocked identities using the existing feed visibility rules, optionally filters `reaction_type`, and orders by newest reaction first with a stable secondary key.

- [ ] **Step 2: Run repository tests**

```bash
npm test -- src/features/feed/repository.test.ts
```
Expected: FAIL because `listReactionDetails` is absent.

- [ ] **Step 3: Implement repository query and cursor contract**

Use the existing reaction tables. Return profile identity + `reaction_type` + `created_at`; use `limit + 1` to derive `nextCursor`. Do not modify normal `FEED_ROW_SELECT` to fetch names of reactors.

- [ ] **Step 4: Write RED service/action tests**

Cover invalid target IDs, invalid reaction filters, authentication, successful post/comment reads, and safe generic error response.

- [ ] **Step 5: Implement Zod schema, service mapping, and server action**

Use:
```ts
const reactionDetailsSchema = z.object({
  targetType: z.enum(['post', 'comment']),
  targetId: z.string().uuid(),
  reaction: reactionSchema.optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(30),
})
```
Map avatar storage paths to signed URLs using the same feed media/profile signing path already used by feed queries.

- [ ] **Step 6: Run focused tests**

```bash
npm test -- src/features/feed/repository.test.ts src/features/feed/service.test.ts src/features/feed/actions.test.ts
npm run typecheck
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/feed/schemas.ts src/features/feed/repository.ts src/features/feed/repository.test.ts src/features/feed/service.ts src/features/feed/service.test.ts src/features/feed/actions.ts src/features/feed/actions.test.ts
git commit -m "feat: add lazy reaction detail reads"
```

---

### Task 3: Build the LinkedIn-style reaction summary and reactor modal

**Files:**
- Create: `src/features/feed/components/reaction-summary.tsx`
- Create: `src/features/feed/components/reaction-summary.test.tsx`
- Create: `src/features/feed/components/reaction-details-modal.tsx`
- Create: `src/features/feed/components/reaction-details-modal.test.tsx`

**Interfaces:**
- `ReactionSummaryTrigger`:
  ```ts
  function ReactionSummaryTrigger(props: {
    summary: ReactionSummary
    commentCount?: number
    onOpen(): void
  }): JSX.Element
  ```
- `ReactionDetailsModal`:
  ```ts
  function ReactionDetailsModal(props: {
    open: boolean
    targetType: ReactionTargetType
    targetId: string
    summary: ReactionSummary
    onClose(): void
  }): JSX.Element | null
  ```

- [ ] **Step 1: Write RED summary tests**

Assert:
```ts
expect(screen.getByText('53 reactions')).toBeInTheDocument()
expect(screen.queryByText('👍❤️⚓')).not.toBeInTheDocument()
expect(screen.getByRole('button', { name: /view reactions/i })).toBeInTheDocument()
```
Also assert the far-right cluster contains unique active types only and neutral `ThumbsUp` when total is zero.

- [ ] **Step 2: Implement `ReactionSummaryTrigger`**

Render left total text only. Render right cluster as overlapping/compact emoji circles for active types, or lucide `ThumbsUp` for empty state. Keep comment count nearby when supplied.

- [ ] **Step 3: Write RED modal tests**

Mock `loadReactionDetails`. Assert All + only non-zero reaction tabs, names/profile links, exact reaction icon per row, loading/error states, close button, and filtering triggers a fresh lazy read.

- [ ] **Step 4: Implement modal**

Use fixed overlay + centered rounded Sea N Shore card. Suggested structural classes:
```tsx
<div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/35 p-4">
  <section className="flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-[1.5rem] border border-mist-100 bg-white shadow-2xl">
```
Keep tabs horizontally scrollable on mobile and reactor list vertically scrollable.

- [ ] **Step 5: Run tests**

```bash
npm test -- src/features/feed/components/reaction-summary.test.tsx src/features/feed/components/reaction-details-modal.test.tsx
npm run typecheck
```
Expected: PASS.

- [ ] **Step 6: Commit**

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
- Modify: relevant post-card test file(s) under `src/features/feed/components/`

**Interfaces:**
- Consumes `ReactionSummaryTrigger` and `ReactionDetailsModal` from Task 3.

- [ ] **Step 1: Write RED picker tests for unreacted state**

Assert unreacted trigger contains lucide-style SVG and not the yellow `👍` emoji; reacted state continues to show only the selected emoji.

- [ ] **Step 2: Implement neutral unreacted icon**

Import `ThumbsUp` from `lucide-react`. Use it only when `value === null`; keep existing hover reaction tray and custom tooltips.

- [ ] **Step 3: Write RED post-card layout tests**

Assert only total text is present in left summary, unique reaction cluster is the clickable detail trigger, only one user-reaction control appears in action row, and modal opens from either total/cluster interaction.

- [ ] **Step 4: Replace `ReactionSummaryLine` in `post-card.tsx`**

Remove the current active-emoji rendering. Add local modal-open state and shared summary/modal components. Keep optimistic reaction state updates unchanged so summary counts update immediately.

- [ ] **Step 5: Run focused tests**

```bash
npm test -- src/features/feed/components/reaction-picker-hover.test.tsx src/features/feed/components/reaction-summary.test.tsx src/features/feed/components/reaction-details-modal.test.tsx
npm run typecheck
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/feed/components/reaction-picker.tsx src/features/feed/components/reaction-picker-hover.test.tsx src/features/feed/components/post-card.tsx src/features/feed/components
git commit -m "feat: align post reactions with linkedin behavior"
```

---

### Task 5: Add server-authoritative comment edit/delete behavior

**Files:**
- Modify: `src/features/feed/repository.ts`
- Modify: `src/features/feed/repository.test.ts`
- Modify: `src/features/feed/service.ts`
- Modify: `src/features/feed/service.test.ts`
- Modify: `src/features/feed/schemas.ts`
- Modify: `src/features/feed/actions.ts`
- Modify: `src/features/feed/actions.test.ts`
- If schema inspection proves `post_comments.updated_at` is missing, create one additive migration using the repository's existing Aurora migration naming/guard pattern and add its migration contract test.

**Interfaces:**
- Server actions:
  ```ts
  export async function updateComment(input: {
    commentId: string
    body: string
    mentionProfileIds: string[]
  }): Promise<FeedActionResult>

  export async function deleteComment(commentId: string): Promise<FeedActionResult>
  ```

- [ ] **Step 1: Write RED repository/service tests for ownership and timing**

Use SQL/service fixtures for these exact boundaries:
```ts
createdAt = now - 14m59s // edit succeeds
createdAt = now - 15m00s // edit rejected
```
Assert non-owner edit/delete rejects, deleted target rejects edit, delete is allowed after 15 minutes, and update retains `id`, `post_id`, and `parent_comment_id`.

- [ ] **Step 2: Write RED tests for mention replacement**

Assert edit transaction deletes prior `content_mentions` for the comment, validates/deduplicates the submitted mention IDs, reinserts current mentions, and emits mention notification/event only for newly introduced mentionees.

- [ ] **Step 3: Implement repository mutations**

Use one transaction for update + mention replacement. Enforce edit cutoff in SQL/service with server/database time:
```sql
... where id = $commentId
      and author_id = $viewerId
      and deleted_at is null
      and now() < created_at + interval '15 minutes'
```
For delete:
```sql
update public.post_comments
set deleted_at = now()
where id = $1 and author_id = $2 and deleted_at is null
returning id, post_id, parent_comment_id;
```

- [ ] **Step 4: Hydrate root tombstones safely**

Change comment reads so a deleted root is returned only when it has at least one non-deleted child reply. For such rows, do not select/render body or mentions as visible content; expose `deleted: true`. Deleted replies and deleted roots without visible replies remain excluded.

- [ ] **Step 5: Implement actions/service errors**

Return a distinct safe message for expired edit window:
`Comments can only be edited for 15 minutes after posting.`
Use generic messages for permission/nonexistent targets so ownership details are not leaked.

- [ ] **Step 6: Run focused tests**

```bash
npm test -- src/features/feed/repository.test.ts src/features/feed/service.test.ts src/features/feed/actions.test.ts
npm run typecheck
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/feed/repository.ts src/features/feed/repository.test.ts src/features/feed/service.ts src/features/feed/service.test.ts src/features/feed/schemas.ts src/features/feed/actions.ts src/features/feed/actions.test.ts
git commit -m "feat: add controlled comment edit and delete"
```

---

### Task 6: Add comment/reply menus, inline editing, tombstones, and LinkedIn-style reactions

**Files:**
- Modify: `src/features/feed/components/comment-thread.tsx`
- Modify: `src/features/feed/components/comment-thread-mentions.test.tsx`
- Create: `src/features/feed/components/comment-thread-management.test.tsx`

**Interfaces:**
- Consumes Task 2 reaction loader, Task 3 modal/summary components, and Task 5 mutations.

- [ ] **Step 1: Write RED management tests**

Cover:
- own comment before 15 minutes shows `•••` menu with Edit + Delete;
- own comment after edit window shows Delete only;
- other user's comment shows no management menu;
- Edit opens inline MentionInput initialized with current body/mentions;
- successful save closes editor and refreshes;
- expired server response preserves draft and shows the cutoff error;
- root deletion with replies renders `Comment deleted` and retains replies;
- reply deletion disappears;
- tombstone has no reaction/edit/reply-to-body controls.

- [ ] **Step 2: Add owner menu and inline editor**

Use lucide `MoreHorizontal`, `Pencil`, and `Trash2`. Keep the menu compact and within the comment bubble header. Preserve mention autocomplete through the existing `MentionInput`.

- [ ] **Step 3: Replace comment `ReactionCount` with shared reaction summary behavior**

Display total count only; the user's action control is a single neutral thumbs-up or selected emoji. Clicking count/cluster opens `ReactionDetailsModal` with `targetType="comment"`.

- [ ] **Step 4: Render tombstones**

For `comment.deleted === true`, render a muted rounded shell containing only `Comment deleted`, timestamp/thread structure, and visible child replies.

- [ ] **Step 5: Run component tests**

```bash
npm test -- src/features/feed/components/comment-thread-mentions.test.tsx src/features/feed/components/comment-thread-management.test.tsx src/features/feed/components/reaction-details-modal.test.tsx
npm run typecheck
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/feed/components/comment-thread.tsx src/features/feed/components/comment-thread-mentions.test.tsx src/features/feed/components/comment-thread-management.test.tsx
git commit -m "feat: add comment management and reaction details"
```

---

### Task 7: Render notification age relatively

**Files:**
- Create: `src/lib/relative-time.ts`
- Create: `src/lib/relative-time.test.ts`
- Modify: `src/features/notifications/components/notification-list.tsx`
- Modify or create notification list test under `src/features/notifications/components/`.

**Interfaces:**
- Produces:
  ```ts
  export function relativeTimeFrom(timestamp: string, now = Date.now()): string
  ```

- [ ] **Step 1: Write RED formatter tests**

Use fixed time and assert exact output for `just now`, minutes, hours, days, and older compact dates. Avoid tests dependent on the machine clock.

```ts
expect(relativeTimeFrom('2026-09-10T09:28:30Z', Date.parse('2026-09-10T09:29:00Z'))).toBe('just now')
expect(relativeTimeFrom('2026-09-10T09:27:00Z', Date.parse('2026-09-10T09:29:00Z'))).toBe('2m')
```

- [ ] **Step 2: Implement formatter**

Use elapsed positive duration; future-skewed timestamps within a short tolerance should return `just now` rather than negative text.

- [ ] **Step 3: Write RED notification component test**

Assert visible text uses relative age and the `<time>` retains a precise timestamp through `title` and `dateTime`.

- [ ] **Step 4: Replace `notificationDate` usage**

Import `relativeTimeFrom`; keep ordering/read behavior unchanged.

- [ ] **Step 5: Run tests**

```bash
npm test -- src/lib/relative-time.test.ts src/features/notifications/components
npm run typecheck
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/relative-time.ts src/lib/relative-time.test.ts src/features/notifications/components
git commit -m "feat: show relative notification time"
```

---

### Task 8: Full regression verification and guarded staging rollout

**Files:**
- Possibly modify test files only if a real regression is discovered.
- Temporarily modify then restore: `scripts/aws/staging-deploy-action.txt`.
- Verify unchanged at `plan`: `scripts/aws/edge-recovery-action.txt`, `scripts/aws/github-deploy-iam-action.txt`.

**Interfaces:** None; this task validates and deploys the integrated feature.

- [ ] **Step 1: Run the full local/CI-equivalent application suite**

```bash
npm run lint
npm run typecheck
npm test
npm run build
```
Expected: all PASS.

- [ ] **Step 2: Push/commit only to `feat/aws-native-phase-0-1` and wait for exact-head AWS Infrastructure CI**

Require success for Application verify, Docker build, Terraform app/bootstrap validation, Terraform plan guard tests, and GitHub SSM execution contract.

- [ ] **Step 3: Confirm one-shot guards before arming**

Exact expected file contents:
```text
scripts/aws/staging-deploy-action.txt = plan
scripts/aws/edge-recovery-action.txt = plan
scripts/aws/github-deploy-iam-action.txt = plan
```

- [ ] **Step 4: Arm staging exactly once**

Change only:
```text
scripts/aws/staging-deploy-action.txt
```
from `plan` to `deploy-once`, commit on the feature branch, and **do not move the branch again** until the deployment workflow completes exact ECS verification.

- [ ] **Step 5: Verify deployment**

Require:
- AWS account `310356785722`;
- immutable image build/push success;
- task definition registration success;
- ECS desired/running/pending `1/1/0`;
- rollout state `COMPLETED`;
- exact image/task-definition verification success.

- [ ] **Step 6: Disarm only after deployment completion**

Return `scripts/aws/staging-deploy-action.txt` to `plan` and commit on the feature branch.

- [ ] **Step 7: Verify safe-head workflows**

Require AWS Remote Verify success on the disarm head and confirm exact-head CI is green. Confirm the two other guard files remain `plan`.

- [ ] **Step 8: Manual staging acceptance at `https://d3prih0q6jofyr.cloudfront.net`**

Verify:
1. unreacted posts show a neutral thumbs-up matching Share/Save style;
2. a reacted post shows only the viewer's selected reaction icon;
3. reaction summary shows total count only plus unique reaction cluster at far right;
4. clicking total/cluster opens reactor modal with All/type tabs and names;
5. comment reaction behavior matches posts;
6. own fresh comments/replies show Edit + Delete;
7. Edit disappears after 15 minutes and server still rejects stale saves;
8. Delete remains available and root tombstones preserve replies;
9. notifications show `just now` / `Xm` / `Xh` / `Xd` rather than UTC date text;
10. mentions, reply creation, save, share, polls, media, and read-only feed paths still work.

- [ ] **Step 9: Final safety report**

Report exact safe-head SHA, deployed task definition/image digest, ECS status, Remote Verify result, all guard states, and explicitly state that `main` was untouched and no merge/PR was created.
