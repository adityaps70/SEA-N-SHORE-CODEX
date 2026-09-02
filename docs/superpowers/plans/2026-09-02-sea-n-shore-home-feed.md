# Sea N Shore Home Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current `/home` welcome card with a production-ready maritime professional feed using real Supabase data, the existing Sea N Shore UI system, and secure social interactions.

**Architecture:** Keep `/home` server-oriented for authentication, profile loading, and the first feed page. Put social behavior in a focused `src/features/feed` module with typed queries, Zod validation, server actions, and client interaction components. Add the social schema through versioned Supabase migrations with RLS, a private image bucket, and deterministic cursor pagination ordered by `created_at DESC, id DESC`.

**Tech Stack:** Next.js 16.3.4, React 19.2.8, TypeScript 5, Tailwind CSS 4, Supabase JS/SSR 2.112.4/0.12.5, PostgreSQL + RLS, Zod 4.5.4, Vitest 4.1.11, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-02-sea-n-shore-home-feed-design.md`

## Global Constraints

- Preserve the existing Sea N Shore navy/ocean/mist palette, typography, card radius, card shadow, navigation, and authenticated app shell.
- Use only real profile/social data. Do not add fabricated verification badges, reputation points, connection counts, reaction counts, comments, shares, credentials, jobs, events, or professionals.
- Keep verification UI absent until a database-backed verification workflow exists.
- Initial post categories are exactly: Maritime News, Technical Discussion, Vetting & SIRE 2.0, Career Advice, Safety Lessons, Achievement, Learning, Industry Opinion.
- Initial reaction system is Like only.
- Posts are visible only to authenticated active members with completed onboarding.
- Feed order is `created_at DESC, id DESC` with stable cursor pagination.
- Initial post image support is one JPEG, PNG, or WebP image up to 5 MiB; images live in a private Supabase Storage bucket and are rendered through signed URLs.
- Initial polls are single-choice, with 2–6 options.
- Do not add groups, messaging, AI Co-Pilot, reputation scoring, algorithmic ranking, video upload, sponsored posts, or public unauthenticated post pages in this milestone.
- Do not expose a Supabase service-role key to browser code.
- Every new social table must have RLS enabled before release.
- Any database function that is `SECURITY DEFINER` must have `SET search_path = ''`, explicit ownership, and minimum grants. Prefer `SECURITY INVOKER` where possible.
- Keep the existing `AppHeader`, `MobileNav`, and `max-w-7xl` application shell unless a feed-specific child layout needs narrower columns.
- Read the repository `AGENTS.md` and the installed Next.js 16 docs before changing Next.js APIs.

---

## File Structure

Create or modify these units. Each file has one responsibility.

### Database
- Create `supabase/migrations/20260902102000_create_feed_core.sql` — posts, comments, likes, saves, core RLS, indexes, updated-at trigger.
- Create `supabase/migrations/20260902102100_add_feed_media_and_polls.sql` — post media, private storage bucket/policies, polls/options/votes, poll-creation RPC.
- Create `supabase/tests/feed_rls.test.sql` — ownership, read visibility, soft-delete, like/save/comment security tests.
- Create `supabase/tests/feed_poll_rls.test.sql` — poll voting and media/poll ownership tests.
- Regenerate `src/lib/supabase/database.types.ts` after migrations.

### Feed domain
- Create `src/features/feed/types.ts` — category constants, domain models, cursor/page types.
- Create `src/features/feed/schemas.ts` — composer, comment, cursor, vote validation.
- Create `src/features/feed/schemas.test.ts` — validation tests.
- Create `src/features/feed/mappers.ts` — database row-to-domain mapping and signed-media attachment.
- Create `src/features/feed/mappers.test.ts` — mapper tests.
- Create `src/features/feed/queries.ts` — first page, later page, and single-post reads.
- Create `src/features/feed/queries.test.ts` — cursor/filter construction and query orchestration tests.
- Create `src/features/feed/actions.ts` — create post, load more, like, save, comment, poll vote server actions.
- Create `src/features/feed/actions.test.ts` — action validation/error-path tests.

### Feed UI
- Create `src/features/feed/components/feed-layout.tsx` — responsive three-column shell.
- Create `src/features/feed/components/feed-profile-card.tsx` — compact signed-in profile rail.
- Create `src/features/feed/components/feed-profile-card.test.tsx`.
- Create `src/features/feed/profile-completion.ts` — pure completion calculation.
- Create `src/features/feed/profile-completion.test.ts`.
- Create `src/features/feed/components/post-composer.tsx` — text/image/poll composer.
- Create `src/features/feed/components/post-composer.test.tsx`.
- Create `src/features/feed/components/feed-category-filter.tsx` — horizontal category navigation.
- Create `src/features/feed/components/feed-list.tsx` — client-held feed pages and Load More.
- Create `src/features/feed/components/post-card.tsx` — post article, counts, actions, media, poll.
- Create `src/features/feed/components/post-card.test.tsx`.
- Create `src/features/feed/components/comment-thread.tsx` — initial comments and add-comment form.
- Create `src/features/feed/components/poll-card.tsx` — poll options/results/vote state.
- Create `src/features/feed/components/feed-discovery-rail.tsx` — real category links and navigation-only discovery cards.
- Create `src/features/feed/components/share-post-button.tsx` — native share or clipboard copy; no stored share count.

### Routes/config
- Replace `src/app/(app)/home/page.tsx` with the feed composition route.
- Create `src/app/(app)/posts/[id]/page.tsx` — authenticated shareable post detail.
- Modify `next.config.ts` to allow signed Supabase image URLs through `next/image`.
- Add `tests/e2e/home-feed.spec.ts` — unauthenticated redirect plus authenticated feed smoke path when credentials are supplied.

---

### Task 1: Create the secure core feed schema

**Files:**
- Create: `supabase/migrations/20260902102000_create_feed_core.sql`
- Test later in Task 3: `supabase/tests/feed_rls.test.sql`

**Interfaces:**
- Produces enums `public.post_category`, `public.post_type`, `public.post_reaction_type`.
- Produces tables `public.posts`, `public.post_reactions`, `public.post_comments`, `public.saved_posts`.
- Later application code writes `author_id = auth.uid()` and never accepts an arbitrary author from form input.

- [ ] **Step 1: Write the migration with enums and tables**

Use these enum values and constraints:

```sql
create type public.post_category as enum (
  'maritime_news',
  'technical_discussion',
  'vetting_sire_2_0',
  'career_advice',
  'safety_lessons',
  'achievement',
  'learning',
  'industry_opinion'
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
  constraint posts_body_check check (
    body = btrim(body)
    and char_length(body) between 1 and 5000
  )
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
  constraint post_comments_body_check check (
    body = btrim(body)
    and char_length(body) between 1 and 2000
  )
);

create table public.saved_posts (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
```

- [ ] **Step 2: Add indexes and database-managed timestamps**

```sql
create index posts_feed_idx
on public.posts (created_at desc, id desc)
where deleted_at is null;

create index posts_category_feed_idx
on public.posts (category, created_at desc, id desc)
where deleted_at is null;

create index post_comments_post_idx
on public.post_comments (post_id, created_at asc)
where deleted_at is null;

create index post_reactions_post_idx on public.post_reactions (post_id);
create index saved_posts_user_idx on public.saved_posts (user_id, created_at desc);

create or replace function private.set_feed_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.set_feed_updated_at() from public, anon, authenticated, service_role;

create trigger posts_set_updated_at
before update on public.posts
for each row execute procedure private.set_feed_updated_at();

create trigger post_comments_set_updated_at
before update on public.post_comments
for each row execute procedure private.set_feed_updated_at();
```

- [ ] **Step 3: Enable RLS and explicit grants**

Enable RLS on all four tables. Revoke all first, then grant only required table operations. Do not grant update of `author_id`, `post_id`, `user_id`, `created_at`, or `post_type` to authenticated members.

```sql
alter table public.posts enable row level security;
alter table public.post_reactions enable row level security;
alter table public.post_comments enable row level security;
alter table public.saved_posts enable row level security;

revoke all on public.posts, public.post_reactions, public.post_comments, public.saved_posts
from anon, authenticated;

grant select, insert on public.posts to authenticated;
grant update (body, category, deleted_at) on public.posts to authenticated;

grant select, insert, delete on public.post_reactions to authenticated;
grant select, insert on public.post_comments to authenticated;
grant update (body, deleted_at) on public.post_comments to authenticated;
grant select, insert, delete on public.saved_posts to authenticated;
```

- [ ] **Step 4: Add RLS policies using active completed membership checks**

Use the same membership condition everywhere:

```sql
exists (
  select 1
  from public.profiles viewer
  where viewer.id = (select auth.uid())
    and viewer.account_status = 'active'
    and viewer.onboarding_completed_at is not null
)
```

Policies must enforce:

```sql
create policy "active members read posts"
on public.posts for select to authenticated
using (
  deleted_at is null
  and exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid())
      and viewer.account_status = 'active'
      and viewer.onboarding_completed_at is not null
  )
);

create policy "members create own posts"
on public.posts for insert to authenticated
with check (
  author_id = (select auth.uid())
  and deleted_at is null
  and exists (
    select 1 from public.profiles viewer
    where viewer.id = (select auth.uid())
      and viewer.account_status = 'active'
      and viewer.onboarding_completed_at is not null
  )
);

create policy "authors update own posts"
on public.posts for update to authenticated
using (author_id = (select auth.uid()))
with check (author_id = (select auth.uid()));
```

Apply equivalent ownership/member policies to comments and reactions. `saved_posts` is private: members may select only rows whose `user_id = auth.uid()`.

- [ ] **Step 5: Validate migration syntax locally**

Run:

```bash
npx supabase db reset
```

Expected: all existing migrations plus `20260902102000_create_feed_core.sql` apply without SQL errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260902102000_create_feed_core.sql
git commit -m "feat: add secure feed core schema"
```

---

### Task 2: Add private image media and technical polls

**Files:**
- Create: `supabase/migrations/20260902102100_add_feed_media_and_polls.sql`
- Test later in Task 3: `supabase/tests/feed_poll_rls.test.sql`

**Interfaces:**
- Produces tables `post_media`, `post_polls`, `post_poll_options`, `post_poll_votes`.
- Produces private Storage bucket `post-media`.
- Produces RPC `public.create_poll_post(p_category public.post_category, p_body text, p_options text[]) returns uuid`.

- [ ] **Step 1: Add one-image-per-post media metadata**

```sql
create table public.post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null unique references public.posts(id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null,
  alt_text text,
  created_at timestamptz not null default now(),
  constraint post_media_mime_check check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint post_media_alt_check check (alt_text is null or char_length(alt_text) <= 300)
);
```

- [ ] **Step 2: Add single-choice poll tables**

```sql
create table public.post_polls (
  post_id uuid primary key references public.posts(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.post_poll_options (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.post_polls(post_id) on delete cascade,
  label text not null,
  position smallint not null,
  constraint post_poll_options_label_check check (
    label = btrim(label) and char_length(label) between 1 and 120
  ),
  constraint post_poll_options_position_check check (position between 0 and 5),
  unique (post_id, position),
  unique (post_id, id)
);

create table public.post_poll_votes (
  post_id uuid not null,
  option_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id),
  foreign key (post_id, option_id)
    references public.post_poll_options(post_id, id)
    on delete cascade
);
```

- [ ] **Step 3: Add RLS and minimum grants for media and polls**

Authenticated active completed members can read media/polls/options/votes. Only the post author can create/remove media and poll definitions. A member can insert/update/delete only their own `post_poll_votes` row. Use explicit column grants; do not grant anonymous access.

- [ ] **Step 4: Create the private Storage bucket and policies**

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'post-media',
  'post-media',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
```

Storage object names must start with the uploader UUID. Upload/delete policies must require:

```sql
bucket_id = 'post-media'
and (storage.foldername(name))[1] = (select auth.uid())::text
```

Read policy must require an authenticated active completed profile. The bucket remains private so feed queries must issue signed URLs.

- [ ] **Step 5: Add an atomic poll-post RPC**

Create a `SECURITY INVOKER` function so post + poll + options commit or roll back together:

```sql
create or replace function public.create_poll_post(
  p_category public.post_category,
  p_body text,
  p_options text[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
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
    select distinct on (lower(btrim(value)))
      btrim(value) as option_text,
      position as first_position
    from unnest(coalesce(p_options, '{}'::text[])) with ordinality as entry(value, position)
    where char_length(btrim(value)) between 1 and 120
    order by lower(btrim(value)), position
  ) normalized;

  if coalesce(cardinality(v_options), 0) not between 2 and 6 then
    raise exception using errcode = '22023', message = 'polls require 2 to 6 distinct options';
  end if;

  insert into public.posts (id, author_id, category, body, post_type)
  values (v_post_id, v_user_id, p_category, btrim(p_body), 'poll');

  insert into public.post_polls (post_id) values (v_post_id);

  insert into public.post_poll_options (post_id, label, position)
  select v_post_id, value, (ordinality - 1)::smallint
  from unnest(v_options) with ordinality;

  return v_post_id;
end;
$$;

revoke all on function public.create_poll_post(public.post_category, text, text[])
from public, anon, authenticated, service_role;
grant execute on function public.create_poll_post(public.post_category, text, text[])
to authenticated;
```

RLS remains the authorization layer because the RPC is `SECURITY INVOKER`.

- [ ] **Step 6: Validate both migrations**

Run:

```bash
npx supabase db reset
```

Expected: reset succeeds and `storage.buckets` contains `post-media` with `public = false`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260902102100_add_feed_media_and_polls.sql
git commit -m "feat: add feed media and polls"
```

---

### Task 3: Prove feed RLS and regenerate Supabase types

**Files:**
- Create: `supabase/tests/feed_rls.test.sql`
- Create: `supabase/tests/feed_poll_rls.test.sql`
- Modify: `src/lib/supabase/database.types.ts`

**Interfaces:**
- Produces generated TypeScript table/enums/function definitions used by all following tasks.
- Tests prove member A cannot mutate member B's social data.

- [ ] **Step 1: Write the core RLS pgTAP test**

Use fixed UUIDs and create two confirmed auth users under the initial privileged role. Complete both profiles directly for test setup. Then switch to `authenticated` and set the request claims.

Core assertions must include these concrete cases:

```sql
select lives_ok(
  $$ insert into public.posts (id, author_id, category, body)
     values ('aaaaaaaa-0000-0000-0000-000000000001',
             '11111111-1111-1111-1111-111111111111',
             'technical_discussion',
             'A real technical lesson from member A.') $$,
  'member A can create own post'
);

select is(
  (select count(*) from public.posts
   where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1::bigint,
  'active completed member can read feed post'
);
```

Switch JWT subject to member B and assert an attempted update of member A's post changes zero rows; member B can like/comment/save that readable post but can select only their own save. Suspend member B and assert feed reads return zero rows for B.

- [ ] **Step 2: Write poll/media RLS tests**

Assert:
- member A can execute `create_poll_post` with 2–6 distinct options;
- 1 option and 7 options are rejected;
- member B can vote once and update their own choice;
- member B cannot alter member A's poll options;
- media metadata can be inserted only for a post authored by the current member;
- a media row cannot be attached twice to the same post.

- [ ] **Step 3: Run database tests**

Run:

```bash
npm run test:db
```

Expected: all feed pgTAP assertions pass.

- [ ] **Step 4: Regenerate project types**

Run:

```bash
npx supabase gen types typescript --project-id rrxyiwajrzcepyvscidh > src/lib/supabase/database.types.ts
```

Then verify the generated file includes:
- `posts`
- `post_reactions`
- `post_comments`
- `saved_posts`
- `post_media`
- `post_polls`
- `post_poll_options`
- `post_poll_votes`
- `post_category`
- `post_type`
- `create_poll_post`

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/tests src/lib/supabase/database.types.ts
git commit -m "test: cover feed security rules"
```

---

### Task 4: Define the feed domain and validation rules

**Files:**
- Create: `src/features/feed/types.ts`
- Create: `src/features/feed/schemas.ts`
- Create: `src/features/feed/schemas.test.ts`
- Create: `src/features/feed/mappers.ts`
- Create: `src/features/feed/mappers.test.ts`

**Interfaces:**
- Produces `POST_CATEGORIES`, `POST_CATEGORY_LABELS`, `FeedPost`, `FeedPage`, `FeedCursor`, `FeedComment`, `FeedPoll`.
- Produces `createPostInputSchema`, `commentInputSchema`, `feedRequestSchema`, `pollVoteSchema`.

- [ ] **Step 1: Write failing schema tests**

```ts
import { describe, expect, it } from 'vitest'
import { createPostInputSchema } from './schemas'

describe('createPostInputSchema', () => {
  it('normalizes a standard maritime post', () => {
    const parsed = createPostInputSchema.parse({
      category: 'technical_discussion',
      body: '  Main engine troubleshooting lesson.  ',
      mode: 'standard',
      pollOptions: [],
    })
    expect(parsed.body).toBe('Main engine troubleshooting lesson.')
  })

  it('rejects a poll with fewer than two distinct options', () => {
    expect(() => createPostInputSchema.parse({
      category: 'career_advice',
      body: 'Which shore role would you choose?',
      mode: 'poll',
      pollOptions: ['Marine Superintendent', 'Marine Superintendent'],
    })).toThrow()
  })
})
```

- [ ] **Step 2: Run tests and verify failure**

```bash
npm test -- src/features/feed/schemas.test.ts
```

Expected: FAIL because feed schemas do not exist.

- [ ] **Step 3: Implement canonical types and labels**

Use these exact values:

```ts
export const POST_CATEGORIES = [
  'maritime_news',
  'technical_discussion',
  'vetting_sire_2_0',
  'career_advice',
  'safety_lessons',
  'achievement',
  'learning',
  'industry_opinion',
] as const

export type PostCategory = (typeof POST_CATEGORIES)[number]

export const POST_CATEGORY_LABELS: Record<PostCategory, string> = {
  maritime_news: 'Maritime News',
  technical_discussion: 'Technical Discussion',
  vetting_sire_2_0: 'Vetting & SIRE 2.0',
  career_advice: 'Career Advice',
  safety_lessons: 'Safety Lessons',
  achievement: 'Achievement',
  learning: 'Learning',
  industry_opinion: 'Industry Opinion',
}
```

Define `FeedCursor` as `{ createdAt: string; id: string }`. Define `FeedPage` as `{ posts: FeedPost[]; nextCursor: FeedCursor | null }`.

- [ ] **Step 4: Implement validation**

`body`: trimmed, 1–5000 characters. `comment`: trimmed, 1–2000. Poll: exactly 2–6 normalized distinct option strings, each max 120. Feed limit: integer 1–20, default 12. Cursor ID: UUID; cursor date: ISO datetime.

- [ ] **Step 5: Add mapper tests and mapper implementation**

Test that:
- missing maritime profile maps rank/company to null;
- nested reaction/comment count arrays map to numbers;
- viewer like/save/vote sets map to booleans/selected option;
- image metadata maps to a signed URL supplied by the query layer;
- poll options preserve `position` order.

- [ ] **Step 6: Run tests**

```bash
npm test -- src/features/feed/schemas.test.ts src/features/feed/mappers.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/feed/types.ts src/features/feed/schemas.ts src/features/feed/schemas.test.ts src/features/feed/mappers.ts src/features/feed/mappers.test.ts
git commit -m "feat: define feed domain model"
```

---

### Task 5: Implement deterministic feed queries

**Files:**
- Create: `src/features/feed/queries.ts`
- Create: `src/features/feed/queries.test.ts`

**Interfaces:**
- Produces `getFeedPage(input?: FeedRequest): Promise<FeedPage>`.
- Produces `getPostById(id: string): Promise<FeedPost | null>`.
- Produces pure `buildFeedCursorFilter(cursor: FeedCursor): string` for testability.

- [ ] **Step 1: Write failing cursor/filter tests**

```ts
it('builds a strict created-at/id tie-break cursor', () => {
  expect(buildFeedCursorFilter({
    createdAt: '2026-09-02T10:00:00.000Z',
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  })).toBe(
    'created_at.lt.2026-09-02T10:00:00.000Z,and(created_at.eq.2026-09-02T10:00:00.000Z,id.lt.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa)',
  )
})
```

- [ ] **Step 2: Run query tests and verify failure**

```bash
npm test -- src/features/feed/queries.test.ts
```

Expected: FAIL because query module does not exist.

- [ ] **Step 3: Implement the server query**

Use `requireUser()` and `createServerSupabaseClient()`. Select 13 rows for a 12-row page so `nextCursor` is known without a separate count. Order exactly:

```ts
.order('created_at', { ascending: false })
.order('id', { ascending: false })
.limit(limit + 1)
```

When a cursor exists:

```ts
query = query.or(buildFeedCursorFilter(cursor))
```

When a category exists:

```ts
query = query.eq('category', category)
```

The select must include author identity, `maritime_profiles`, one `post_media` row, poll/options with vote counts, reaction count, and comment count. Fetch viewer-specific likes, saves, and poll votes in separate batched queries for the returned post IDs.

- [ ] **Step 4: Resolve private image URLs in one batch**

Collect all non-null `storage_path` values and call:

```ts
supabase.storage.from('post-media').createSignedUrls(paths, 3600)
```

Map each returned signed URL back to the post. If signing one file fails, render that post without the image rather than failing the full feed.

- [ ] **Step 5: Implement `getPostById`**

Use the same row selection/mapping pipeline and RLS. Return `null` for missing/inaccessible/deleted posts. This powers `/posts/[id]` and share links.

- [ ] **Step 6: Run tests and typecheck**

```bash
npm test -- src/features/feed/queries.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/feed/queries.ts src/features/feed/queries.test.ts
git commit -m "feat: add paginated feed queries"
```

---

### Task 6: Implement server actions for social mutations

**Files:**
- Create: `src/features/feed/actions.ts`
- Create: `src/features/feed/actions.test.ts`

**Interfaces:**
- Produces `createPost(previousState, formData)`.
- Produces `loadFeedPage(input)`.
- Produces `setPostLiked(postId, liked)`.
- Produces `setPostSaved(postId, saved)`.
- Produces `addComment(previousState, formData)`.
- Produces `setPollVote(postId, optionId)`.
- Every action returns a serializable controlled result; database errors never leak raw SQL messages.

- [ ] **Step 1: Write failing action validation tests**

Mock `requireUser` and `createServerSupabaseClient`. Test that an invalid body never calls Supabase and returns field errors. Test that `setPostLiked(id, false)` deletes only the current user's row by matching both `post_id` and `user_id`.

- [ ] **Step 2: Run tests and verify failure**

```bash
npm test -- src/features/feed/actions.test.ts
```

Expected: FAIL because actions do not exist.

- [ ] **Step 3: Implement text post creation**

Generate `postId = crypto.randomUUID()` in the server action. Never accept `author_id` from FormData.

```ts
const { error } = await supabase.from('posts').insert({
  id: postId,
  author_id: user.id,
  category: data.category,
  body: data.body,
  post_type: 'standard',
})
```

On success call `revalidatePath('/home')` and return `{ ok: true, postId }`.

- [ ] **Step 4: Implement load-more, like, save, and comment actions**

`loadFeedPage` delegates to `getFeedPage` after Zod validation. Like uses `upsert({ post_id, user_id, reaction_type: 'like' })` when true and deletes the matching row when false. Save follows the same pattern. Comment inserts `{ post_id, author_id: user.id, body }`.

- [ ] **Step 5: Implement poll voting**

Use an upsert on primary key `(post_id, user_id)`:

```ts
await supabase.from('post_poll_votes').upsert({
  post_id: postId,
  option_id: optionId,
  user_id: user.id,
})
```

RLS and the composite foreign key ensure the option belongs to the target poll.

- [ ] **Step 6: Run tests and typecheck**

```bash
npm test -- src/features/feed/actions.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/feed/actions.ts src/features/feed/actions.test.ts
git commit -m "feat: add feed mutation actions"
```

---

### Task 7: Build the real profile rail and three-column home shell

**Files:**
- Create: `src/features/feed/profile-completion.ts`
- Create: `src/features/feed/profile-completion.test.ts`
- Create: `src/features/feed/components/feed-profile-card.tsx`
- Create: `src/features/feed/components/feed-profile-card.test.tsx`
- Create: `src/features/feed/components/feed-layout.tsx`
- Create: `src/features/feed/components/feed-discovery-rail.tsx`
- Modify: `src/app/(app)/home/page.tsx`

**Interfaces:**
- `calculateProfileCompletion(profile: OwnProfile): number` returns an integer 0–100.
- `FeedLayout` receives `profile`, `initialPage`, and `category`.

- [ ] **Step 1: Write completion tests**

For a maritime member, count these real fields: full name, headline, summary, location, at least one skill, rank, current company, sailing experience. A fully populated set returns 100; missing four of eight returns 50. For non-maritime profile types use only the first five generic fields.

- [ ] **Step 2: Implement the completion function**

Use booleans from actual fields only; do not infer credentials or verification.

- [ ] **Step 3: Write the profile-card rendering test**

Assert that a seafarer card renders full name, headline, rank, company, `12 years`, availability, completion percentage, and `View profile`; assert it does not render `Verified`, `Reputation`, or a made-up connection count.

- [ ] **Step 4: Implement the feed profile card using existing design tokens**

Use `Card`, the same gradient family already used by `ProfileHeader`, initials fallback, and existing colors. Desktop card is sticky through the parent rail; mobile shows a shorter summary. Use `/profile` for the primary action.

- [ ] **Step 5: Implement the discovery rail without fake listings**

Show:
- `Maritime topics` linking to feed category URLs;
- navigation cards to `/network`, `/events`, and `/jobs` with copy such as `Explore the professional network`, `Browse maritime events`, and `See maritime opportunities`.

Do not render named people, event dates, job counts, or vacancy cards until those modules have real data.

- [ ] **Step 6: Replace `/home` composition**

Use:

```ts
const profile = await getOwnProfile()
if (!profile) redirect('/onboarding')
const category = parseFeedCategory((await searchParams).category)
const initialPage = await getFeedPage({ category })
```

Render a grid equivalent to:

```text
lg:  280px | minmax(0, 1fr)
xl:  280px | minmax(0, 1fr) | 300px
```

The center column remains visually dominant. The right rail disappears before the left rail as viewport width narrows.

- [ ] **Step 7: Run component tests and typecheck**

```bash
npm test -- src/features/feed/profile-completion.test.ts src/features/feed/components/feed-profile-card.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/features/feed/profile-completion.ts src/features/feed/profile-completion.test.ts src/features/feed/components/feed-profile-card.tsx src/features/feed/components/feed-profile-card.test.tsx src/features/feed/components/feed-layout.tsx src/features/feed/components/feed-discovery-rail.tsx 'src/app/(app)/home/page.tsx'
git commit -m "feat: turn home into feed layout"
```

---

### Task 8: Build composer, category filters, feed cards, likes, saves, comments, and Load More

**Files:**
- Create: `src/features/feed/components/post-composer.tsx`
- Create: `src/features/feed/components/post-composer.test.tsx`
- Create: `src/features/feed/components/feed-category-filter.tsx`
- Create: `src/features/feed/components/feed-list.tsx`
- Create: `src/features/feed/components/post-card.tsx`
- Create: `src/features/feed/components/post-card.test.tsx`
- Create: `src/features/feed/components/comment-thread.tsx`

**Interfaces:**
- `PostComposer` calls `createPost` via `useActionState`.
- `FeedList` owns appended pages and calls `loadFeedPage` using `nextCursor`.
- `PostCard` calls `setPostLiked`, `setPostSaved`, and renders `CommentThread`.

- [ ] **Step 1: Write composer tests**

Test placeholder copy exactly:

```text
Share a maritime update, technical lesson, or industry insight...
```

Assert category selection exists, `Post` is disabled while submitting, invalid state preserves body/category, and no `Ask Co-Pilot` control exists.

- [ ] **Step 2: Write post-card tests**

Render a `FeedPost` fixture and assert:
- semantic `<article>` exists;
- author links to `/people/<slug>`;
- category label renders;
- `<time dateTime>` has the full timestamp;
- Like, Comment, Share, Save controls exist;
- no verification badge appears without a verification field;
- real counts render from the fixture.

- [ ] **Step 3: Implement the category filter**

Render `All` plus all eight canonical categories as links. `All` points to `/home`; each category points to `/home?category=<enum-value>`. On mobile, use horizontal overflow rather than wrapping into multiple dense rows.

- [ ] **Step 4: Implement composer and text-post success behavior**

Use existing card/button visual language. After `{ ok: true }`, clear the form and call `router.refresh()` so the server-rendered first page contains the new post.

- [ ] **Step 5: Implement post cards and interaction state**

Use `useTransition` for Like/Save. Update local state immediately, then revert if the server action returns `{ ok: false }`. Use plain `Like`, `Comment`, `Share`, `Save`; do not introduce maritime-specific reaction types in this release.

- [ ] **Step 6: Implement comments**

Initially show the mapped first comments returned by the query, followed by a compact add-comment form. On successful comment, refresh the route. Do not fabricate hidden comments or placeholder comments to inflate engagement.

- [ ] **Step 7: Implement stable Load More**

`FeedList` starts with `initialPage.posts`. Load More sends the current category and `nextCursor`; append only IDs not already in the list. Replace the cursor with the returned `nextCursor`. Hide the control at `null`.

- [ ] **Step 8: Implement the legitimate empty state**

When `posts.length === 0`, render actions to publish the first update, explore `/network`, and visit `/community`. Do not seed fake member posts.

- [ ] **Step 9: Run UI tests and typecheck**

```bash
npm test -- src/features/feed/components/post-composer.test.tsx src/features/feed/components/post-card.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/features/feed/components/post-composer.tsx src/features/feed/components/post-composer.test.tsx src/features/feed/components/feed-category-filter.tsx src/features/feed/components/feed-list.tsx src/features/feed/components/post-card.tsx src/features/feed/components/post-card.test.tsx src/features/feed/components/comment-thread.tsx
git commit -m "feat: add interactive maritime feed"
```

---

### Task 9: Add secure image/diagram upload and rendering

**Files:**
- Modify: `src/features/feed/actions.ts`
- Modify: `src/features/feed/actions.test.ts`
- Modify: `src/features/feed/components/post-composer.tsx`
- Modify: `src/features/feed/components/post-card.tsx`
- Modify: `next.config.ts`

**Interfaces:**
- Composer sends optional FormData key `media` and optional `altText`.
- Standard post supports zero or one image; poll posts do not accept an image in this release.

- [ ] **Step 1: Write failing media validation tests**

Test rejection of:
- file > 5 MiB;
- `image/gif`;
- an image submitted with `mode = 'poll'`;
- alt text > 300 characters.

Test acceptance of JPEG, PNG, and WebP.

- [ ] **Step 2: Implement server-side media validation**

Never trust the filename extension. Map MIME types explicitly:

```ts
const extensionByMime = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const
```

Reject any other `File.type`, and reject `file.size > 5 * 1024 * 1024`.

- [ ] **Step 3: Upload before inserting the visible post and clean up failures**

Generate the post ID and storage path:

```ts
const path = `${user.id}/${postId}/${crypto.randomUUID()}.${extension}`
```

Upload to `post-media`. Insert the post only after upload succeeds. Insert `post_media` after the post. If the post or media-row insert fails, remove the uploaded storage object. If the media-row insert fails after post insert, soft-delete/remove the newly created post as part of cleanup so no broken visible feed item remains.

- [ ] **Step 4: Update the composer UI**

Add `Photo/Diagram`, one file input with `accept="image/jpeg,image/png,image/webp"`, filename preview, remove control, and optional alt-text input. Keep the visual language consistent with existing cards and buttons.

- [ ] **Step 5: Configure Next Image**

Add Supabase to `images.remotePatterns` in `next.config.ts` using HTTPS and the `**.supabase.co` hostname pattern. Render the signed feed URL with `next/image`; use a responsive aspect container, rounded corners consistent with the post card, and `unoptimized` only if required for signed-query URLs.

- [ ] **Step 6: Run tests, lint, typecheck**

```bash
npm test -- src/features/feed/actions.test.ts src/features/feed/components/post-composer.test.tsx src/features/feed/components/post-card.test.tsx
npm run lint
npm run typecheck
```

Expected: PASS with zero lint warnings.

- [ ] **Step 7: Commit**

```bash
git add src/features/feed/actions.ts src/features/feed/actions.test.ts src/features/feed/components/post-composer.tsx src/features/feed/components/post-card.tsx next.config.ts
git commit -m "feat: add private feed images"
```

---

### Task 10: Add technical poll composition and voting UI

**Files:**
- Modify: `src/features/feed/components/post-composer.tsx`
- Modify: `src/features/feed/components/post-composer.test.tsx`
- Create: `src/features/feed/components/poll-card.tsx`
- Modify: `src/features/feed/components/post-card.tsx`
- Modify: `src/features/feed/actions.ts`

**Interfaces:**
- Composer sends `mode = 'poll'` and repeated `pollOption` values.
- `createPost` calls `supabase.rpc('create_poll_post', ...)` for poll mode.
- `PollCard` receives mapped option counts and `viewerOptionId`.

- [ ] **Step 1: Add composer poll tests**

Assert `Technical Poll` reveals two option inputs, `Add option` stops at six, removing options stops at two, duplicate/blank options surface validation, and selecting poll mode hides/disables media upload.

- [ ] **Step 2: Implement poll composer state**

Start with two empty inputs. Use stable local IDs for React keys. Add/remove controls never allow fewer than two or more than six option fields.

- [ ] **Step 3: Route poll submission through the atomic RPC**

```ts
const { data: postId, error } = await supabase.rpc('create_poll_post', {
  p_category: data.category,
  p_body: data.body,
  p_options: data.pollOptions,
})
```

Return the same controlled success/error state as standard posts.

- [ ] **Step 4: Build accessible poll rendering**

Use a fieldset/radio-group pattern. Before voting, show labels and a Vote action. After voting, show each option's count and percentage computed from real totals. Keep the selected option visible. A member can change their vote; `setPollVote` upserts their row.

- [ ] **Step 5: Run tests**

```bash
npm test -- src/features/feed/components/post-composer.test.tsx src/features/feed/components/post-card.test.tsx src/features/feed/actions.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/feed/components/post-composer.tsx src/features/feed/components/post-composer.test.tsx src/features/feed/components/poll-card.tsx src/features/feed/components/post-card.tsx src/features/feed/actions.ts
git commit -m "feat: add technical feed polls"
```

---

### Task 11: Add authenticated post detail and share/copy-link behavior

**Files:**
- Create: `src/app/(app)/posts/[id]/page.tsx`
- Create: `src/features/feed/components/share-post-button.tsx`
- Modify: `src/features/feed/components/post-card.tsx`

**Interfaces:**
- Shared URLs use `/posts/<uuid>`.
- No database share/repost count is created in this milestone.

- [ ] **Step 1: Implement post detail route**

Next.js 16 params are awaited:

```ts
export default async function PostPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const post = await getPostById(id)
  if (!post) notFound()
  return <div className="mx-auto max-w-3xl"><PostCard post={post} detail /></div>
}
```

The authenticated app layout already protects the route.

- [ ] **Step 2: Implement share fallback**

In the client button construct:

```ts
const url = new URL(`/posts/${postId}`, window.location.origin).toString()
```

If `navigator.share` exists, call it with Sea N Shore title/text/url. Otherwise `await navigator.clipboard.writeText(url)`. Announce `Link copied` through an `aria-live="polite"` region.

- [ ] **Step 3: Keep share metrics absent**

Do not increment a counter and do not label a copy-link count as shares. The post footer continues to display only real like/comment counts.

- [ ] **Step 4: Run lint and typecheck**

```bash
npm run lint
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/(app)/posts/[id]/page.tsx' src/features/feed/components/share-post-button.tsx src/features/feed/components/post-card.tsx
git commit -m "feat: add feed post sharing"
```

---

### Task 12: Responsive, accessibility, end-to-end, and release verification

**Files:**
- Modify feed components as required by test findings.
- Create: `tests/e2e/home-feed.spec.ts`

**Interfaces:**
- Release is complete only after repository checks, production migrations, Supabase advisor review, and Vercel deployment verification.

- [ ] **Step 1: Add accessibility semantics to every feed surface**

Verify:
- every post is an `<article>` with an author/body label relationship;
- icon-only controls have `aria-label`;
- interactive targets are at least 44px high/wide where practical;
- relative timestamps use `<time dateTime="...">`;
- category filter has a navigation label;
- image alt text uses stored `alt_text`, falling back to `Image attached to <author>'s post`;
- poll options are keyboard operable;
- optimistic errors are announced with `role="alert"` or `aria-live`;
- focus rings continue to use the global Sea N Shore focus styling.

- [ ] **Step 2: Verify responsive layout manually at defined breakpoints**

Check:
- 390px: one center column, existing bottom navigation, compact profile summary, horizontal category scroll;
- 768px: center-first layout with no right rail;
- 1024px: left rail + feed;
- 1280px and above: left rail + feed + discovery rail.

No component may horizontally overflow the page except the intentionally scrollable category row.

- [ ] **Step 3: Add Playwright smoke tests**

At minimum:

```ts
import { expect, test } from '@playwright/test'

test('signed-out visitor is redirected from home', async ({ page }) => {
  await page.goto('/home')
  await expect(page).toHaveURL(/\/auth\/sign-in/)
})
```

Add an authenticated test gated by `E2E_USER_EMAIL` and `E2E_USER_PASSWORD`. It signs in through the real UI, expects the feed composer placeholder, expects the current profile card, and checks there is no text matching `/Verified CoC|Reputation 6,200/i`. Do not commit credentials.

- [ ] **Step 4: Run the full repository verification**

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:db
```

Expected: every available command passes. If local Supabase/Docker prevents `test:db`, do not claim it passed; use the production migration checks below and record the local limitation.

- [ ] **Step 5: Apply migrations to the connected Sea N Shore Supabase project**

Target project ref: `rrxyiwajrzcepyvscidh`.

Apply exactly the two versioned migration SQL files with Supabase migration tooling/connector, in order:
1. `20260902102000_create_feed_core`
2. `20260902102100_add_feed_media_and_polls`

Then query migration history and table metadata to verify both are present and RLS is enabled on every new social table.

- [ ] **Step 6: Run Supabase security and performance advisors**

Review new findings. New feed tables must not produce `RLS Enabled No Policy`. Any `SECURITY DEFINER` warning introduced by this feed work is a release blocker because the new poll RPC is intentionally `SECURITY INVOKER`.

Existing unrelated warnings must be documented separately rather than silently attributed to the feed.

- [ ] **Step 7: Merge/push the verified implementation to `main`**

Use a feature branch during implementation. After review and verification, merge without force-pushing over concurrent changes. Vercel is linked to `adityaps70/SEA-N-SHORE-CODEX` and production branch `main`, so the merge should trigger deployment.

- [ ] **Step 8: Verify the Vercel production deployment**

Confirm:
- deployment state is Ready;
- deployed Git SHA matches the merged feed commit;
- build contains no environment-validation error;
- server logs show no repeated 4xx/5xx feed RPC/table errors;
- authenticated `/home` renders the composer and feed through a real member account.

- [ ] **Step 9: Commit final test/polish changes before merge if any**

```bash
git add tests/e2e/home-feed.spec.ts src/features/feed src/app next.config.ts
git commit -m "test: verify home feed release"
```

Use only if this task produced changes not already committed; do not create an empty commit.

---

## Plan Self-Review

### Spec coverage
- Three-column desktop layout: Task 7.
- Signed-in real profile rail: Task 7.
- Mobile/tablet behavior: Task 12.
- Composer: Tasks 8–10.
- Eight maritime categories: Tasks 4 and 8.
- Text posts: Tasks 6 and 8.
- One private image/diagram: Tasks 2 and 9.
- Technical polls: Tasks 2 and 10.
- Like: Tasks 1, 6, 8.
- Comments: Tasks 1, 6, 8.
- Save: Tasks 1, 6, 8.
- Share/copy-link without fake count: Task 11.
- Deterministic Load More: Tasks 5 and 8.
- No fake content/verification: Global Constraints, Tasks 7, 8, 12.
- RLS and ownership protection: Tasks 1–3.
- Existing Sea N Shore visual system: Global Constraints, Tasks 7–12.
- Accessibility: Tasks 8, 10, 11, 12.
- Production Supabase + Vercel verification: Task 12.

### Placeholder scan
The plan contains no implementation placeholders such as TBD/TODO, no unspecified `add validation` steps, and no references to undefined neighboring interfaces.

### Type/signature consistency
- `FeedCursor` is `{ createdAt: string; id: string }` throughout.
- `getFeedPage` returns `FeedPage` throughout.
- `createPollPost` database function is consistently named `create_poll_post` and receives category/body/options.
- Like/Save mutations consistently use desired boolean state rather than ambiguous toggle semantics.
- Poll votes consistently use one row per `(post_id, user_id)`.
