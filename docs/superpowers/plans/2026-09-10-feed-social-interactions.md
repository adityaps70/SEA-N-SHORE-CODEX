# Feed Social Interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Sea N Shore posts and comments with structured mentions, one-level replies, four reactions on posts and comments, in-app social notifications, LinkedIn-style comment previews, emoji insertion, profile avatars, and category-free-looking post UI.

**Architecture:** Extend the current Aurora feed repository/service and existing event-outbox/notification pipeline. One guarded additive Aurora migration adds reply links, comment reactions, structured mentions, the three new reaction enum values, and notification target/dedupe fields while preserving every existing `like`. Feed mutations persist their primary state, direct in-app notification, and shadow-parity outbox event in the same Aurora transaction; the existing notification worker remains in `shadow` mode during this feature.

**Tech Stack:** Next.js 16.3.4, React 19.2.8, TypeScript 5, PostgreSQL/Aurora, `pg`, Zod 4, Vitest 4, Testing Library, Lucide React, AWS EventBridge/SQS/ECS, GitHub Actions + SSM guarded migrations.

**Spec:** `docs/superpowers/specs/2026-09-10-feed-social-interactions-design.md`

## Global Constraints

- Work only on `feat/aws-native-phase-0-1`; do not touch `main`, merge, or create a PR.
- Post and comment reactions are exactly `like`, `support`, `respect`, `on_point`, displayed as **Like 👍 · Support ❤️ · Respect 🫡 · On Point ⚓**.
- Existing `public.post_reactions.reaction_type = 'like'` rows remain valid without data rewriting.
- Replies are one level deep. Replying to a reply resolves to that reply's root `parent_comment_id`.
- Mentions persist profile IDs and are not reconstructed solely from post/comment text.
- Notifications are in-app only. No email or OS push notifications are added.
- One latest top-level comment is visible by default when a post has comments; remaining top-level comments load inline in pages of 10 through `View N more comments`.
- Normal post UI never displays a category badge. Existing category filtering remains compatible and composer submissions still carry an internal category, defaulting to `technical_discussion`.
- Public/read-only post cards show the initial comment and reaction summary but no reaction/reply/comment mutation controls.
- Use TDD for every production slice: write failing test, run and confirm RED, implement minimum behavior, rerun GREEN, commit.
- Existing AWS guards remain untouched except deliberate one-shot operations. `staging-deploy-action.txt`, `github-deploy-iam-action.txt`, `edge-recovery-action.txt`, and the new feed-social migration action must finish as exactly `plan\n`.

---

### Task 1: Establish the RED integration contract

**Files:**
- Create: `src/feed-social-interactions-contract.test.tsx`
- Modify: `src/features/feed/components/post-card.test.tsx`
- Modify: `src/features/feed/components/post-composer.test.tsx`
- Create: `src/features/feed/components/comment-thread.test.tsx`

**Interfaces:**
- Consumes current `PostCard`, `PostComposer`, `CommentThread`.
- Produces failing UI contracts for the approved behavior before production changes.

- [ ] **Step 1: Add RED assertions** requiring no category badge, an Emoji action, all four reaction names, avatar rendering, one default comment, `View 2 more comments`, and Reply.

```tsx
expect(screen.queryByText('Technical Discussion')).not.toBeInTheDocument()
expect(screen.getByRole('button', { name: /emoji/i })).toBeInTheDocument()
for (const label of ['Like', 'Support', 'Respect', 'On Point']) {
  expect(screen.getByText(label)).toBeInTheDocument()
}
expect(screen.getAllByTestId('visible-top-level-comment')).toHaveLength(1)
expect(screen.getByRole('button', { name: /view 2 more comments/i })).toBeInTheDocument()
expect(screen.getByRole('button', { name: /reply/i })).toBeInTheDocument()
```

- [ ] **Step 2: Run the focused suite and confirm RED.**

```bash
npm test -- src/feed-social-interactions-contract.test.tsx src/features/feed/components/post-card.test.tsx src/features/feed/components/post-composer.test.tsx src/features/feed/components/comment-thread.test.tsx
```

Expected: failure because the existing card has a category badge/boolean Like and comments are hidden until opened.

- [ ] **Step 3: Commit only RED tests.**

```bash
git add src/feed-social-interactions-contract.test.tsx src/features/feed/components/post-card.test.tsx src/features/feed/components/post-composer.test.tsx src/features/feed/components/comment-thread.test.tsx
git commit -m "test: require feed social interactions"
```

- [ ] **Step 4:** Confirm exact-head AWS Infrastructure CI fails only for the new expected application contract before production implementation.

---

### Task 2: Add `0009` Aurora schema and guarded migration

**Files:**
- Create: `infra/aws/database/migrations/0009_feed_social_interactions.sql`
- Create: `scripts/aws/feed-social-interactions-schema.test.mjs`
- Create: `scripts/aws/feed-social-interactions-migration.sh`
- Create: `scripts/aws/feed-social-interactions-migration-action.txt`
- Create: `.github/workflows/aws-feed-social-interactions-migration.yml`
- Modify: `.github/workflows/aws-infra-ci.yml`

**Interfaces:**
- Produces DB structures used by Tasks 4-13.
- New migration guard accepts only `plan|apply-once`.

- [ ] **Step 1: Write the schema contract first.** It must assert these exact capabilities:

```js
expect(sql).toContain("alter type public.post_reaction_type add value if not exists 'support'")
expect(sql).toContain("alter type public.post_reaction_type add value if not exists 'respect'")
expect(sql).toContain("alter type public.post_reaction_type add value if not exists 'on_point'")
expect(sql).toContain('add column if not exists parent_comment_id uuid')
expect(sql).toContain('create table if not exists public.comment_reactions')
expect(sql).toContain('create table if not exists public.content_mentions')
expect(sql).toContain('add column if not exists dedupe_key text')
```

The guard permits only the explicitly approved additive statement families: `ALTER TYPE ... ADD VALUE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN/ADD CONSTRAINT`, `CREATE TABLE IF NOT EXISTS`, and `CREATE [UNIQUE] INDEX IF NOT EXISTS`. It rejects `DROP`, `TRUNCATE`, `DELETE`, `UPDATE`, column/type replacement, and unrestricted ALTER statements.

- [ ] **Step 2: Run schema test and confirm RED.**

```bash
npm test -- scripts/aws/feed-social-interactions-schema.test.mjs
```

Expected: failure because migration `0009` is absent.

- [ ] **Step 3: Implement exact schema.**

```sql
alter type public.post_reaction_type add value if not exists 'support';
alter type public.post_reaction_type add value if not exists 'respect';
alter type public.post_reaction_type add value if not exists 'on_point';

alter table public.post_comments add column if not exists parent_comment_id uuid;
alter table public.post_comments add constraint post_comments_id_post_unique unique (id, post_id);
alter table public.post_comments add constraint post_comments_parent_same_post_fk
  foreign key (parent_comment_id, post_id)
  references public.post_comments(id, post_id) on delete cascade;

create table if not exists public.comment_reactions (
  comment_id uuid not null references public.post_comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction_type public.post_reaction_type not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create table if not exists public.content_mentions (
  id uuid primary key,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  mentioned_profile_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  comment_id uuid references public.post_comments(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint content_mentions_exact_target check ((post_id is not null) <> (comment_id is not null))
);
```

Also add partial unique indexes `(post_id, mentioned_profile_id)` where post is non-null and `(comment_id, mentioned_profile_id)` where comment is non-null.

Extend `public.network_notification_type` with exact values `post_comment`, `comment_reply`, `post_reaction`, `comment_reaction`, `post_mention`, `comment_mention`. Add nullable `post_id`, `comment_id`, `reaction_type`, `dedupe_key` to `public.notifications`, FKs to post/comment, and a partial unique index on `(recipient_id, dedupe_key)` where `dedupe_key is not null`.

- [ ] **Step 4: Implement guarded runner/workflow** by copying the exact account/SHA/SSM discipline of `jobs-activities-migration.sh` and `.github/workflows/aws-jobs-activities-migration.yml`, changing names and live-shape assertions to `0009` only. Keep action file content `plan\n`.

- [ ] **Step 5: Add CI contract step.**

```yaml
- name: Verify feed social interaction schema contract
  run: node --test scripts/aws/feed-social-interactions-schema.test.mjs
```

- [ ] **Step 6: Run GREEN.**

```bash
node --test scripts/aws/feed-social-interactions-schema.test.mjs
```

- [ ] **Step 7: Commit.**

```bash
git add infra/aws/database/migrations/0009_feed_social_interactions.sql scripts/aws/feed-social-interactions-* .github/workflows/aws-feed-social-interactions-migration.yml .github/workflows/aws-infra-ci.yml
git commit -m "feat: add feed social interaction schema"
```

---

### Task 3: Extend domain-event and EventBridge contracts

**Files:**
- Modify: `src/features/events/types.ts`
- Modify: `src/features/events/validation.ts`
- Modify: `src/features/events/validation.test.ts`
- Modify: `scripts/aws/social-events-terraform.test.mjs`
- Modify: `infra/aws/app/social-events.tf`

**Interfaces:**
- Produces event types `post.commented`, `comment.replied`, `post.reacted`, `comment.reacted`, `post.mentioned`, `comment.mentioned`.
- Adds aggregate types `post|comment` while retaining `profile|connection`.

- [ ] **Step 1: Add RED event tests.** A post reaction fixture is shaped exactly like:

```ts
const event: DomainEvent = {
  id: EVENT_ID,
  aggregateType: 'post',
  aggregateId: POST_ID,
  eventType: 'post.reacted',
  schemaVersion: 1,
  occurredAt: '2026-09-10T08:00:00.000Z',
  payload: {
    eventType: 'post.reacted',
    actorId: ACTOR_ID,
    targetId: AUTHOR_ID,
    postId: POST_ID,
    reactionType: 'on_point',
  },
}
expect(parseDomainEvent(event)).toEqual(event)
```

Add analogous fixtures for the other five types and reject any reaction outside the four-value enum.

- [ ] **Step 2: Run RED.**

```bash
npm test -- src/features/events/validation.test.ts scripts/aws/social-events-terraform.test.mjs
```

- [ ] **Step 3: Extend TypeScript/Zod event unions and the EventBridge rule.**

```hcl
detail-type = [
  "user.followed", "connection.requested", "connection.accepted",
  "post.commented", "comment.replied", "post.reacted",
  "comment.reacted", "post.mentioned", "comment.mentioned"
]
```

- [ ] **Step 4: Run GREEN and Terraform validation.**

```bash
npm test -- src/features/events/validation.test.ts scripts/aws/social-events-terraform.test.mjs
terraform -chdir=infra/aws/app init -backend=false
terraform -chdir=infra/aws/app validate
```

- [ ] **Step 5: Commit.**

```bash
git add src/features/events infra/aws/app/social-events.tf scripts/aws/social-events-terraform.test.mjs
git commit -m "feat: define feed social events"
```

---

### Task 4: Add feed repository data primitives

**Files:**
- Modify: `src/features/feed/types.ts`
- Modify: `src/features/feed/mappers.ts`
- Modify: `src/features/feed/mappers.test.ts`
- Modify: `src/features/feed/repository.ts`
- Modify: `src/features/feed/repository.test.ts`

**Interfaces:**

```ts
export const POST_REACTIONS = ['like', 'support', 'respect', 'on_point'] as const
export type PostReactionType = (typeof POST_REACTIONS)[number]
export type ReactionSummary = Record<PostReactionType, number>

export type FeedViewerState = {
  postReactions: Map<string, PostReactionType>
  savedPostIds: Set<string>
  pollVotes: Map<string, string>
}

setPostReaction(actorId: string, postId: string, reaction: PostReactionType | null): Promise<void>
setCommentReaction(actorId: string, commentId: string, reaction: PostReactionType | null): Promise<void>
addComment(actorId: string, postId: string, body: string, parentCommentId: string | null): Promise<string>
getCommentForInteraction(viewerId: string, commentId: string): Promise<{ id: string; postId: string; authorId: string; parentCommentId: string | null } | null>
insertPostMentions(actorId: string, postId: string, mentionedProfileIds: string[]): Promise<string[]>
insertCommentMentions(actorId: string, commentId: string, mentionedProfileIds: string[]): Promise<string[]>
```

`set*Reaction` uses `INSERT ... ON CONFLICT (...) DO UPDATE SET reaction_type = excluded.reaction_type, updated_at = now()` and deletes when reaction is null.

- [ ] **Step 1: Add RED repository/mapper tests** for four reaction counts, viewer reaction value, replacement upsert, deletion on null, returned comment ID, parent metadata and mention uniqueness.
- [ ] **Step 2: Run RED.**

```bash
npm test -- src/features/feed/repository.test.ts src/features/feed/mappers.test.ts
```

- [ ] **Step 3: Implement SQL and mappings.** Feed post reaction aggregate returns counts grouped by `reaction_type`. Comment rows return `parent_comment_id`, grouped reaction counts, viewer reaction, avatar identity and mention records.
- [ ] **Step 4: Run GREEN.**

```bash
npm test -- src/features/feed/repository.test.ts src/features/feed/mappers.test.ts
```

- [ ] **Step 5: Commit.**

```bash
git add src/features/feed/types.ts src/features/feed/mappers.ts src/features/feed/mappers.test.ts src/features/feed/repository.ts src/features/feed/repository.test.ts
git commit -m "feat: add reaction reply and mention persistence"
```

---

### Task 5: Make social feed mutations transactional with direct notifications + outbox parity

**Files:**
- Modify: `src/features/feed/service.ts`
- Modify: `src/features/feed/service.test.ts`
- Modify: `src/features/notifications/repository.ts`
- Modify: `src/features/notifications/repository.test.ts`

**Interfaces:**

```ts
export type SocialNotificationInput = {
  recipientId: string
  actorId: string
  type: 'post_comment' | 'comment_reply' | 'post_reaction' | 'comment_reaction' | 'post_mention' | 'comment_mention'
  postId: string
  commentId?: string
  reactionType?: PostReactionType
  dedupeKey: string
}

upsertSocialNotification(input: SocialNotificationInput): Promise<string>
deleteSocialNotification(recipientId: string, dedupeKey: string): Promise<void>
```

Feed production transaction becomes:

```ts
type FeedTransactionContext = {
  feed: FeedRepository
  outbox: OutboxRepository
  notifications: Pick<NotificationEventRepository, 'upsertSocialNotification' | 'deleteSocialNotification'>
}
```

The production adapter creates all three repositories from the same `DatabaseQueryClient`.

- [ ] **Step 1: RED tests** prove: comment notifies post author; reply notifies root comment author; reaction notifies target owner; self-actions do not notify; reaction change uses same dedupe key; reaction removal deletes logical notification; duplicate mention recipient creates one notification/event.
- [ ] **Step 2: Run RED.**

```bash
npm test -- src/features/feed/service.test.ts src/features/notifications/repository.test.ts
```

- [ ] **Step 3: Implement direct notification upsert.**

```sql
insert into public.notifications (
  recipient_id, actor_id, notification_type, post_id, comment_id,
  reaction_type, dedupe_key, created_at, read_at
) values ($1,$2,$3,$4,$5,$6,$7,now(),null)
on conflict (recipient_id, dedupe_key) where dedupe_key is not null
do update set
  actor_id = excluded.actor_id,
  notification_type = excluded.notification_type,
  post_id = excluded.post_id,
  comment_id = excluded.comment_id,
  reaction_type = excluded.reaction_type,
  created_at = now(),
  read_at = null
returning id;
```

Use deterministic keys such as `post-reaction:{postId}:{actorId}`, `comment-reaction:{commentId}:{actorId}`, `post-mention:{postId}:{recipientId}`, and `comment-mention:{commentId}:{recipientId}`.

- [ ] **Step 4: Emit matching outbox events in the same transaction.** Notification worker remains `SOCIAL_NOTIFICATION_MODE=shadow`.
- [ ] **Step 5: Run GREEN and commit.**

```bash
npm test -- src/features/feed/service.test.ts src/features/notifications/repository.test.ts
git add src/features/feed/service.ts src/features/feed/service.test.ts src/features/notifications/repository.ts src/features/notifications/repository.test.ts
git commit -m "feat: emit feed social notifications transactionally"
```

---

### Task 6: Add safe mention candidate lookup

**Files:**
- Modify: `src/features/profiles/repository.ts`
- Modify: `src/features/profiles/repository-search.test.ts`
- Modify: `src/features/profiles/aws-queries.ts`
- Modify: `src/features/feed/actions.ts`
- Modify: `src/features/feed/actions.test.ts`

**Interface:**

```ts
export type MentionCandidate = {
  id: string
  slug: string
  fullName: string
  avatarUrl: string | null
  headline: string | null
  rank: string | null
  currentCompany: string | null
}

export async function searchMentionCandidates(query: string): Promise<MentionCandidate[]>
```

- [ ] **Step 1: RED tests** require active/onboarded members only, bilateral block exclusion, current user excluded from suggestions, normalized search tokens, and maximum 8 rows.
- [ ] **Step 2: Run RED.**

```bash
npm test -- src/features/profiles/repository-search.test.ts src/features/feed/actions.test.ts
```

- [ ] **Step 3: Implement** using existing `getDiscoveryCandidates({viewerProfileId, searchQuery, limit: 8})`, hydrate avatar URLs, and map only the fields above.
- [ ] **Step 4: GREEN and commit.**

```bash
npm test -- src/features/profiles/repository-search.test.ts src/features/feed/actions.test.ts
git add src/features/profiles/repository.ts src/features/profiles/repository-search.test.ts src/features/profiles/aws-queries.ts src/features/feed/actions.ts src/features/feed/actions.test.ts
git commit -m "feat: add member mention lookup"
```

---

### Task 7: Upgrade feed schemas/actions to structured mentions and four reactions

**Files:**
- Modify: `src/features/feed/schemas.ts`
- Modify: `src/features/feed/schemas.test.ts`
- Modify: `src/features/feed/actions.ts`
- Modify: `src/features/feed/actions.test.ts`

**Interfaces:**

```ts
const reactionSchema = z.enum(['like', 'support', 'respect', 'on_point'])
const mentionIdsSchema = z.array(z.string().uuid()).max(20).transform(ids => [...new Set(ids)])

setPostReaction(postId: string, reaction: PostReactionType | null): Promise<FeedActionResult>
setCommentReaction(commentId: string, reaction: PostReactionType | null): Promise<FeedActionResult>
loadPostComments(postId: string, offset: number): Promise<{ ok: true; comments: FeedComment[]; remaining: number } | { ok: false; error: string }>
```

`createPost` and `addComment` read repeated `mentionProfileId` fields. `addComment` also reads optional `parentCommentId`.

- [ ] **Step 1: RED tests** for reaction validation, max/deduped mentions, parent UUID validation, internal category default and action revalidation.
- [ ] **Step 2: Run RED.**

```bash
npm test -- src/features/feed/schemas.test.ts src/features/feed/actions.test.ts
```

- [ ] **Step 3: Implement.** If `category` is absent from FormData, `postInputFromFormData` supplies `technical_discussion`; existing callers that pass hidden `defaultCategory` retain that metadata.
- [ ] **Step 4: GREEN and commit.**

```bash
npm test -- src/features/feed/schemas.test.ts src/features/feed/actions.test.ts
git add src/features/feed/schemas.ts src/features/feed/schemas.test.ts src/features/feed/actions.ts src/features/feed/actions.test.ts
git commit -m "feat: expose social feed actions"
```

---

### Task 8: Build reusable mention, emoji and reaction controls

**Files:**
- Create: `src/features/feed/components/mention-input.tsx`
- Create: `src/features/feed/components/mention-input.test.tsx`
- Create: `src/features/feed/components/emoji-picker.tsx`
- Create: `src/features/feed/components/emoji-picker.test.tsx`
- Create: `src/features/feed/components/reaction-picker.tsx`
- Create: `src/features/feed/components/reaction-picker.test.tsx`

**MentionInput interface:**

```ts
type SelectedMention = { profileId: string; label: string }
type MentionInputProps = {
  id: string
  name: string
  value: string
  onChange(value: string): void
  mentions: SelectedMention[]
  onMentionsChange(mentions: SelectedMention[]): void
  placeholder: string
}
```

Selecting a candidate inserts `@Full Name` at the active `@query` and adds `{profileId,label}`. When subsequent editing removes that exact inserted `@Full Name`, remove its selected mention reference. Forms serialize each selected ID as `<input type="hidden" name="mentionProfileId" ...>`.

**EmojiPicker interface:**

```ts
type EmojiPickerProps = { onSelect(emoji: string): void }
```

Use a small curated list such as `['😀','😊','👏','🙏','👍','❤️','⚓','🌊','🚢','🎉','💡','✅']`; insert at textarea `selectionStart/selectionEnd` and restore focus.

**ReactionPicker interface:**

```ts
type ReactionPickerProps = {
  value: PostReactionType | null
  disabled?: boolean
  onChange(value: PostReactionType | null): void
}
```

Main action toggles current reaction (or Like when empty); adjacent `Choose reaction` control opens the four-item accessible menu. Selecting a different reaction replaces current state.

- [ ] **Step 1: Write RED keyboard/cursor tests.**
- [ ] **Step 2: Run RED.**

```bash
npm test -- src/features/feed/components/mention-input.test.tsx src/features/feed/components/emoji-picker.test.tsx src/features/feed/components/reaction-picker.test.tsx
```

- [ ] **Step 3: Implement components with listbox/menu semantics.**
- [ ] **Step 4: GREEN and commit.**

```bash
npm test -- src/features/feed/components/mention-input.test.tsx src/features/feed/components/emoji-picker.test.tsx src/features/feed/components/reaction-picker.test.tsx
git add src/features/feed/components/mention-input* src/features/feed/components/emoji-picker* src/features/feed/components/reaction-picker*
git commit -m "feat: add social composer controls"
```

---

### Task 9: Simplify PostComposer and upgrade PostCard reactions

**Files:**
- Modify: `src/features/feed/components/post-composer.tsx`
- Modify: `src/features/feed/components/post-composer.test.tsx`
- Modify: `src/features/feed/components/post-card.tsx`
- Modify: `src/features/feed/components/post-card.test.tsx`

- [ ] **Step 1: Extend RED tests** requiring `profile.avatarUrl` image with initials fallback, MentionInput/Emoji, no visible category, no post category badge, four reactions and reaction summary.
- [ ] **Step 2: Run RED.**

```bash
npm test -- src/features/feed/components/post-composer.test.tsx src/features/feed/components/post-card.test.tsx
```

- [ ] **Step 3: Implement composer.** Preserve direct S3 media upload and polls. Keep category as hidden metadata only; never render category controls.
- [ ] **Step 4: Implement PostCard.** Replace `viewerLiked/likeCount` UI state with `viewerReaction/reactionSummary/reactionCount`, invoke `setPostReaction`, remove `POST_CATEGORY_LABELS` display, keep Comment/Share/Save/delete behavior.
- [ ] **Step 5: GREEN and commit.**

```bash
npm test -- src/features/feed/components/post-composer.test.tsx src/features/feed/components/post-card.test.tsx
git add src/features/feed/components/post-composer.tsx src/features/feed/components/post-composer.test.tsx src/features/feed/components/post-card.tsx src/features/feed/components/post-card.test.tsx
git commit -m "feat: add reactions and mentions to posts"
```

---

### Task 10: Implement bounded comment previews, replies, mentions and reactions

**Files:**
- Modify: `src/features/feed/queries.ts`
- Modify: `src/features/feed/queries.test.ts`
- Modify: `src/features/feed/components/comment-thread.tsx`
- Modify: `src/features/feed/components/comment-thread.test.tsx`
- Create: `src/features/feed/components/comment-item.tsx`
- Create: `src/features/feed/components/reply-composer.tsx`

**Query contract:** Feed hydration gets only the latest top-level preview per post. `loadPostComments(postId, offset)` loads 10 additional top-level comments plus their one-level replies and returns remaining count.

**UI contract:**
- One latest top-level comment has `data-testid="visible-top-level-comment"` and is rendered immediately whenever comment count is positive.
- `View N more comments` loads/reveals next 10.
- Comment/reply shows avatar, linked name, rank/headline, timestamp, mention-linked body, reaction summary, ReactionPicker and Reply when writable.
- Replying to a reply submits its root parent ID.
- Read-only cards render preview/replies/reaction counts but no mutation controls/composer.

- [ ] **Step 1: RED query/UI tests** for initial-one, pagination, replies-to-root normalization, reaction changes, mention submission and read-only rendering.
- [ ] **Step 2: Run RED.**

```bash
npm test -- src/features/feed/queries.test.ts src/features/feed/components/comment-thread.test.tsx
```

- [ ] **Step 3: Implement bounded repository query/hydration and components.**
- [ ] **Step 4: GREEN and commit.**

```bash
npm test -- src/features/feed/queries.test.ts src/features/feed/components/comment-thread.test.tsx
git add src/features/feed/queries.ts src/features/feed/queries.test.ts src/features/feed/components/comment-thread.tsx src/features/feed/components/comment-thread.test.tsx src/features/feed/components/comment-item.tsx src/features/feed/components/reply-composer.tsx
git commit -m "feat: add linkedin style comment threads"
```

---

### Task 11: Add exact social notification mapping, dedupe and deep links

**Files:**
- Modify: `src/features/notifications/types.ts`
- Modify: `src/features/notifications/repository.ts`
- Modify: `src/features/notifications/event-repository.test.ts`
- Modify: `src/features/notifications/event-consumer.ts`
- Modify: `src/features/notifications/event-consumer.test.ts`
- Modify: `src/features/notifications/queries.ts`
- Modify: `src/features/notifications/queries.test.ts`
- Modify: `src/features/notifications/components/notification-bell.tsx`
- Modify: `src/features/notifications/components/notification-bell.test.tsx`
- Modify: `src/features/notifications/components/notification-list.tsx`

**Copy/destination mapping:**

```ts
post_comment:    `${actor} commented on your post.`
comment_reply:   `${actor} replied to your comment.`
post_reaction:   `${actor} reacted ${reactionEmoji} to your post.`
comment_reaction:`${actor} reacted ${reactionEmoji} to your comment.`
post_mention:    `${actor} mentioned you in a post.`
comment_mention: `${actor} mentioned you in a comment.`
```

Post notifications navigate to `/posts/${postId}`. Comment/reply/comment-mention/comment-reaction navigate to `/posts/${postId}#comment-${commentId}`.

- [ ] **Step 1: RED tests** for all six mapping cases, reaction emoji mapping, old network types unchanged, event receipt idempotency, and dedupe metadata preserved by the shadow consumer.
- [ ] **Step 2: Run RED.**

```bash
npm test -- src/features/notifications
```

- [ ] **Step 3: Extend notification rows/types/consumer/query mapping.** Do not change worker mode from `shadow`.
- [ ] **Step 4: Update notification empty-state copy** to mention comments, reactions, mentions and professional-network activity.
- [ ] **Step 5: GREEN and commit.**

```bash
npm test -- src/features/notifications
git add src/features/notifications
git commit -m "feat: add feed social in app notifications"
```

---

### Task 12: Reveal deep-linked comments

**Files:**
- Modify: `src/features/feed/components/comment-thread.tsx`
- Modify: `src/features/feed/components/comment-thread.test.tsx`
- Test: `src/features/feed/components/post-card.test.tsx`

- [ ] **Step 1: RED test** sets `window.location.hash = '#comment-${TARGET_ID}'`, renders a thread whose target is not the initial preview, and expects the loader to reveal it and `scrollIntoView` to run.
- [ ] **Step 2: Run RED.**

```bash
npm test -- src/features/feed/components/comment-thread.test.tsx
```

- [ ] **Step 3: Implement on mount:** validate hash with UUID pattern, repeatedly fetch bounded comment pages until target is found or no pages remain, render it, call `scrollIntoView({block:'center'})`, and apply a temporary focus-ring class.
- [ ] **Step 4: GREEN and commit.**

```bash
npm test -- src/features/feed/components/comment-thread.test.tsx src/features/feed/components/post-card.test.tsx
git add src/features/feed/components/comment-thread.tsx src/features/feed/components/comment-thread.test.tsx src/features/feed/components/post-card.test.tsx
git commit -m "feat: reveal notified comments by deep link"
```

---

### Task 13: Full regression and exact-head verification

- [ ] **Step 1: Run focused domain suites.**

```bash
npm test -- src/features/feed src/features/events src/features/notifications src/features/profiles/repository-search.test.ts
```

- [ ] **Step 2: Run complete local-equivalent gate.**

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

- [ ] **Step 3:** Confirm existing autoplay, direct S3 upload, polls, save, delete/ownership, Activities, public-profile posts, active navigation and network notifications remain green.
- [ ] **Step 4:** Push/commit any intentional compatibility fixture changes separately, then wait for exact-head AWS Infrastructure CI. Do not arm any migration or deploy control until that head is fully green.

---

### Task 14: Apply the guarded `0009` migration

- [ ] **Step 1:** Fetch all one-shot files and verify `plan\n`, including `scripts/aws/feed-social-interactions-migration-action.txt`.
- [ ] **Step 2:** Set only feed-social migration action to `apply-once`; commit on `feat/aws-native-phase-0-1`.
- [ ] **Step 3:** Wait for exact-head Infrastructure CI and `.github/workflows/aws-feed-social-interactions-migration.yml`.
- [ ] **Step 4:** Verify live Aurora has enum values `like/support/respect/on_point`, same-post reply FK, comment reaction table, mention table, notification target columns/types and dedupe index.
- [ ] **Step 5:** Immediately set feed-social migration action back to `plan`; commit.
- [ ] **Step 6:** Verify final migration-safe head and re-fetch its action file as exactly `plan\n`.

No unguarded SQL and no use of staging/IAM/edge one-shots for this step.

---

### Task 15: Deploy and verify staging

- [ ] **Step 1:** Confirm the new migration action and the three existing one-shot controls are all `plan\n`.
- [ ] **Step 2:** Confirm exact-head AWS Infrastructure CI is green.
- [ ] **Step 3:** Change only `scripts/aws/staging-deploy-action.txt` to `deploy-once`; commit.
- [ ] **Step 4:** Wait for exact-head gate, immutable ECR push, Terraform reconciliation (including EventBridge detail types), ECS service stability and exact task-definition/image verification.
- [ ] **Step 5:** Verify staging `https://d3prih0q6jofyr.cloudfront.net`: four post reactions; four comment reactions; avatar composer; emoji; post mention; comment mention; one visible comment; View More; reply; notification badge/list; notification deep link.
- [ ] **Step 6:** Review current-deployment CloudWatch strong errors. Treat known stale Server Action requests as stale only when logs identify the older/newer deployment mismatch; investigate any new repeating application signature.
- [ ] **Step 7:** Immediately return `scripts/aws/staging-deploy-action.txt` to `plan`; commit.
- [ ] **Step 8:** Verify final safe head: application CI green, Remote Verify acceptable, plan-mode staging workflow skips redeployment, ECS has one completed deployment with `desired/running/pending = 1/1/0`.
- [ ] **Step 9:** Re-fetch every one-shot action and confirm exactly `plan\n`. Do not touch `main`, merge, or create a PR.

## Definition of Done

A member can publish a clean post with their profile photo, emoji and structured mentions; both posts and comments expose **Like 👍 · Support ❤️ · Respect 🫡 · On Point ⚓**; one existing top-level comment is always visible with LinkedIn-style progressive expansion; replies are one level deep; comments/replies support mentions and reactions; and in-app notifications for comments, replies, reactions and mentions dedupe correctly and deep-link to the relevant post/comment. Existing feed/network behavior remains green, migration `0009` is verified on Aurora, staging is healthy on an exact immutable image, and every one-shot action is back to `plan`.