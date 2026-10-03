# My Activities + Job Applications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a signed-in My Activities workspace with My Posts, My Comments and job-application status, while turning Jobs into a minimally functional apply workflow.

**Architecture:** Extend the existing AWS-native Aurora feed repository for activity reads, add an additive jobs/applications schema plus a small jobs domain, and compose a new server-rendered `/activities` route using existing `PostCard` behavior. Keep the candidate workflow narrow: published job discovery, job detail, apply once, status visibility. Apply the schema through the same guarded GitHub Actions + SSM pattern already used for Aurora migrations.

**Tech Stack:** Next.js 16.3.4, React 19.2.8, TypeScript 5, PostgreSQL/Aurora, `pg`, Zod 4, Vitest 4, Testing Library, Lucide React, GitHub Actions, AWS SSM/RDS Data API/ECS.

**Spec:** `docs/superpowers/specs/2026-09-09-my-activities-jobs.md`

## Global Constraints

- Work only on `feat/aws-native-phase-0-1`; do not merge or create a PR.
- My Activities has exactly two post tabs: `My Posts` and `My Comments`.
- `Jobs Applied` is a separate section, not a third tab.
- My Comments shows each commented post once and surfaces the signed-in member's own comment(s) above the post.
- Jobs support published listing, detail and one-time apply only; no recruiter/admin UI.
- Application statuses are exactly: `applied`, `under_review`, `shortlisted`, `interview`, `selected`, `rejected`, `withdrawn`.
- Database migration is additive only.
- Use test-first commits and verify a real RED state before production implementation.
- Guarded migration and staging deploy action files must finish as `plan`.

---

### Task 1: Establish RED integration contracts

**Files:**
- Create: `src/my-activities-jobs-contract.test.tsx`
- Modify: none

**Interfaces:**
- Consumes: current `AppHeader`, current `/jobs` source, repository source and filesystem.
- Produces: failing integration contract proving the feature is absent before implementation.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AppHeader } from '@/components/navigation/app-header'

describe('My Activities and jobs integration contract', () => {
  it('adds My Activities and icons to the signed-in desktop header', () => {
    const { container } = render(<AppHeader recentNotifications={[]} unreadCount={0} />)
    expect(screen.getByRole('link', { name: /my activities/i })).toHaveAttribute('href', '/activities')
    expect(container.querySelectorAll('nav[aria-label="Primary"] svg').length).toBeGreaterThanOrEqual(7)
  })

  it('adds an activities route with exactly two post tabs and a separate jobs section', () => {
    const path = 'src/app/(app)/activities/page.tsx'
    expect(existsSync(path)).toBe(true)
    if (!existsSync(path)) return
    const source = readFileSync(path, 'utf8')
    expect(source).toContain('My Posts')
    expect(source).toContain('My Comments')
    expect(source).toContain('Jobs Applied')
  })

  it('adds the additive jobs and activities migration', () => {
    const path = 'infra/aws/database/migrations/0007_jobs_activities.sql'
    expect(existsSync(path)).toBe(true)
    if (!existsSync(path)) return
    const sql = readFileSync(path, 'utf8')
    expect(sql).toContain('create table if not exists public.jobs')
    expect(sql).toContain('create table if not exists public.job_applications')
  })
})
```

- [ ] **Step 2: Commit and run exact-head AWS Infrastructure CI**

Expected: FAIL because the header has no My Activities link/icons and the activities/migration files do not exist.

- [ ] **Step 3: Record the failing job/run evidence before continuing**

Commit message:

```text
test: define my activities and jobs contracts
```

---

### Task 2: Add the additive Aurora jobs/activity schema and guarded migration

**Files:**
- Create: `infra/aws/database/migrations/0007_jobs_activities.sql`
- Create: `scripts/aws/jobs-activities-schema.test.mjs`
- Create: `scripts/aws/jobs-activities-migration.sh`
- Create: `scripts/aws/jobs-activities-migration-action.txt`
- Create: `.github/workflows/aws-jobs-activities-migration.yml`

**Interfaces:**
- Produces tables `public.jobs`, `public.job_applications` and enums `public.job_listing_status`, `public.job_application_status`.
- Produces indexes `jobs_published_created_idx`, `job_applications_applicant_applied_idx`, `post_comments_author_created_idx`.

- [ ] **Step 1: Add schema contract test before SQL implementation**

The test reads the migration and asserts all approved enums, tables, uniqueness and indexes. It rejects `drop`, `truncate`, `delete from`, and data-changing `update` statements.

```js
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('infra/aws/database/migrations/0007_jobs_activities.sql', 'utf8').toLowerCase()

describe('jobs and activities migration', () => {
  it('is additive and contains the approved schema', () => {
    expect(sql).not.toMatch(/\b(drop|truncate)\b|\bdelete\s+from\b/)
    expect(sql).toContain("create type public.job_listing_status as enum ('draft', 'published', 'closed')")
    expect(sql).toContain("'under_review'")
    expect(sql).toContain("'shortlisted'")
    expect(sql).toContain("'interview'")
    expect(sql).toContain("'selected'")
    expect(sql).toContain("'rejected'")
    expect(sql).toContain("'withdrawn'")
    expect(sql).toContain('create table if not exists public.jobs')
    expect(sql).toContain('create table if not exists public.job_applications')
    expect(sql).toContain('unique (job_id, applicant_id)')
    expect(sql).toContain('post_comments_author_created_idx')
  })
})
```

- [ ] **Step 2: Add the migration SQL**

Use additive statements only. Core shapes:

```sql
create type public.job_listing_status as enum ('draft', 'published', 'closed');
-- statement-breakpoint
create type public.job_application_status as enum (
  'applied', 'under_review', 'shortlisted', 'interview', 'selected', 'rejected', 'withdrawn'
);
-- statement-breakpoint
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  company_name text not null,
  location text,
  summary text not null,
  description text not null,
  requirements text,
  status public.job_listing_status not null default 'draft',
  apply_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- statement-breakpoint
create table if not exists public.job_applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  applicant_id uuid not null references public.profiles(id) on delete cascade,
  status public.job_application_status not null default 'applied',
  applied_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, applicant_id)
);
```

Follow with the three approved indexes using `create index if not exists`.

- [ ] **Step 3: Add guarded migration script and workflow**

Follow `profile-passport-migration.sh` and `aws-profile-passport-migration.yml`: exact SHA guard, exact repo remote, AWS account `310356785722`, staging Aurora cluster `sea-n-shore-staging-aurora`, SQL token guard, shape-before/after checks, RDS Data API transaction, `plan|apply-once` action values, exact-head CI wait, SSM execution through the single `sea-n-shore-bootstrap` instance.

- [ ] **Step 4: Run tests/CI and commit**

Commit message:

```text
feat: add jobs and activities schema
```

---

### Task 3: Add jobs domain and application workflow

**Files:**
- Create: `src/features/jobs/types.ts`
- Create: `src/features/jobs/repository.ts`
- Create: `src/features/jobs/repository.test.ts`
- Create: `src/features/jobs/queries.ts`
- Create: `src/features/jobs/queries.test.ts`
- Create: `src/features/jobs/actions.ts`
- Create: `src/features/jobs/actions.test.ts`

**Interfaces:**
- `JOB_APPLICATION_STATUS_LABELS: Record<JobApplicationStatus, string>`
- `jobsRepository.listPublishedJobs(limit: number): Promise<JobListing[]>`
- `jobsRepository.getPublishedJob(jobId: string): Promise<JobListing | null>`
- `jobsRepository.listApplications(applicantId: string): Promise<JobApplication[]>`
- `jobsRepository.hasApplied(jobId: string, applicantId: string): Promise<boolean>`
- `jobsRepository.createApplication(jobId: string, applicantId: string): Promise<void>`
- `getPublishedJobs()`, `getPublishedJob(id)`, `getMyJobApplications()`
- server action `applyToJob(jobId): Promise<{ ok: true; alreadyApplied: boolean } | { ok: false; error: string }>`

- [ ] **Step 1: Write repository tests before implementation**

Use an injected query function and assert SQL behavior: published only, unexpired roles, newest first; applications scoped by applicant; insert uses status `applied`; duplicate detection queries `(job_id, applicant_id)`.

```ts
const repository = createJobsRepository({ query: async (text, values) => {
  seen.push({ text, values })
  return []
}})
await repository.listPublishedJobs(20)
expect(seen[0]?.text).toContain("j.status = 'published'")
expect(seen[0]?.text).toContain('(j.apply_until is null or j.apply_until >= current_date)')
```

- [ ] **Step 2: Implement types and repository**

Keep SQL centralized in `repository.ts`; map snake_case rows to camelCase domain types.

- [ ] **Step 3: Write query/action tests before query/action implementation**

Test authenticated reads and application behavior. Applying to a missing/non-published job returns an error; already-applied returns `{ ok: true, alreadyApplied: true }`; first apply inserts and revalidates `/jobs`, `/jobs/[id]`, `/activities`.

- [ ] **Step 4: Implement queries and server action**

Use `requireAwsUser()` for all candidate operations. Do not trust applicant IDs from the client.

- [ ] **Step 5: Run targeted tests then commit**

Commit message:

```text
feat: add job application workflow
```

---

### Task 4: Extend feed reads for My Comments

**Files:**
- Modify: `src/features/feed/repository.ts`
- Modify: `src/features/feed/repository.test.ts`
- Modify: `src/features/feed/queries.ts`
- Modify: `src/features/feed/queries.test.ts`
- Create: `src/features/feed/activity-types.ts`

**Interfaces:**
- `FeedRepository.listCommentedRows({ viewerProfileId, limit }): Promise<FeedPostRow[]>`
- `getMyActivityPosts(): Promise<FeedPost[]>`
- `getMyCommentActivity(): Promise<Array<{ post: FeedPost; viewerComments: FeedComment[] }>>`

- [ ] **Step 1: Add failing repository test**

Assert the SQL groups by post and orders by the viewer's latest non-deleted comment while reusing visibility rules.

```ts
await repository.listCommentedRows({ viewerProfileId: 'viewer-1', limit: 30 })
expect(seenSql).toContain('c.author_id = $1')
expect(seenSql).toContain('c.deleted_at is null')
expect(seenSql).toContain('max(c.created_at)')
```

- [ ] **Step 2: Implement `listCommentedRows`**

Join an aggregate subquery:

```sql
join (
  select c.post_id, max(c.created_at) as last_commented_at
  from public.post_comments c
  where c.author_id = $1 and c.deleted_at is null
  group by c.post_id
) viewer_activity on viewer_activity.post_id = p.id
```

Then apply existing `visibilitySql()`, non-deleted post filter, and order by `viewer_activity.last_commented_at desc, p.id desc`.

- [ ] **Step 3: Add failing query tests for grouping viewer comments**

Given hydrated comments from viewer and other members, expect `viewerComments` to contain only comments whose `author.id` equals the signed-in profile ID.

- [ ] **Step 4: Implement activity queries**

`getMyActivityPosts()` uses the signed-in user's ID with `listAuthorRows`. `getMyCommentActivity()` hydrates commented rows and filters each post's comments to the viewer.

- [ ] **Step 5: Run targeted tests then commit**

Commit message:

```text
feat: add member feed activity queries
```

---

### Task 5: Build functional Jobs pages and My Activities UI

**Files:**
- Replace: `src/app/(app)/jobs/page.tsx`
- Create: `src/app/(app)/jobs/page.test.tsx`
- Create: `src/app/(app)/jobs/[id]/page.tsx`
- Create: `src/app/(app)/jobs/[id]/page.test.tsx`
- Create: `src/features/jobs/components/job-card.tsx`
- Create: `src/features/jobs/components/job-application-list.tsx`
- Create: `src/features/jobs/components/apply-job-button.tsx`
- Create: `src/app/(app)/activities/page.tsx`
- Create: `src/app/(app)/activities/page.test.tsx`
- Create: `src/features/feed/components/comment-activity-card.tsx`

**Interfaces:**
- Jobs page consumes `getPublishedJobs()`.
- Job detail consumes `getPublishedJob(id)` and application state.
- Activities consumes `getMyActivityPosts()`, `getMyCommentActivity()`, `getMyJobApplications()`.

- [ ] **Step 1: Write failing page/component tests**

Activities test verifies `My Posts`, `My Comments`, and `Jobs Applied`; it asserts there are only two post-activity tab links/buttons. Comment activity component test passes a post plus `viewerComments` and asserts the highlighted `Your comment` block appears before the post article in DOM order.

```tsx
const yourComment = screen.getByText('Your comment').closest('section')
const post = screen.getByRole('article')
expect(yourComment?.compareDocumentPosition(post) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
```

Jobs page test verifies empty and populated states. Job detail test verifies apply UI for an unapplied published role and `Application submitted` state when already applied.

- [ ] **Step 2: Implement Jobs listing/detail components**

Use existing `Card`, brand colors and `lucide-react`. Do not add a fake seed role.

- [ ] **Step 3: Implement My Activities route**

Use `searchParams.tab` with only `posts|comments`; default to `posts`. Render exactly two tab links:

```tsx
<Link href="/activities?tab=posts">My Posts</Link>
<Link href="/activities?tab=comments">My Comments</Link>
```

Render `Jobs Applied` below the tabbed post area on both tabs.

- [ ] **Step 4: Implement highlighted comment activity card**

Render each viewer comment in a tinted `Your comment` callout before the reused `PostCard`.

- [ ] **Step 5: Run targeted tests then commit**

Commit message:

```text
feat: build my activities workspace
```

---

### Task 6: Add icons and My Activities navigation

**Files:**
- Modify: `src/components/navigation/app-header.tsx`
- Modify: `src/components/navigation/mobile-nav.tsx`
- Create/Modify tests: `src/components/navigation/my-activities-navigation.test.tsx`

**Interfaces:**
- Desktop destinations include Home, My Network, Jobs, Community, Learn, Events, My Activities with Lucide icons.
- Mobile includes My Activities and icon + label presentation.

- [ ] **Step 1: Write failing navigation test**

Render desktop and mobile nav, assert `/activities` is reachable and every destination has an SVG icon.

- [ ] **Step 2: Implement icon-bearing navigation**

Recommended mapping:

```ts
Home -> House
My Network -> UsersRound
Jobs -> BriefcaseBusiness
Community -> MessagesSquare
Learn -> BookOpenCheck
Events -> CalendarDays
My Activities -> History
```

Keep Profile as the existing right-side desktop action and as a mobile destination.

- [ ] **Step 3: Run targeted tests then commit**

Commit message:

```text
feat: add activity navigation icons
```

---

### Task 7: Verify, apply migration once, deploy staging once, restore guards

**Files:**
- Temporarily modify then restore: `scripts/aws/jobs-activities-migration-action.txt`
- Temporarily modify then restore: `scripts/aws/staging-deploy-action.txt`
- Keep: `scripts/aws/edge-recovery-action.txt` as `plan`

**Interfaces:**
- Migration action values: `plan` -> `apply-once` -> `plan`.
- Staging action values: `plan` -> `deploy-once` -> `plan`.

- [ ] **Step 1: Run full exact-head verification**

Required checks:

```text
npm run lint
npm run typecheck
npm run test
npm run build
AWS Infrastructure CI = success on exact branch head
```

- [ ] **Step 2: Apply migration exactly once**

Change only `scripts/aws/jobs-activities-migration-action.txt` to `apply-once`, wait for exact-head CI and the dedicated migration workflow to finish successfully, then return the action file to `plan`.

- [ ] **Step 3: Deploy staging exactly once**

Change only `scripts/aws/staging-deploy-action.txt` to `deploy-once`, wait for guarded deployment success and exact ECS rollout verification, then return the action file to `plan`.

- [ ] **Step 4: Verify final head**

Run exact-head CI again after guard resets. Confirm:

```text
scripts/aws/jobs-activities-migration-action.txt = plan
scripts/aws/staging-deploy-action.txt = plan
scripts/aws/edge-recovery-action.txt = plan
```

- [ ] **Step 5: Verify live staging**

Confirm CloudFront staging responds successfully and the signed-in application can reach the newly deployed routes. Do not claim visual details that are not actually observed.

- [ ] **Step 6: Final branch report**

Report final branch SHA, CI run, migration run, ECS task-definition revision, and guard-file final states. Do not merge and do not create a PR.
