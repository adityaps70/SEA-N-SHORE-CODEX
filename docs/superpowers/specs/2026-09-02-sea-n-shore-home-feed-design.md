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
6. This release builds the usable social-feed foundation without prematurely adding groups, messaging, AI, reputation scoring, or algorithmic recommendations.

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

Saved-post and network shortcuts are not part of this card until those destination experiences are implemented.

The left rail must not show invented `Verified CoC`, reputation points, connection counts, or other unsupported data.

### Center column: primary feed

The center column is the visual and functional priority.

Order:
1. post composer
2. category filter row
3. reverse-chronological community feed
4. explicit `Load more` pagination

Infinite scrolling is deferred until the first feed is stable and measurable.

### Right rail: discovery

The initial right rail contains useful navigation without fabricated listings:
- maritime topic/category shortcuts
- links to existing Jobs, Community, Learn, and Events surfaces
- a compact Sea N Shore network prompt

Real upcoming-event cards, job cards, and professional recommendations will replace navigation prompts only when those modules have real backing data and query APIs.

## 4. Mobile and tablet behavior

### Mobile

- single-column feed
- existing bottom navigation remains unchanged
- a compact signed-in profile summary appears above the composer
- composer follows the profile summary
- category filters scroll horizontally
- right discovery rail is omitted
- post actions remain touch-friendly with minimum interactive target sizes

### Tablet

- center feed remains primary
- profile rail remains visible when width permits
- right discovery rail collapses first

## 5. Feed composer

The composer must feel native to Sea N Shore and use the existing component styling.

Release controls:
- text post
- category selection
- image/diagram upload
- technical poll

Prompt copy: `Share a maritime update, technical lesson, or industry insight...`

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
- optional image/diagram when attached
- optional technical poll when the post type is poll

Footer:
- real Like count
- real comment count
- Like
- Comment
- Share
- Save

`Share` uses the browser Web Share API when available and falls back to copying a stable authenticated post URL. The first release does not show a share count because repost tracking is deferred.

The first implementation uses a familiar `Like` interaction. Maritime-specific reactions such as `Insightful` and `Safety 1st` are deferred to a later reaction-system expansion.

## 7. Feed behavior

### First release ordering

Use deterministic reverse chronological ordering with stable pagination:
- `created_at DESC`
- `id DESC` as tie-breaker

Each server page contains a fixed page size and `Load more` uses the last row's `(created_at, id)` cursor.

Category filters narrow the same feed.

Do not implement engagement-based ranking yet. A future recommendation layer can blend followed professionals, groups, categories, engagement, and recency after enough real network data exists.

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
- trim body before persistence
- body length 1-5000 characters for standard posts
- poll posts also require a non-empty body/question and valid poll options
- active, onboarding-completed profile required for authoring
- soft deletion for user posts

### `post_media`

- `id uuid primary key`
- `post_id uuid references posts(id) on delete cascade`
- `storage_path text not null`
- `media_type text not null`
- `alt_text text`
- `width integer`
- `height integer`
- `created_at timestamptz not null`

Release constraint: one image/diagram per post. Supported upload types are JPEG, PNG, and WebP with a 10 MB maximum.

Images are stored in a dedicated Supabase Storage bucket. Upload restrictions validate MIME type, file size, ownership, and user-scoped storage paths.

### `post_reactions`

Release 1 supports only Like while keeping the schema extensible:
- `post_id uuid`
- `user_id uuid`
- `reaction_type text not null default 'like'`
- `created_at timestamptz not null`
- unique `(post_id, user_id)`

Only `like` is accepted by a database constraint in this release.

### `post_comments`

- `id uuid primary key`
- `post_id uuid not null`
- `author_id uuid not null`
- `body text not null`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`
- `deleted_at timestamptz null`

Nested comment replies are deferred. First-release comments are one level only.

### `saved_posts`

- `user_id uuid`
- `post_id uuid`
- `created_at timestamptz not null`
- composite primary key `(user_id, post_id)`

### `post_polls`

- `post_id uuid primary key`
- `closes_at timestamptz null`
- `created_at timestamptz not null`

Release 1 polls are single-choice only.

### `post_poll_options`

- `id uuid primary key`
- `post_id uuid not null`
- `label text not null`
- `display_order smallint not null`

Polls require 2-6 non-empty options.

### `post_poll_votes`

- `post_id uuid not null`
- `option_id uuid not null`
- `user_id uuid not null`
- `created_at timestamptz not null`
- unique `(post_id, user_id)` to enforce single-choice voting

### Reposts

Reposts are not part of this milestone. The Share control performs browser sharing/copy-link only. No repost/share count is displayed.

## 9. Row-level security and database safety

Every new table must have RLS enabled before release.

Principles:
- authenticated active members can read active feed content
- users can insert only content owned by their own `(select auth.uid())`
- users can update/delete only their own posts/comments/reactions/saves/votes
- authorship IDs must not be user-selectable to impersonate another member
- posts require an active, onboarding-completed profile
- moderation/admin capability must use explicit role checks rather than broad service-role use in browser code
- helper functions should live outside exposed schemas where practical
- any `SECURITY DEFINER` function must use `SET search_path = ''`, minimum grants, and explicit ownership
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
- `src/features/feed/components/feed-discovery-rail.tsx`

`src/app/(app)/home/page.tsx` remains a server-oriented composition point that:
1. requires the authenticated user
2. loads the signed-in profile
3. loads the first feed page
4. renders the three-column feed shell

Mutation actions revalidate the relevant feed/profile paths and return controlled user-facing errors.

A stable authenticated post URL uses `/home?post=<uuid>` in this milestone; when present, the feed loads or locates that post and scroll/anchor behavior exposes it without introducing a separate public post route.

## 11. Existing UI consistency

All new components must build on the current application's visual vocabulary:
- existing `Card` component
- existing navy/ocean/mist color tokens
- existing border and radius treatment
- existing typography hierarchy
- existing authenticated `AppHeader`
- existing `MobileNav`
- existing max-width application shell

The current `ProfileHeader`, `ProfileAbout`, and `MaritimeProfileCard` remain the full profile experience. The new left-rail profile card is a compact feed-specific summary and reuses profile types/query/mapping logic rather than duplicating identity logic.

No Google AI Studio CSS, component code, or alternate design system is introduced.

## 12. Loading, empty, and error states

### Empty feed

A legitimate new-network empty state encourages the member to:
- publish the first maritime update
- explore Network
- visit Community

Do not insert fabricated member posts simply to make the feed look populated.

### Errors

- composer validation errors stay attached to the composer and preserve safe entered values
- failed reactions/saves restore the previous UI state when optimistic updates are used
- media upload completes before the post becomes visible; failed uploads do not create orphan visible posts
- failed poll creation is atomic with post creation
- user-facing errors must be useful without revealing database internals

### Loading

Use existing Sea N Shore visual styling for skeletons/placeholders and avoid layout shifts.

## 13. Accessibility

- semantic articles for posts
- keyboard-accessible composer and post actions
- descriptive labels for icon-only controls
- alt text input for uploaded images, with empty alt allowed only when the member marks the image decorative
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
- image composer state
- poll creation/voting behavior
- share fallback behavior

### Query/action tests

- create text post
- create image post
- create poll post
- reject invalid post
- create/delete own comment
- like/unlike
- save/unsave
- vote and change poll vote only according to defined semantics
- category pagination
- ownership failures
- stable post query lookup

### Database tests

Add Supabase SQL tests covering RLS for:
- post read/write/update/delete
- comments
- reactions
- saves
- polls/votes
- media ownership

Critical negative tests must prove one member cannot mutate another member's social data.

### Release verification

Before completion claims:
- TypeScript check
- lint
- unit tests
- production build
- migration verification against Supabase project `rrxyiwajrzcepyvscidh`
- Supabase security advisor review
- deployed Vercel smoke test for authenticated `/home`
- manual mobile-width smoke test

## 15. Delivery sequence

1. social schema, storage bucket policy, RLS, and database tests
2. feed types, schemas, queries, and actions
3. three-column `/home` shell and real profile rail
4. text composer and category filters
5. post cards and cursor-based `Load more`
6. Like
7. comments
8. saves
9. image/diagram upload and rendering
10. technical polls and voting
11. Share/copy-link behavior
12. responsive/mobile polish
13. end-to-end verification and Vercel deployment check

All items 1-13 are part of this milestone; none are optional completion criteria.

## 16. Explicitly deferred

Not part of this home-feed milestone:
- direct messaging
- AI Co-Pilot / maritime assistant
- formal verification workflow and badges
- reputation scores
- advanced connection recommendations
- algorithmic engagement ranking
- groups/group feeds
- nested comment replies
- reposts/repost counts
- multiple images per post
- video upload
- moderation dashboard
- sponsored posts/ads
- public unauthenticated post pages
- push notifications
- maritime-specific reactions beyond Like

These features should build on the feed/social foundation rather than be simulated in the first release.

## 17. Success criteria

The milestone is complete when a signed-in, onboarded Sea N Shore member can:
- land on `/home` and see a polished maritime social feed instead of the welcome screen
- see their real professional identity in the left rail on desktop and compact summary on mobile
- create a real categorized text post
- upload and display one image/diagram post
- create and vote on a single-choice technical poll
- see new posts in the feed
- filter feed categories
- load older posts with stable pagination
- like/unlike a post
- comment on a post
- save/unsave a post
- share/copy a stable authenticated post link
- use the experience comfortably on mobile

All of the above must use the existing Sea N Shore visual language and live Supabase data, with no fabricated social proof or verification state.
