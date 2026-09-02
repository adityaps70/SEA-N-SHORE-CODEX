# Sea N Shore Home Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current `/home` welcome card with a production-ready maritime professional feed using real Supabase data, the existing Sea N Shore UI system, and secure social interactions.

**Architecture:** Keep `/home` server-oriented for authentication, profile loading, and the initial feed page. Put social behavior in `src/features/feed` with typed queries, Zod validation, server actions, and small client interaction components. Add social data through versioned Supabase migrations with RLS, a private image bucket, and stable cursor pagination ordered by `created_at DESC, id DESC`.

**Tech Stack:** Next.js 16.3.4, React 19.2.8, TypeScript 5, Tailwind CSS 4, Supabase JS/SSR 2.112.4/0.12.5, PostgreSQL + RLS, Zod 4.5.4, Vitest 4.1.11, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-02-sea-n-shore-home-feed-design.md`

## Global Constraints

- Preserve the existing navy/ocean/mist palette, typography, card radii/shadows, `AppHeader`, `MobileNav`, and `max-w-7xl` authenticated shell.
- Use only real profile/social data. Never fabricate verification, reputation, connections, reactions, comments, shares, credentials, jobs, events, or named professionals.
- Verification UI remains absent until a real verification workflow exists.
- Categories are exactly: Maritime News, Technical Discussion, Vetting & SIRE 2.0, Career Advice, Safety Lessons, Achievement, Learning, Industry Opinion.
- Reaction system is Like only.
- Feed is for authenticated active members with completed onboarding.
- Feed order is exactly `created_at DESC, id DESC` with cursor-based Load More.
- One optional post image: JPEG/PNG/WebP, maximum 5 MiB, private Supabase Storage, signed URLs.
- Polls are single-choice with 2–6 distinct options.
- Do not add groups, messaging, AI Co-Pilot, reputation scoring, algorithmic ranking, video, sponsored posts, or public unauthenticated post pages.
- Never expose a service-role key to client code.
- Enable RLS on every social table before release.
- Prefer `SECURITY INVOKER`. Any `SECURITY DEFINER` function must set `search_path = ''`, use explicit ownership, and minimum grants.
- Read `AGENTS.md` and the installed Next.js 16 docs before changing Next.js APIs.

## File Map

Database:
- `supabase/migrations/20260902102000_create_feed_core.sql`
- `supabase/migrations/20260902102100_add_feed_media_and_polls.sql`
- `supabase/tests/feed_rls.test.sql`
- `supabase/tests/feed_poll_rls.test.sql`
- regenerate `src/lib/supabase/database.types.ts`

Domain/server:
- `src/features/feed/types.ts`
- `src/features/feed/schemas.ts`
- `src/features/feed/schemas.test.ts`
- `src/features/feed/mappers.ts`
- `src/features/feed/mappers.test.ts`
- `src/features/feed/queries.ts`
- `src/features/feed/queries.test.ts`
- `src/features/feed/actions.ts`
- `src/features/feed/actions.test.ts`

UI:
- `src/features/feed/profile-completion.ts`
- `src/features/feed/profile-completion.test.ts`
- `src/features/feed/components/feed-layout.tsx`
- `src/features/feed/components/feed-profile-card.tsx`
- `src/features/feed/components/feed-profile-card.test.tsx`
- `src/features/feed/components/feed-discovery-rail.tsx`
- `src/features/feed/components/feed-category-filter.tsx`
- `src/features/feed/components/post-composer.tsx`
- `src/features/feed/components/post-composer.test.tsx`
- `src/features/feed/components/feed-list.tsx`
- `src/features/feed/components/post-card.tsx`
- `src/features/feed/components/post-card.test.tsx`
- `src/features/feed/components/comment-thread.tsx`
- `src/features/feed/components/poll-card.tsx`
- `src/features/feed/components/share-post-button.tsx`

Routes/config:
- replace `src/app/(app)/home/page.tsx`
- create `src/app/(app)/posts/[id]/page.tsx`
- modify `next.config.ts`
- create `tests/e2e/home-feed.spec.ts`

---

### Task 1: Core feed schema and RLS

**Files:**
- Create: `supabase/migrations/20260902102000_create_feed_core.sql`

**Interfaces:**
- Produces enums `post_category`, `post_type`, `post_reaction_type`.
- Produces `posts`, `post_reactions`, `post_comments`, `saved_posts`.

- [ ] **Step 1: Create enums and tables**

```sql
create type public.post_category as enum (
  'maritime_news', 'technical_discussion', 'vetting_sire_2_0',
  'career_advice', 'safety_lessons', 'achievement', 'learning', 'industry_opinion'
);
create type public.post_type as enum ('standard', 'poll');
create type public.post_reaction_type as enum ('like');

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  category public.post_category not null,
  body text not null,
  post_type public.post_type not null default 'standard',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (body = btrim(body) and char_length(body) between 1 and 5000)
);

create table public.post_reactions (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction_type public.post_reaction_type not null default 'like',
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (body = btrim(body) and char_length(body) between 1 and 2000)
);

create table public.saved_posts (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
```

- [ ] **Step 2: Add indexes and updated-at trigger**

```sql
create index posts_feed_idx on public.posts(created_at desc, id desc) where deleted_at is null;
create index posts_category_feed_idx on public.posts(category, created_at desc, id desc) where deleted_at is null;
create index post_comments_post_idx on public.post_comments(post_id, created_at asc) where deleted_at is null;
create index post_reactions_post_idx on public.post_reactions(post_id);
create index saved_posts_user_idx on public.saved_posts(user_id, created_at desc);

create or replace function private.set_feed_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin new.updated_at := now(); return new; end; $$;
revoke all on function private.set_feed_updated_at() from public, anon, authenticated, service_role;

create trigger posts_set_updated_at before update on public.posts
for each row execute procedure private.set_feed_updated_at();
create trigger post_comments_set_updated_at before update on public.post_comments
for each row execute procedure private.set_feed_updated_at();
```

- [ ] **Step 3: Enable RLS and minimum grants**

```sql
alter table public.posts enable row level security;
alter table public.post_reactions enable row level security;
alter table public.post_comments enable row level security;
alter table public.saved_posts enable row level security;

revoke all on public.posts, public.post_reactions, public.post_comments, public.saved_posts from anon, authenticated;
grant select, insert on public.posts to authenticated;
grant update (body, category, deleted_at) on public.posts to authenticated;
grant select, insert, delete on public.post_reactions to authenticated;
grant select, insert on public.post_comments to authenticated;
grant update (body, deleted_at) on public.post_comments to authenticated;
grant select, insert, delete on public.saved_posts to authenticated;
```

- [ ] **Step 4: Add ownership/member policies**

Use this exact membership predicate in read/insert policies:

```sql
exists (
  select 1 from public.profiles viewer
  where viewer.id = (select auth.uid())
    and viewer.account_status = 'active'
    and viewer.onboarding_completed_at is not null
)
```

`posts`: active members read non-deleted posts; inserts require `author_id = auth.uid()`; updates require own author ID.

`post_comments`: active members read non-deleted comments; inserts/updates require own `author_id`.

`post_reactions`: active members read reactions; inserts/deletes require own `user_id`.

`saved_posts`: users may select/insert/delete only rows whose `user_id = auth.uid()`.

- [ ] **Step 5: Reset local database**

```bash
npx supabase db reset
```

Expected: migration applies without SQL error.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260902102000_create_feed_core.sql
git commit -m "feat: add secure feed core schema"
```

---

### Task 2: Private image media and technical polls

**Files:**
- Create: `supabase/migrations/20260902102100_add_feed_media_and_polls.sql`

**Interfaces:**
- Produces `post_media`, `post_polls`, `post_poll_options`, `post_poll_votes`, private bucket `post-media`, and `create_poll_post(...)`.

- [ ] **Step 1: Add media and poll tables**

```sql
create table public.post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null unique references public.posts(id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  alt_text text check (alt_text is null or char_length(alt_text) <= 300),
  created_at timestamptz not null default now()
);

create table public.post_polls (
  post_id uuid primary key references public.posts(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.post_poll_options (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.post_polls(post_id) on delete cascade,
  label text not null check (label = btrim(label) and char_length(label) between 1 and 120),
  position smallint not null check (position between 0 and 5),
  unique (post_id, position), unique (post_id, id)
);

create table public.post_poll_votes (
  post_id uuid not null,
  option_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id),
  foreign key (post_id, option_id) references public.post_poll_options(post_id, id) on delete cascade
);
```

- [ ] **Step 2: Add RLS**

Enable RLS on all four tables. Active completed members can read media/polls/options/votes. Only the post author may insert/delete media and poll definitions. A voter may insert/update/delete only their own vote. Grant only the table operations required for those policies.

- [ ] **Step 3: Add private Storage bucket and object policies**

```sql
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('post-media','post-media',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
```

Upload/delete policy requires:

```sql
bucket_id = 'post-media'
and (storage.foldername(name))[1] = (select auth.uid())::text
```

Read policy requires authenticated active completed membership. Keep the bucket private.

- [ ] **Step 4: Create atomic single-choice poll RPC**

```sql
create or replace function public.create_poll_post(
  p_category public.post_category,
  p_body text,
  p_options text[]
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_user_id uuid := (select auth.uid());
  v_post_id uuid := gen_random_uuid();
  v_options text[];
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'authentication required';
  end if;

  select array_agg(option_text order by first_position)
  into v_options
  from (
    select distinct on (lower(btrim(value))) btrim(value) option_text, position first_position
    from unnest(coalesce(p_options, '{}'::text[])) with ordinality as entry(value, position)
    where char_length(btrim(value)) between 1 and 120
    order by lower(btrim(value)), position
  ) normalized;

  if coalesce(cardinality(v_options), 0) not between 2 and 6 then
    raise exception using errcode = '22023', message = 'polls require 2 to 6 distinct options';
  end if;

  insert into public.posts(id, author_id, category, body, post_type)
  values (v_post_id, v_user_id, p_category, btrim(p_body), 'poll');
  insert into public.post_polls(post_id) values (v_post_id);
  insert into public.post_poll_options(post_id, label, position)
  select v_post_id, value, (ordinality - 1)::smallint from unnest(v_options) with ordinality;
  return v_post_id;
end;
$$;

revoke all on function public.create_poll_post(public.post_category,text,text[]) from public, anon, authenticated, service_role;
grant execute on function public.create_poll_post(public.post_category,text,text[]) to authenticated;
```

- [ ] **Step 5: Reset local database**

```bash
npx supabase db reset
```

Expected: both new migrations apply; `post-media` is private.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260902102100_add_feed_media_and_polls.sql
git commit -m "feat: add feed media and polls"
```

---

### Task 3: Database security tests and generated types

**Files:**
- Create: `supabase/tests/feed_rls.test.sql`
- Create: `supabase/tests/feed_poll_rls.test.sql`
- Modify: `src/lib/supabase/database.types.ts`

**Interfaces:**
- Proves member A cannot mutate member B's social content.
- Supplies generated table/enums/function types to the application.

- [ ] **Step 1: Write core pgTAP tests**

Create two fixed auth users, complete their profile rows during privileged setup, then simulate each authenticated JWT with `set_config('request.jwt.claim.sub', '<uuid>', true)`.

Include these assertions:

```sql
select lives_ok(
  $$ insert into public.posts(id, author_id, category, body)
     values ('aaaaaaaa-0000-4000-8000-000000000001',
             '11111111-1111-4111-8111-111111111111',
             'technical_discussion',
             'A real technical lesson from member A.') $$,
  'member A creates own post'
);
```

As member B, an update against member A's post must affect zero rows. B may like/comment/save A's readable post, but B can select only B's own save. After B is suspended, B must see zero feed rows.

- [ ] **Step 2: Write media/poll pgTAP tests**

Assert `create_poll_post` accepts 2–6 distinct options and rejects 1 or 7; B can vote/change B's vote; B cannot modify A's poll definitions; media metadata can only be attached to the current author's post; `post_media.post_id` rejects a second image row.

- [ ] **Step 3: Run DB tests**

```bash
npm run test:db
```

Expected: all feed pgTAP tests pass.

- [ ] **Step 4: Generate TypeScript types from the locally migrated schema**

This must use the local database before production migrations are applied:

```bash
npx supabase gen types typescript --local > src/lib/supabase/database.types.ts
```

Verify generated types include all eight social tables, `post_category`, `post_type`, and `create_poll_post`.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add supabase/tests src/lib/supabase/database.types.ts
git commit -m "test: cover feed security rules"
```

Expected: typecheck PASS.

---

### Task 4: Feed domain model, schemas, and mappers

**Files:**
- Create: `src/features/feed/types.ts`
- Create: `src/features/feed/schemas.ts`
- Create: `src/features/feed/schemas.test.ts`
- Create: `src/features/feed/mappers.ts`
- Create: `src/features/feed/mappers.test.ts`

**Interfaces:**
- `FeedCursor = { createdAt: string; id: string }`
- `FeedPage = { posts: FeedPost[]; nextCursor: FeedCursor | null }`
- `POST_CATEGORIES`, `POST_CATEGORY_LABELS`, `createPostInputSchema`, `commentInputSchema`, `feedRequestSchema`, `pollVoteSchema`.

- [ ] **Step 1: Write failing validation tests**

```ts
it('normalizes a standard post', () => {
  const value = createPostInputSchema.parse({
    category: 'technical_discussion', body: '  Main engine lesson.  ', mode: 'standard', pollOptions: [],
  })
  expect(value.body).toBe('Main engine lesson.')
})

it('rejects fewer than two distinct poll choices', () => {
  expect(() => createPostInputSchema.parse({
    category: 'career_advice', body: 'Which shore role?', mode: 'poll',
    pollOptions: ['Marine Superintendent', 'Marine Superintendent'],
  })).toThrow()
})
```

- [ ] **Step 2: Run failing tests**

```bash
npm test -- src/features/feed/schemas.test.ts
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement constants and schemas**

Enum values:

```ts
export const POST_CATEGORIES = [
  'maritime_news','technical_discussion','vetting_sire_2_0','career_advice',
  'safety_lessons','achievement','learning','industry_opinion',
] as const
```

Labels map one-to-one to the approved human labels. Body: 1–5000; comment: 1–2000; poll: 2–6 distinct trimmed options of 1–120; feed limit: 1–20 default 12; cursor ID UUID and date ISO datetime.

- [ ] **Step 4: Implement and test mappers**

Map author identity/maritime fields, real reaction/comment counts, viewer like/save/vote state, image metadata + supplied signed URL, and poll options sorted by `position`. Missing maritime data maps to null/empty values rather than invented copy.

- [ ] **Step 5: Run tests and commit**

```bash
npm test -- src/features/feed/schemas.test.ts src/features/feed/mappers.test.ts
git add src/features/feed
git commit -m "feat: define feed domain model"
```

Expected: PASS.

---

### Task 5: Deterministic feed queries

**Files:**
- Create: `src/features/feed/queries.ts`
- Create: `src/features/feed/queries.test.ts`

**Interfaces:**
- `getFeedPage(input?): Promise<FeedPage>`
- `getPostById(id): Promise<FeedPost | null>`
- `buildFeedCursorFilter(cursor): string`

- [ ] **Step 1: Write failing cursor test**

```ts
expect(buildFeedCursorFilter({
  createdAt: '2026-09-02T10:00:00.000Z',
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
})).toBe(
  'created_at.lt.2026-09-02T10:00:00.000Z,and(created_at.eq.2026-09-02T10:00:00.000Z,id.lt.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa)'
)
```

- [ ] **Step 2: Implement query pipeline**

Use `requireUser()` and `createServerSupabaseClient()`. Request `limit + 1`; order first `created_at` descending, then `id` descending. Apply `.eq('category', category)` only when filtered and `.or(buildFeedCursorFilter(cursor))` only after Zod cursor validation.

Select author profile/maritime data, one media row, reaction count, comment count, poll/options/vote counts. Batch viewer-specific likes, saves, and poll votes for the returned post IDs.

- [ ] **Step 3: Sign private images in one call**

```ts
supabase.storage.from('post-media').createSignedUrls(paths, 3600)
```

A signing failure for one media item removes only that image from its mapped post; it does not fail the whole feed.

- [ ] **Step 4: Implement single-post query using the same mapper**

Deleted/inaccessible/missing post returns null.

- [ ] **Step 5: Test/typecheck/commit**

```bash
npm test -- src/features/feed/queries.test.ts
npm run typecheck
git add src/features/feed/queries.ts src/features/feed/queries.test.ts
git commit -m "feat: add paginated feed queries"
```

Expected: PASS.

---

### Task 6: Server actions for posts, Load More, likes, saves, comments, votes

**Files:**
- Create: `src/features/feed/actions.ts`
- Create: `src/features/feed/actions.test.ts`

**Interfaces:**
- `createPost(previousState, formData)`
- `loadFeedPage(input)`
- `setPostLiked(postId, liked)`
- `setPostSaved(postId, saved)`
- `addComment(previousState, formData)`
- `setPollVote(postId, optionId)`

- [ ] **Step 1: Write failing action tests**

Mock auth/Supabase. Invalid body must not call Supabase. `setPostLiked(id,false)` must delete with both `.eq('post_id', id)` and `.eq('user_id', user.id)`.

- [ ] **Step 2: Implement standard post creation**

Never accept author ID from FormData:

```ts
const postId = crypto.randomUUID()
await supabase.from('posts').insert({
  id: postId, author_id: user.id, category: data.category, body: data.body, post_type: 'standard',
})
```

On success `revalidatePath('/home')` and return `{ ok: true, postId }`.

- [ ] **Step 3: Implement remaining mutations**

Like true: upsert `{post_id,user_id,reaction_type:'like'}`; false: delete own row. Save uses identical desired-state semantics. Comment inserts own author ID. `loadFeedPage` validates then calls `getFeedPage`. Vote upserts `{post_id,option_id,user_id}`.

- [ ] **Step 4: Control errors**

Return useful form/action errors without returning raw database messages or SQL codes to UI.

- [ ] **Step 5: Test/typecheck/commit**

```bash
npm test -- src/features/feed/actions.test.ts
npm run typecheck
git add src/features/feed/actions.ts src/features/feed/actions.test.ts
git commit -m "feat: add feed mutation actions"
```

Expected: PASS.

---

### Task 7: Three-column home shell and real profile rail

**Files:**
- Create: `src/features/feed/profile-completion.ts`
- Create: `src/features/feed/profile-completion.test.ts`
- Create: `src/features/feed/components/feed-layout.tsx`
- Create: `src/features/feed/components/feed-profile-card.tsx`
- Create: `src/features/feed/components/feed-profile-card.test.tsx`
- Create: `src/features/feed/components/feed-discovery-rail.tsx`
- Modify: `src/app/(app)/home/page.tsx`

**Interfaces:**
- `calculateProfileCompletion(profile: OwnProfile): number`
- `FeedLayout({ profile, initialPage, category })`

- [ ] **Step 1: Test completion and profile card**

Maritime completion uses eight real fields: full name, headline, summary, location, at least one skill, rank, current company, sailing experience. Full = 100, four of eight = 50. Non-maritime uses the five generic fields.

Card test must render real name/headline/rank/company/experience/availability/completion/View Profile and must not render `Verified`, `Reputation`, or a fabricated connection count.

- [ ] **Step 2: Implement profile rail**

Use existing `Card`, the same gradient family as `ProfileHeader`, initials fallback, current Sea N Shore type/colors. Desktop rail is sticky; mobile version is compact.

- [ ] **Step 3: Implement discovery rail without fake listings**

Show maritime category links and navigation-only cards for Network, Events, Jobs. Do not show fake vacancies, people, event dates, or counts.

- [ ] **Step 4: Replace `/home`**

```ts
const profile = await getOwnProfile()
if (!profile) redirect('/onboarding')
const category = parseFeedCategory((await searchParams).category)
const initialPage = await getFeedPage({ category })
```

Layout: desktop `280px | feed | 300px`; medium `280px | feed`; mobile one column. Center feed stays dominant.

- [ ] **Step 5: Test/typecheck/commit**

```bash
npm test -- src/features/feed/profile-completion.test.ts src/features/feed/components/feed-profile-card.test.tsx
npm run typecheck
git add src/features/feed/profile-completion* src/features/feed/components/feed-layout.tsx src/features/feed/components/feed-profile-card* src/features/feed/components/feed-discovery-rail.tsx 'src/app/(app)/home/page.tsx'
git commit -m "feat: turn home into feed layout"
```

Expected: PASS.

---

### Task 8: Composer, filters, post cards, comments, Load More

**Files:**
- Create: `src/features/feed/components/feed-category-filter.tsx`
- Create: `src/features/feed/components/post-composer.tsx`
- Create: `src/features/feed/components/post-composer.test.tsx`
- Create: `src/features/feed/components/feed-list.tsx`
- Create: `src/features/feed/components/post-card.tsx`
- Create: `src/features/feed/components/post-card.test.tsx`
- Create: `src/features/feed/components/comment-thread.tsx`

**Interfaces:**
- Composer uses `useActionState(createPost, ...)`.
- FeedList appends `loadFeedPage` results.
- PostCard uses desired-state Like/Save actions.

- [ ] **Step 1: Write composer and card tests**

Composer placeholder is exactly `Share a maritime update, technical lesson, or industry insight...`. Ensure category choice exists, submitted/invalid state is accessible, and no `Ask Co-Pilot` exists.

Post card test requires semantic `<article>`, author link, category, `<time dateTime>`, real counts, Like/Comment/Share/Save, and no unsupported verification badge.

- [ ] **Step 2: Implement category links**

`All -> /home`; each category -> `/home?category=<enum>`. Mobile row scrolls horizontally.

- [ ] **Step 3: Implement composer**

On success clear form and `router.refresh()`; preserve safe entered values on failure.

- [ ] **Step 4: Implement post card + optimistic Like/Save**

Update local UI immediately with `useTransition`, then restore previous state if action returns failure. Use plain Like only.

- [ ] **Step 5: Implement comments**

Show real loaded comments and add-comment form. Successful comment refreshes route. No placeholder/fake comments.

- [ ] **Step 6: Implement Load More**

Append returned posts, de-duplicate by ID, use returned next cursor, hide button when cursor is null.

- [ ] **Step 7: Implement real empty state**

Prompt to publish, visit Network, or Community. Do not seed sample member posts.

- [ ] **Step 8: Test/typecheck/commit**

```bash
npm test -- src/features/feed/components/post-composer.test.tsx src/features/feed/components/post-card.test.tsx
npm run typecheck
git add src/features/feed/components
git commit -m "feat: add interactive maritime feed"
```

Expected: PASS.

---

### Task 9: Secure image/diagram upload

**Files:**
- Modify: `src/features/feed/actions.ts`
- Modify: `src/features/feed/actions.test.ts`
- Modify: `src/features/feed/components/post-composer.tsx`
- Modify: `src/features/feed/components/post-card.tsx`
- Modify: `next.config.ts`

**Interfaces:**
- FormData optional keys: `media`, `altText`.
- One image on standard posts; polls and images cannot be combined in this release.

- [ ] **Step 1: Test media validation**

Reject >5 MiB, GIF/other MIME, poll+image, alt >300. Accept JPEG/PNG/WebP.

- [ ] **Step 2: Validate MIME and size server-side**

```ts
const extensionByMime = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
} as const
```

Use MIME mapping, not filename extension.

- [ ] **Step 3: Upload with cleanup**

Path is `${user.id}/${postId}/${crypto.randomUUID()}.${extension}`. Upload first. Insert post next, media metadata last. If DB insert fails, remove uploaded storage object. If metadata insert fails after post insert, remove storage object and remove/soft-delete the just-created post so no broken feed item remains.

- [ ] **Step 4: Add composer controls and rendering**

Photo/Diagram button, one accepted file, filename preview/remove, optional alt input. Use `next/image`; add HTTPS `**.supabase.co` to `images.remotePatterns` in `next.config.ts`.

- [ ] **Step 5: Verify**

```bash
npm test -- src/features/feed/actions.test.ts src/features/feed/components/post-composer.test.tsx src/features/feed/components/post-card.test.tsx
npm run lint
npm run typecheck
git add src/features/feed next.config.ts
git commit -m "feat: add private feed images"
```

Expected: PASS with zero lint warnings.

---

### Task 10: Technical poll UI and voting

**Files:**
- Modify: `src/features/feed/components/post-composer.tsx`
- Modify: `src/features/feed/components/post-composer.test.tsx`
- Create: `src/features/feed/components/poll-card.tsx`
- Modify: `src/features/feed/components/post-card.tsx`
- Modify: `src/features/feed/actions.ts`

**Interfaces:**
- Poll form sends `mode='poll'` and repeated `pollOption` values.
- `createPost` calls RPC `create_poll_post` for poll mode.

- [ ] **Step 1: Test poll composer**

Technical Poll reveals two inputs. Add stops at 6; remove stops at 2; blanks/duplicates fail validation; media is disabled in poll mode.

- [ ] **Step 2: Implement poll state and RPC submission**

```ts
await supabase.rpc('create_poll_post', {
  p_category: data.category,
  p_body: data.body,
  p_options: data.pollOptions,
})
```

- [ ] **Step 3: Build accessible poll card**

Use fieldset/radio semantics. Before vote show choices; after vote show real counts and percentages. Selected option stays visible. Members may change their vote through `setPollVote`.

- [ ] **Step 4: Verify/commit**

```bash
npm test -- src/features/feed/components/post-composer.test.tsx src/features/feed/components/post-card.test.tsx src/features/feed/actions.test.ts
npm run typecheck
git add src/features/feed
git commit -m "feat: add technical feed polls"
```

Expected: PASS.

---

### Task 11: Authenticated post detail and Share

**Files:**
- Create: `src/app/(app)/posts/[id]/page.tsx`
- Create: `src/features/feed/components/share-post-button.tsx`
- Modify: `src/features/feed/components/post-card.tsx`

**Interfaces:**
- Share URL `/posts/<uuid>`.
- No stored share/repost count.

- [ ] **Step 1: Add detail route**

```ts
export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const post = await getPostById(id)
  if (!post) notFound()
  return <div className="mx-auto max-w-3xl"><PostCard post={post} detail /></div>
}
```

- [ ] **Step 2: Add native share/clipboard fallback**

```ts
const url = new URL(`/posts/${postId}`, window.location.origin).toString()
```

Use `navigator.share` when available, otherwise clipboard. Announce `Link copied` via `aria-live="polite"`. Do not increment any share count.

- [ ] **Step 3: Verify/commit**

```bash
npm run lint
npm run typecheck
git add 'src/app/(app)/posts/[id]/page.tsx' src/features/feed/components/share-post-button.tsx src/features/feed/components/post-card.tsx
git commit -m "feat: add feed post sharing"
```

Expected: PASS.

---

### Task 12: Accessibility, responsive QA, production migration, Vercel release

**Files:**
- Modify feed components only when QA identifies an issue.
- Create: `tests/e2e/home-feed.spec.ts`

**Interfaces:**
- Release completes only after code checks, database checks, advisor review, and deployed smoke verification.

- [ ] **Step 1: Accessibility pass**

Require semantic articles; author/body labels; `aria-label` on icon-only controls; practical 44px targets; `<time dateTime>`; labeled category navigation; stored image alt with fallback `Image attached to <author>'s post`; keyboard-operable polls; `role="alert"`/`aria-live` for mutation failures; existing focus ring retained.

- [ ] **Step 2: Responsive pass**

390px: one feed column + existing bottom nav + compact profile + horizontal category scroll.

768px: center-first layout, no right rail.

1024px: left profile + feed.

1280px+: left profile + feed + discovery.

Only category row may intentionally scroll horizontally.

- [ ] **Step 3: Add Playwright smoke tests**

```ts
import { expect, test } from '@playwright/test'

test('signed-out visitor is redirected from home', async ({ page }) => {
  await page.goto('/home')
  await expect(page).toHaveURL(/\/auth\/sign-in/)
})
```

Add authenticated smoke path using uncommitted `E2E_USER_EMAIL`/`E2E_USER_PASSWORD`: sign in through UI, expect composer placeholder and real profile card, and assert no `/Verified CoC|Reputation 6,200/i` text.

- [ ] **Step 4: Full repository verification**

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:db
```

All available commands must pass. If Docker/local Supabase blocks `test:db`, explicitly record that limitation; do not claim it passed.

- [ ] **Step 5: Apply the two versioned migrations to production Supabase**

Target project: `rrxyiwajrzcepyvscidh`.

Apply in order:
1. `20260902102000_create_feed_core`
2. `20260902102100_add_feed_media_and_polls`

Verify migration history and RLS on every new table.

- [ ] **Step 6: Regenerate production types and compare**

After production migrations are confirmed, generate types from project `rrxyiwajrzcepyvscidh` and confirm they are materially identical to the local-generated file. Commit only if production generation exposes a legitimate schema difference.

- [ ] **Step 7: Run Supabase advisors**

No new feed table may have `RLS Enabled No Policy`. A new feed `SECURITY DEFINER` warning is a release blocker; feed RPC is intentionally `SECURITY INVOKER`. Document unrelated pre-existing advisor findings separately.

- [ ] **Step 8: Merge verified feature branch to `main` without force-push**

Preserve concurrent changes. The Vercel project is linked to `adityaps70/SEA-N-SHORE-CODEX`, production branch `main`.

- [ ] **Step 9: Verify Vercel deployment**

Confirm Ready state, deployed SHA equals merged feed SHA, build has no env-validation error, and logs show no repeating feed 4xx/5xx failures. Authenticated `/home` must show composer + real profile rail + real feed/empty state.

- [ ] **Step 10: Commit QA fixes if QA changed files**

```bash
git add tests/e2e/home-feed.spec.ts src/features/feed src/app next.config.ts
git commit -m "test: verify home feed release"
```

Do not create an empty commit.

---

## Plan Self-Review

**Spec coverage:** three-column layout Task 7; real profile rail Task 7; text/category feed Tasks 4–8; Like/Comment/Save Tasks 1,6,8; image Task 9; poll Task 10; Share Task 11; stable pagination Task 5/8; mobile/accessibility Task 12; RLS Tasks 1–3; production verification Task 12.

**No-placeholder check:** no TBD/TODO steps, no undefined `add validation/error handling` instructions, and each task names its files, interfaces, commands, and expected behavior.

**Type consistency:** `FeedCursor` is `{ createdAt, id }`; `FeedPage` is `{ posts, nextCursor }`; Like/Save use desired booleans; poll vote is one row per `(post_id,user_id)`; database RPC is consistently `create_poll_post(category, body, options)`.

**Self-review correction incorporated:** development types are generated with `supabase gen types --local` after local migrations, because the production project does not receive the new migrations until Task 12. Production types are rechecked only after those migrations are applied.
