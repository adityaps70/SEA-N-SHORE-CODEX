# Sea N Shore Feed Social Interactions Design

Date: 2026-09-10
Branch: `feat/aws-native-phase-0-1`

## Goal

Upgrade the existing Sea N Shore feed so posts and comments behave more like a professional social network while retaining the current AWS-native/Aurora architecture and existing feed/notification boundaries.

The approved scope is:

- `@mentions` in posts, comments, and replies
- replies to comments
- reactions on posts and comments
- in-app notifications for comments, replies, reactions, and mentions
- show one comment by default on posts when comments exist
- show a LinkedIn-style “View more comments” affordance when multiple comments exist
- emoji picker in the post composer
- profile photo instead of initials in the post composer, with initials as fallback
- remove visible post-category selection and visible category badge/header
- keep `technical_discussion` only as an internal compatibility default
- approved reaction set for both posts and comments: **Like 👍 · Support ❤️ · Respect 🫡 · On Point ⚓**

Email notifications are explicitly out of scope for this phase.

## Existing Architecture to Preserve

The current application already separates:

- feed actions/components under `src/features/feed`
- Aurora-backed feed service/repository logic
- profile/member data under `src/features/profiles`
- in-app notifications under `src/features/notifications`
- notification event consumption through the current notification event/repository pattern

This feature should extend those existing boundaries. It should not introduce a parallel social database, a second notification engine, or client-only fake mention/reply state.

## 1. Post Composer and Post Rendering

### Composer

The composer should present a simple professional posting surface:

- profile avatar
- post body
- Photo / Video
- Poll
- Emoji
- Post

The visible category selector/category choice is removed.

The backend continues receiving `technical_discussion` as the default category for standard compatibility with existing schema, filtering, older records, and code paths that still expect a category. This value is implementation metadata only and should not be shown to the user in the normal post UI.

### Profile photo

Where the current composer shows initials, render the member's profile photo when available. If the member has no usable profile photo, keep the initials fallback.

### Emoji picker

Add a compact emoji trigger in the post composer. Selecting an emoji inserts it at the current text cursor/selection and keeps keyboard focus in the text field. The implementation should avoid a heavy external dependency unless an existing project dependency already satisfies this cleanly.

### Mentions in posts

Typing `@` followed by text should open member suggestions. Each suggestion should show, where available:

- profile photo
- full name
- rank/headline
- company or other useful professional context if already present in the member search result

Selecting a suggestion inserts a mention token/display name into the composer and retains a structured member reference for persistence.

Mentions must not be derived solely by reparsing plain text after publication. The published post must preserve the mentioned member ID so notifications/profile links remain reliable if a member later changes their display name.

Self-mentions should render normally but must not create a notification.

### Post header/category display

Remove the visible `Technical Discussion` label/badge from the top of normal posts. The post header should focus on:

- author photo
- author name
- professional identity/rank/headline
- timestamp
- ownership/menu controls where applicable

Existing posts that have categories continue to function internally.

## 2. Comment Visibility and LinkedIn-style Expansion

If a post has no comments, no existing-comment block needs to be shown above the composer.

If a post has one or more comments:

- show exactly one top-level comment by default
- keep the comment composer available without requiring an “open comments” action
- when more than one comment exists, show an affordance such as `View 4 more comments`
- expanding reveals the remaining comments inline rather than navigating to another page

The count text should be derived from the number of currently hidden top-level comments. After expansion, it may become a collapse control only if doing so remains simple; collapse behavior is not required for this phase.

The default comment should be deterministic. Prefer the most relevant existing ordering already used by the feed; if there is no relevance order today, use the latest top-level comment so the visible conversation feels current.

## 3. Comment and Reply Model

### Top-level comments

Each comment should display:

- commenter profile photo with initials fallback
- commenter name linked to public profile
- rank/headline
- timestamp
- comment body with linked mentions
- reaction summary/count
- React control
- Reply control

### Replies

Add one-level threaded replies.

A reply stores a `parent_comment_id` pointing at the top-level comment. Replies to an existing reply should also attach to the same top-level parent rather than creating arbitrary-depth nesting. This keeps the data/UI understandable and prevents deeply nested threads.

Clicking Reply should:

- reveal/focus a reply composer under the target comment
- optionally prefill `@Commenter Name` as a structured mention when useful
- preserve the same mention autocomplete behavior as the main comment composer

Replies should display indented under the parent comment with the same avatar/name/body/reaction primitives, using a slightly more compact layout.

## 4. Mentions in Comments and Replies

The same member mention search/selection behavior used in posts should be reusable in comments and replies.

Mention persistence should be normalized enough to answer:

- which entity contains the mention (post or comment/reply)
- which member was mentioned
- who created the mention
- where clicking the notification should navigate

The implementation may use dedicated mention tables or a shared social-mention table, depending on the existing repository conventions, but the persisted identity must be the member/profile ID rather than only display text.

Duplicate mentions of the same member in one post/comment should produce at most one notification for that publication action.

## 5. Reactions

Approved reaction set for both posts and comments:

- `like` → **Like 👍**
- `support` → **Support ❤️**
- `respect` → **Respect 🫡**
- `on_point` → **On Point ⚓**

### Behavior

For posts and comments:

- a member may have at most one active reaction per target
- selecting the same reaction again removes it
- selecting another reaction replaces the previous reaction atomically
- show a compact reaction summary and total count
- do not duplicate rows/events when rapidly toggling the same state

The existing post Like state must be preserved. Existing likes should map to the new `like` reaction during migration or through a compatibility path that yields the same persisted result. No existing Like should disappear merely because the reaction model expands to four choices.

## 6. In-app Notifications

Notifications use the existing Sea N Shore notification event/repository system.

Required notification types:

1. **Post comment**
   - Recipient: post author
   - Copy pattern: `Rahul commented on your post.`
   - No notification when commenter is the post author.

2. **Comment reply**
   - Recipient: parent comment author
   - Copy pattern: `Rahul replied to your comment.`
   - No self-notification.

3. **Post reaction**
   - Recipient: post author
   - Copy pattern: `Rahul reacted ⚓ to your post.`
   - No self-notification.

4. **Comment reaction**
   - Recipient: comment author
   - Copy pattern: `Rahul reacted ❤️ to your comment.`
   - No self-notification.

5. **Mention in post**
   - Recipient: mentioned member
   - Copy pattern: `Rahul mentioned you in a post.`

6. **Mention in comment/reply**
   - Recipient: mentioned member
   - Copy pattern: `Rahul mentioned you in a comment.`

### Deduplication

The system must avoid notification spam:

- one mention notification per mentioned member per published entity/action
- reaction changes by the same actor on the same target should update/deduplicate the logical notification rather than creating an unlimited sequence
- self-actions never create notifications

The notification event payload should contain stable target IDs sufficient to build the final deep link.

## 7. Notification Deep Links

Clicking a social notification should navigate to the exact relevant content.

Preferred target format:

- post: `/posts/{postId}` or the existing canonical post route
- comment/reply: canonical post route plus a stable anchor/query identifying the comment, e.g. `#comment-{commentId}`

The target comment/reply should be automatically revealed even if it would normally be hidden behind the one-comment default state. Where practical, the browser should scroll the target into view and provide a brief visual focus treatment.

Deep-link behavior must work from the main notifications surface and the existing notification chrome/dropdown where links are supported.

## 8. Data Model Changes

Exact SQL names should follow current migration naming conventions, but the model needs the following capabilities.

### Comment replies

Extend comments with nullable `parent_comment_id`, constrained so the parent belongs to the same post. Application service logic should normalize replies-to-replies onto the top-level parent.

### Post and comment reactions

Use a reaction model capable of representing the approved four values on both posts and comments. The implementation may extend the existing post-like table/schema or migrate to a generalized reaction relation according to the current repository conventions, but it must preserve existing post likes.

A reaction relation requires at least:

- target kind (`post` or `comment`) or equivalent target-specific table
- target ID
- actor/member ID
- reaction type
- created/updated timestamps

Enforce uniqueness so one actor has only one active reaction per target.

### Mentions

Persist mention records with at least:

- target kind (`post` or `comment`)
- target ID
- mentioned profile/member ID
- actor ID
- created timestamp

Enforce uniqueness sufficient to avoid duplicate mention notifications for repeated textual references to the same member inside one publication.

### Notification events

Extend existing event types/payloads for social actions rather than creating a separate queue/notification storage path.

## 9. Query and Mapping Changes

Feed queries should return enough information to render the default conversation without an extra client fetch:

- top-level comment count
- at least the comment selected for default visibility
- reply count and replies for the currently returned visible comments where practical
- post and comment reaction summary
- viewer's current post/comment reaction
- avatar/profile fields for authors
- structured mention display/link data

Expansion of additional comments can use either already-loaded post data or a dedicated paginated comment query/action. Prefer not to load unbounded comment threads into every feed card. For posts with many comments, load the initial one and request more on demand.

Public profile post rendering and Activities reuse the same shared post/comment components, so behavior should remain consistent wherever `PostCard` is used.

## 10. UI Component Boundaries

Prefer focused components rather than turning the existing comment thread into one monolith. Suggested responsibilities:

- `MentionInput` / mention-aware text control: autocomplete + structured mention selection
- `EmojiPicker`: lightweight emoji insertion
- `CommentThread`: orchestration/default visibility/more-comments control
- `CommentItem`: one comment's identity, body and actions
- `ReplyComposer`: reply-specific submission state
- `ReactionPicker`: shared four-reaction menu/control for posts and comments
- notification event mapper/consumer: social event → notification copy/link

Names may vary to match existing conventions.

## 11. Error Handling and Interaction Rules

- Failed comment/reply publication keeps the entered text and selected mentions so the user can retry.
- Failed reaction changes restore the previous UI state or refresh to server truth; do not leave an optimistic state permanently inconsistent.
- Mention search failure should not block typing/plain text submission.
- If a mentioned profile is deleted/unavailable before publication, reject only that stale mention reference or submit the text without the invalid mention according to current validation style; never create a notification to an invalid recipient.
- Notification creation must not make a successful social action appear failed if the existing architecture treats notifications asynchronously. Emit/reconcile through the existing event pattern.

## 12. Accessibility and Mobile Behavior

- Mention and reaction menus must be keyboard reachable.
- Autocomplete should expose proper listbox/option semantics where feasible.
- Profile images require useful alt text or appropriate decorative treatment beside visible names.
- Reaction choices must have text labels, not emoji-only accessible names.
- Mobile comment/reply controls should remain easy to tap and must not create horizontally overflowing nested threads.
- Emoji picker and mention suggestions should stay within viewport bounds.

## 13. Testing Strategy

Use TDD for implementation.

Required regression coverage includes:

### Composer

- profile photo shown when available; initials fallback otherwise
- no visible category control
- backend compatibility default remains `technical_discussion`
- normal post card no longer shows `Technical Discussion`
- emoji inserts at current cursor
- mention suggestion selection retains member ID

### Comments/replies

- exactly one comment visible by default when comments exist
- correct `View N more comments` count
- expansion reveals additional comments
- reply action creates one-level threaded reply
- replies-to-replies normalize to the top-level parent
- avatar fallback behavior

### Reactions

- Like/Support/Respect/On Point choices render on posts and comments
- existing post likes remain Like reactions after migration/compatibility handling
- same reaction toggles off
- alternate reaction replaces prior reaction
- uniqueness enforced by repository/service tests

### Mentions

- mentions persist structured member IDs
- duplicate same-member mention in one entity creates one logical mention event
- self-mention creates no notification

### Notifications

- comment → post owner
- reply → parent comment owner
- post reaction → post owner
- comment reaction → comment owner
- post mention → mentioned member
- comment/reply mention → mentioned member
- self-actions suppressed
- reaction notifications deduplicate/update
- links resolve to correct post/comment target

### Existing behavior

All current feed media, autoplay, post ownership, save, poll, Activities, public-profile post, notification chrome, Aurora migration, and AWS guard tests must remain green. Existing post Like behavior is intentionally subsumed by the new reaction model and must be covered by compatibility tests.

## 14. Migration and Rollout Safety

This is an additive/compatibility-preserving migration. Existing posts/comments/likes must remain readable throughout the rollout.

- nullable reply parent preserves existing comment rows
- new reaction/mention structures must not require rewriting historical comments
- existing post likes remain represented as `like`
- visible category removal is a UI change; internal category compatibility remains intact
- deployment follows the existing guarded AWS staging process
- staging action uses only `plan` and one-shot `deploy-once`
- all one-shot controls return to `plan` immediately after deployment
- do not touch `main`, merge, or create a PR

## 15. Explicit Non-goals

Not included in this phase:

- email notifications
- push/mobile OS notifications
- arbitrary-depth comment nesting
- GIF/sticker support
- hashtags/trending topics overhaul
- moderation/reporting redesign
- separate microservice for social interactions
- notification preference center

## Acceptance Criteria

The feature is complete when a Sea N Shore member can publish a clean category-free-looking post with avatar, emoji and structured mentions; viewers can see one existing comment immediately, reveal more, reply, mention members and react on both posts and comments with **Like 👍, Support ❤️, Respect 🫡, On Point ⚓**; and recipients receive deduplicated in-app notifications for comments, replies, reactions and mentions that open the relevant post/comment. Existing likes, feed functionality and AWS deployment safety contracts must continue to pass.