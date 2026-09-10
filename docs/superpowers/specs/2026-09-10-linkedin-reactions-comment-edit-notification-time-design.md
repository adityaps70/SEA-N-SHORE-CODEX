# Sea N Shore LinkedIn-Style Reactions, Comment Editing, and Notification Time — Design

Date: 2026-09-10
Branch: `feat/aws-native-phase-0-1`

## Goal

Upgrade the existing Sea N Shore feed interaction experience so post and comment reactions behave much closer to LinkedIn while preserving Sea N Shore branding and the current Aurora-backed feed architecture. Also add controlled edit/delete support for comments and replies and switch notification timestamps to relative time.

This design extends existing feed, reaction, comment, mention, and notification components. It does not introduce a new social service.

## Approved Reaction Set

The same reaction vocabulary remains available on posts and comments:

- Like 👍
- Support ❤️
- Respect 🫡
- On Point ⚓

The database enum/value contract remains `like`, `support`, `respect`, and `on_point`.

## 1. Post Reaction Summary and Action Behavior

### Summary row

The reaction summary row should no longer duplicate reaction icons on both the left and the action row.

The left side shows only a total reaction count, for example:

- `1 reaction`
- `53 reactions`

No reaction emoji is shown beside this total.

The far-right side of the same summary row shows a compact cluster of the unique reaction types currently used by all users, for example:

- `👍 ❤️ ⚓`

If nobody has reacted, show a neutral outline thumbs-up icon as the empty state.

The comment count remains on the right side near this reaction cluster.

Clicking either the reaction total or the unique-reaction cluster opens the reaction-details modal.

### Action row

The first action in the post action row is the viewer's reaction control.

If the viewer has not reacted:

- show a neutral outline thumbs-up icon styled consistently with Comment, Share, and Save;
- clicking it immediately selects Like;
- hover/focus opens the four-reaction tray.

If the viewer has reacted:

- show only the selected reaction emoji (`👍`, `❤️`, `🫡`, or `⚓`);
- do not show reaction text beside the icon;
- clicking the selected reaction removes it;
- selecting a different reaction replaces the current one.

The existing fast custom tooltip remains above each emoji in the reaction tray.

## 2. Reaction Details Modal

Clicking a post or comment reaction total/cluster opens a centered Sea N Shore modal with LinkedIn-like behavior.

### Header and tabs

The modal header is `Reactions`.

Tabs:

- All
- 👍 Like
- ❤️ Support
- 🫡 Respect
- ⚓ On Point

Each visible tab includes its count, for example:

`All 53 · 👍 30 · ❤️ 20 · ⚓ 3`

Tabs with zero reactions are hidden except `All`, which is always present.

### Reactor list

Each row shows:

- profile photo, with initials fallback;
- full name;
- rank/headline and company where available;
- the exact reaction used by that person.

Clicking a reactor opens that person's Sea N Shore public profile.

The list is vertically scrollable. The read API shape must support pagination so large reaction lists can later load incrementally without redesigning the contract.

### Data source

The modal reads from the existing Aurora tables:

- `post_reactions`
- `comment_reactions`

No duplicate reaction store is introduced.

The normal feed continues to load aggregate counts only. Individual reactor identities are loaded lazily only when the modal opens.

## 3. Comment and Reply Reaction Behavior

Comments and replies use the same four-reaction vocabulary and reaction-details modal behavior as posts.

The visible comment reaction summary shows only the total count, not a duplicated string of all active reaction emoji.

A compact unique-reaction cluster can be shown beside the count and is clickable to open the reactor modal. If there are no reactions, use the neutral thumbs-up empty state where an affordance is needed.

The comment reaction action itself behaves like the post action:

- neutral outline thumbs-up when the viewer has not reacted;
- the selected reaction emoji when the viewer has reacted;
- hover/focus opens the four-reaction tray;
- no duplicated visible labels.

## 4. Comment and Reply Ownership Metadata

Each hydrated comment/reply gains enough viewer-specific metadata for edit/delete controls:

- `viewerOwns`
- `updatedAt`
- `createdAt`
- a derived edit-availability state based on server-authoritative time or an equivalent server-validated contract.

Ownership must be enforced in the service/repository layer, never only by hiding UI controls.

## 5. Edit Comment / Reply

Only the author of a comment/reply may edit it.

Edit is available only during the first 15 minutes after `created_at`.

The 15-minute deadline is enforced by the server using current server/database time. The UI may hide Edit once the local clock passes the window, but the server remains authoritative.

Editing:

- keeps the same comment ID;
- keeps the same thread position and parent relationship;
- validates body length using the existing comment rules;
- updates structured mentions in the same transaction;
- preserves reactions and replies;
- updates `updated_at`.

After an edit, render a subtle `Edited` marker beside the relative comment timestamp when `updated_at` is meaningfully later than `created_at`.

If the edit window expires while the edit UI is open, the server rejects the save with a user-facing message such as `Comments can only be edited for 15 minutes after posting.`

## 6. Delete Comment / Reply

Delete remains available at any time to the comment/reply author.

Delete uses the existing soft-delete model by setting `deleted_at` rather than hard-deleting the record.

### Standalone comment or reply

If the deleted item has no visible child replies, it disappears from the rendered thread.

### Root comment with replies

If a top-level comment has replies, retain a tombstone shell so replies are not orphaned. The shell shows a neutral message such as:

`Comment deleted`

The deleted body, mentions, reaction control, and edit/delete controls are not shown on the tombstone.

Replies remain attached below the tombstone root.

## 7. Comment Controls UI

For comments/replies owned by the viewer, show a discreet `•••` menu at the top-right of the bubble.

Menu contents:

- `Edit` only while within the 15-minute window;
- `Delete` always available.

The menu should not visually dominate normal comments.

Editing should happen inline in the comment bubble or a compact inline editor, preserving mention autocomplete and existing Sea N Shore UI patterns.

## 8. Reaction Identity Read Contract

Add a shared read/query contract for reaction details that accepts:

- target type: `post` or `comment`;
- target ID;
- optional reaction filter;
- pagination parameters/cursor.

Each result item returns:

- profile ID;
- slug;
- full name;
- avatar path/URL;
- rank/headline;
- current company;
- reaction type;
- reaction created time.

The query must respect the existing account-status/blocking visibility rules used by the feed.

## 9. Comment Mutation Actions and Repository Rules

Add dedicated server actions/service methods for:

- update comment/reply;
- soft-delete comment/reply.

Update checks:

1. target exists and is not deleted;
2. current user owns it;
3. current server time is within 15 minutes of `created_at`;
4. body and mentions are valid;
5. mentioned profiles remain allowed by the existing mention rules.

Delete checks:

1. target exists and is not already deleted;
2. current user owns it.

After successful edit/delete, revalidate the same social feed paths already used by comment creation/reactions.

## 10. Mention Handling During Comment Edit

Editing a comment/reply must preserve the structured mention model already used by new comments.

On save:

- replace the target comment's mention rows with the current selected mention set in the same transaction;
- deduplicate mention profile IDs;
- continue self-mention suppression;
- preserve block/account visibility checks.

Notification behavior for newly introduced mentions during an edit should follow the existing mention notification mechanism. Removing an old mention does not generate a notification.

## 11. Notification Relative Time

The notification list currently renders absolute UTC timestamps. Replace the visible timestamp with relative time derived from `createdAt`:

- `just now`
- `2m`
- `45m`
- `3h`
- `2d`
- older items may use a compact date when appropriate.

The precise timestamp remains available through an accessible label or browser tooltip.

No notification schema migration is required.

The displayed relative time is presentation-only; notification ordering continues to use stored `created_at`.

## 12. Performance

Normal feed hydration must not fetch every reactor identity.

Feed cards continue to load only:

- aggregate reaction counts by type;
- total reaction count;
- viewer reaction;
- enough data to render the unique-reaction cluster.

The modal fetches reactor identities only after opening.

This keeps feed page cost close to the current implementation even for popular posts.

## 13. Error Handling

Reaction modal load failure:

- keep modal shell visible;
- show a compact retry/error message;
- do not mutate reaction state.

Edit failure:

- preserve the user's draft;
- show the server message inline;
- specifically distinguish expired 15-minute edit window where possible.

Delete failure:

- leave the comment visible;
- show a compact inline error.

Optimistic reaction changes continue to roll back on mutation failure as they do now.

## 14. Testing Strategy

Implementation is test-driven.

Required behavior coverage:

### Post reaction UX

- unreacted viewer sees neutral outline thumbs-up;
- reacted viewer sees only their selected reaction icon;
- summary row shows total count only on the left;
- no duplicated active-reaction emoji string beside total count;
- unique-reaction cluster appears at far right;
- empty cluster state uses neutral thumbs-up;
- clicking total/cluster opens reaction modal.

### Reaction modal

- All tab returns every reactor;
- reaction filter returns only matching reactors;
- zero-count reaction tabs are hidden;
- rows show profile identity and exact reaction;
- profile links route correctly;
- post and comment targets both work;
- blocked/ineligible profiles are not exposed.

### Comment/reply editing

- owner can edit before 15 minutes;
- non-owner cannot edit;
- owner cannot edit at or after the 15-minute cutoff;
- comment ID/parent relationship are preserved;
- `updated_at` changes;
- edited marker renders;
- mentions are replaced/deduplicated correctly;
- newly added mentions emit the expected notification path.

### Comment/reply deletion

- owner can delete anytime;
- non-owner cannot delete;
- standalone deleted reply/comment disappears;
- deleted root with replies renders `Comment deleted` tombstone and retains replies.

### Notifications

- recent notification renders relative time;
- precise timestamp remains available accessibly;
- ordering remains unchanged.

### Regression

- existing comment creation/replying still works;
- existing mentions still work;
- existing four reaction values remain compatible;
- save/share/poll/media behavior is unchanged;
- anonymous/read-only public profile behavior remains non-mutating.

## 15. Deployment and Safety

All work remains on:

`feat/aws-native-phase-0-1`

Do not touch `main`, merge, or create a PR.

Before staging deployment:

- run exact-head AWS Infrastructure CI;
- require lint, typecheck, Vitest, Docker, Terraform validations, guard tests, and AWS/SSM contracts to pass.

Deployment:

- arm only `scripts/aws/staging-deploy-action.txt` to `deploy-once`;
- leave branch pinned until ECS exact deployment verification finishes;
- immediately return the staging action to `plan`;
- keep edge recovery and GitHub deploy IAM actions at `plan`;
- run post-deploy AWS Remote Verify on the safe disarm commit.

If a database migration becomes necessary for `updated_at` or supporting indexes, it must be additive and use the existing guarded migration pattern. Prefer no schema migration if the existing `post_comments.updated_at`/soft-delete columns already support the approved behavior.

## Acceptance Summary

The feature is accepted when:

1. A viewer sees only one primary reaction icon for their own reaction state.
2. The summary shows only total reaction count plus a far-right unique-reaction cluster.
3. Clicking reaction information opens a LinkedIn-like filtered reactor modal with user names and exact reaction types.
4. Comments/replies can be edited by their author for 15 minutes only and deleted by their author anytime.
5. Deleted root comments with replies preserve the thread via a tombstone.
6. Notifications show relative age rather than absolute UTC time.
7. Existing feed, mention, media, poll, save, share, reply, and reaction behavior remains functional.
8. All changes deploy only through the guarded feature-branch staging workflow.
