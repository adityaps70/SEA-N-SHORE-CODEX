# Sea N Shore Home Feed Design

Date: 2026-09-02
Status: Approved direction; implementation pending final spec review

## 1. Goal

Replace the current `/home` welcome screen with the primary daily Sea N Shore experience: a professional maritime social feed inspired by familiar LinkedIn information hierarchy, while preserving the existing Sea N Shore visual system across the website.

The Google AI Studio prototype and supplied screenshots are reference material for information density, feed hierarchy, profile-card usefulness, and maritime interaction ideas only. The production implementation must not copy their styling or code.

## 2. Product principles

1. Sea N Shore is a maritime professional network first, not a jobs portal.
2. The home page should be useful every day even when a member is not job hunting.
3. Use the existing navy/ocean/mist design language, typography, card treatment, spacing, button shapes, navigation, and responsive conventions.
4. Use real user/profile/post data only. Do not fabricate verification badges, reputation scores, follower counts, reactions, comments, shares, or professional credentials.
5. Verification UI must remain absent unless a formal review-backed verification state exists in the database.
6. The first social release should be complete enough to use, but avoid prematurely building groups, messaging, AI, recommendation ML, or complex reputation systems.

## 3. Desktop layout

`/home` becomes a responsive three-column application surface inside the existing authenticated app shell.

### Left rail: signed-in professional profile

A sticky profile summary card using the member's existing Supabase profile data.

Contents:
- branded cover strip using the existing Sea N Shore palette
- avatar, with initials fallback if no uploaded avatar exists
- full name
- rank when available
- professional headline
- current company when available
- sailing experience when available
- availability when available
- shore-career preference when applicable
- profile-completion indicator based only on real profile fields
- `View profile` action
- optional quick links to saved posts and network later, only when those destinations exist

The left rail must not show invented `Verified CoC`, reputation points, connection counts, or other unsupported data.

### Center column: primary feed

The center column is the visual and functional priority.

Order:
1. post composer
2. category filter row
3. chronological/community feed
4. pagination or `Load more` initially; infinite loading may follow once basic reliability is proven

### Right rail: discovery

Initial useful modules:
- maritime topics/categories
- upcoming events from real event records once the event backend exists
- relevant jobs from real job records once job posting is functional
- professionals to discover once connection/follow support exists

For the first feed milestone, sections without real backing data should either be omitted or presented as navigation cards without fake listings.

## 4. Mobile and tablet behavior

### Mobile

- single-column feed
- existing bottom navigation remains unchanged
- composer appears first
- category filters scroll horizontally
- left profile rail becomes a compact profile summary above the feed or is omitted in favor of the existing Profile destination when vertical space is constrained
- right rail content moves below the feed or is omitted from the first viewport
- post actions remain touch-friendly with minimum interactive target sizes

### Tablet

- center feed remains primary
- profile rail may remain visible when width permits
- right discovery rail collapses before the profile rail

## 5. Feed composer

The composer should feel native to Sea N Shore and use the existing component styling.

Initial controls:
- text post
- category selection
- image upload / diagram upload
- technical poll

Suggested prompt copy: `Share a maritime update, technical lesson, or industry insight...`

Do not display `Ask Co-Pilot` until a real AI assistant workflow exists.

### Post categories

Canonical categories for this release:
- Maritime News
- Technical Discussion
- Vetting & SIRE 2.0
- Career Advice
- Safety Lessons
- Achievement
- Learning
- Industry Opinion

`All` exists only as a feed filter, not as a stored post category.

## 6. Post card

Each post card contains only data that actually exists.

Header:
- author avatar / initials
- author full name
- professional headline or rank
- company when available
- timestamp rendered as human-readable relative time with accessible full date
- post category badge

Body:
- text content
- optional image/diagram
- optional poll
- safe link rendering can be added later

Footer:
- real reaction count
- real comment count
- real repost/share count only after repost support is implemented
- Like
- Comment
- Repost/Share
- Save

The first implementation should use a familiar `Like` interaction. Maritime-specific reactions such as `Insightful` and `Safety 1st` can be introduced in a later reaction-system expansion rather than complicating the initial data model.

## 7. Feed behavior

### First release ordering

Use deterministic reverse chronological ordering with stable pagination:
- `created_at DESC`
- `id DESC` as tie-breaker

Category filters narrow the same feed.

Do not implement opaque engagement-based ranking yet. A future recommendation layer can blend followed professionals, groups, categories, engagement, and recency after enough real network data exists.

### Visibility

First release posts are visible to authenticated active Sea N Shore members.

Future visibility levels such as public, connections-only, group-only, or company-only are explicitly deferred until the social graph is implemented.

## 8. Supabase data model

Add a focused social schema through versioned migrations.

### `posts`

Core columns:
- `id uuid primary key`
- `author_id uuid not null references profiles(id)`
- `category post_category not null`
- `body text not null`
- `post_type post_type not null default 'standard'`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`
- `deleted_at timestamptz null`

Validation:
- trimmed body
- sensible maximum length
- active/completed profile required for authoring
- soft deletion for user posts

### `post_media`

- `id uuid primary key`
- `post_id uuid references posts(id) on delete cascade`
- `storage_path text`
- `media_type`
- `alt_text`
- dimensions/metadata where useful
- `created_at`

Images are stored in a dedicated Supabase Storage bucket. Upload restrictions must validate MIME type, file size, ownership, and storage path.

### `post_reactions`

For first release Like only, while leaving the schema extensible:
- `post_id`
- `user_id`
- `reaction_type`
- `created_at`
- unique constraint so a member has one current reaction per post

### `post_comments`

- `id`
- `post_id`
- `author_id`
- `body`
- optional `parent_comment_id` may be included only if nested replies are implemented in the same release
- timestamps
- soft deletion

If replies are not implemented in the UI immediately, omit `parent_comment_id` until that milestone.

### `saved_posts`

- `user_id`
- `post_id`
- `created_at`
- composite primary key or unique constraint

### `post_polls`

- `post_id` one-to-one
- `closes_at` optional
- `allow_multiple` defaults false for initial release

### `post_poll_options`

- `id`
- `post_id`
- `label`
- stable display order

### `post_poll_votes`

- `post_id`
- `option_id`
- `user_id`
- `created_at`
- database constraints enforce the selected voting mode

Reposts can be implemented in the initial feed if the implementation remains simple; otherwise store/share work is prioritized first and reposts become the immediate next milestone. The UI must not display fake share counts when repost storage is absent.

## 9. Row-level security and database safety

Every new table must have RLS enabled before release.

Principles:
- authenticated active members can read active feed content
- users can insert only content owned by their own `auth.uid()`
- users can update/delete only their own posts/comments/reactions/saves/votes
- authorship IDs must not be user-selectable to impersonate another member
- moderation/admin capability must use explicit role checks rather than broad service-role use in browser code
- helper functions should live outside exposed schemas where practical
- any `SECURITY DEFINER` function must use `SET search_path = ''`, minimum grants, and explicit ownership
- policies should use `(select auth.uid())` where appropriate
- storage bucket policies must mirror database ownership rules

No service-role secret may be exposed to Next.js client code.

## 10. Application architecture

Use focused feature modules rather than placing feed logic directly in `page.tsx`.

Suggested structure:

- `src/features/feed/types.ts`
- `src/features/feed/schemas.ts`
- `src/features/feed/queries.ts`
- `src/features/feed/actions.ts`
- `src/features/feed/components/feed-layout.tsx`
- `src/features/feed/components/feed-profile-card.tsx`
- `src/features/feed/components/post-composer.tsx`
- `src/features/feed/components/feed-category-filter.tsx`
- `src/features/feed/components/post-card.tsx`
- `src/features/feed/components/comment-list.tsx`
- `src/features/feed/components/poll-card.tsx`

`src/app/(app)/home/page.tsx` remains a server-oriented composition point that:
1. requires the authenticated user
2. loads the signed-in profile
3. loads the first feed page
4. renders the three-column feed shell

Mutation actions revalidate the relevant feed/profile paths and return controlled user-facing errors.

## 11. Existing UI consistency

All new components must build on the current application's visual vocabulary:
- existing `Card` component
- existing navy/ocean/mist color tokens
- existing border and radius treatment
- existing typography hierarchy
- existing authenticated `AppHeader`
- existing `MobileNav`
- existing max-width application shell

The current `ProfileHeader`, `ProfileAbout`, and `MaritimeProfileCard` remain the full profile experience. The new left-rail profile card is a compact feed-specific summary and should reuse profile types/query/mapping logic rather than duplicate identity logic.

## 12. Loading, empty, and error states

### Empty feed

A legitimate new-network empty state should encourage the member to:
- publish the first maritime update
- explore Network
- visit Community

Do not insert fabricated member posts simply to make the feed look populated.

### Errors

- composer validation errors stay attached to the composer
- failed reactions/saves should restore the previous UI state if optimistic updates are used
- failed media uploads should not create orphan visible posts
- user-facing errors must be useful without revealing database internals

### Loading

Use existing Sea N Shore visual styling for skeletons/placeholders. Avoid layout shifts.

## 13. Accessibility

- semantic articles for posts
- keyboard-accessible composer and post actions
- descriptive labels for icon-only controls
- alt text field for uploaded images, with a practical fallback policy
- category filters exposed as understandable controls
- visible focus states consistent with current UI
- timestamps accessible beyond relative text alone
- poll state and results usable by keyboard and assistive technology

## 14. Testing strategy

### Unit/component tests

- profile summary mapping
- post and comment validation
- category filters
- post card rendering
- composer error preservation
- reaction/save state components
- poll behavior if included

### Query/action tests

- create post
- reject invalid post
- create/delete own comment
- like/unlike
- save/unsave
- category pagination
- ownership failures

### Database tests

Add Supabase SQL tests covering RLS for:
- post read/write/update/delete
- comments
- reactions
- saves
- polls/votes
- storage ownership if practical in the existing test setup

Critical negative tests must prove one member cannot mutate another member's social data.

### Release verification

Before completion claims:
- TypeScript check
- lint
- unit tests
- production build
- migration verification against the target Supabase project
- security advisor review
- deployed Vercel smoke test for authenticated `/home`

## 15. Delivery sequence

1. social schema, enums, RLS, tests
2. feed query and types
3. three-column `/home` shell and real profile rail
4. text composer and category filters
5. post cards and pagination
6. Like
7. comments
8. saves
9. image/diagram storage and rendering
10. polls
11. responsive/mobile polish
12. end-to-end verification and Vercel deployment check

If image storage or polls threaten reliability, they may land immediately after the core text/reaction/comment/save feed rather than blocking usable social networking.

## 16. Explicitly deferred

Not part of this home-feed milestone:
- direct messaging
- AI Co-Pilot / maritime assistant
- formal verification workflow and badges
- reputation scores
- advanced connection recommendations
- algorithmic engagement ranking
- groups/group feeds
- moderation dashboard
- sponsored posts/ads
- public unauthenticated post pages
- video upload
- push notifications

These features should build on the feed/social foundation rather than be simulated in the first release.

## 17. Success criteria

The milestone is complete when a signed-in, onboarded Sea N Shore member can:
- land on `/home` and see a polished maritime social feed instead of the welcome screen
- see their real professional identity in the left rail on desktop
- create a real categorized post
- see it in the feed
- filter feed categories
- like/unlike a post
- comment on a post
- save/unsave a post
- upload and display an image/diagram if media support lands in the milestone
- create/vote on a technical poll if poll support lands in the milestone
- use the experience comfortably on mobile

All of the above must use the existing Sea N Shore visual language and live Supabase data, with no fabricated social proof or verification state.
