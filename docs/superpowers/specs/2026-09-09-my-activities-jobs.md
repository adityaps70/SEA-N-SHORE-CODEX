# My Activities + Job Applications Design

## Goal
Add a signed-in **My Activities** workspace that gives members one place to review their own posts, the posts they have commented on, and their maritime job applications with current status. Make the existing Jobs area minimally functional so members can open a published job and apply once.

## Approved UX

### My Activities
Route: `/activities`

The page has exactly **two post-activity tabs**:

1. **My Posts** — all non-deleted posts authored by the signed-in member, newest first.
2. **My Comments** — each visible post the signed-in member has commented on appears once. The member's own comment(s) are highlighted above that post so their contribution is immediately visible.

A separate **Jobs Applied** section is displayed on the same page and is not a third tab. It lists every job application for the signed-in member, newest first, with job title, company, location, applied date and current application status.

Empty states should explain what to do next and link to `/home` or `/jobs` as appropriate.

### Jobs
The existing `/jobs` product-placeholder page becomes a functional published-jobs listing. Each published, non-expired role links to `/jobs/[id]`.

The job detail page shows title, company, location, role summary, description and requirements. A signed-in active/onboarded member can apply once. Applying creates one application row with initial status `applied`. Repeat applications are prevented by a unique `(job_id, applicant_id)` constraint and by the application service.

No recruiter/admin job-posting UI is included in this scope. Published jobs can be populated through the database/admin process. This keeps the candidate experience functional without inventing an unfinished company workflow.

### Application statuses
Supported statuses:

- `applied`
- `under_review`
- `shortlisted`
- `interview`
- `selected`
- `rejected`
- `withdrawn`

The candidate workspace is read-only for status in this scope.

## Data model

Add additive Aurora migration `0007_jobs_activities.sql` containing:

- `public.job_listing_status` enum: `draft`, `published`, `closed`.
- `public.job_application_status` enum with the seven statuses above.
- `public.jobs` table with UUID id, title, company_name, location, summary, description, requirements, listing status, optional apply_until, timestamps.
- `public.job_applications` table with UUID id, job_id FK, applicant_id FK, status, applied_at, updated_at and unique `(job_id, applicant_id)`.
- index for published job discovery.
- index for applicant activity ordered by `applied_at desc`.
- index for `post_comments(author_id, created_at desc)` where not deleted, to support My Comments efficiently.

All migration changes are additive. The migration is applied to staging through a dedicated guarded GitHub Actions + SSM workflow with `plan` / `apply-once` action file, following the existing Aurora migration pattern.

## Feed/activity query design

Reuse existing feed hydration so activity posts retain author, media, poll, reaction, save and comment behavior.

Add a repository query `listCommentedRows({ viewerProfileId, limit })` that selects each post once and orders by the signed-in member's most recent non-deleted comment. Existing feed visibility/block rules must still apply.

Add `getMyActivityPosts()` returning the signed-in member's authored posts and `getMyCommentActivity()` returning hydrated posts plus the member's comments grouped by post.

## Jobs domain

Create `src/features/jobs/` with focused files:

- `types.ts` — listing/application types, status labels.
- `repository.ts` — SQL reads and insert for applications.
- `queries.ts` — authenticated reads for published jobs, job detail and current member applications.
- `actions.ts` — server action for applying.
- `components/job-card.tsx` — published role card.
- `components/job-application-list.tsx` — application status list reused by My Activities.

Authorization rules are enforced server-side using `requireAwsUser()` and the same active/onboarded profile checks used elsewhere in the AWS-native app.

## Navigation

Desktop header options receive Lucide icons while retaining text labels. Add **My Activities** as a primary destination with an activity/history-style icon. Existing Home, My Network, Jobs, Community, Learn and Events options also receive appropriate icons.

Mobile navigation also includes My Activities so the new workspace is reachable on small screens. Mobile bottom navigation should use icon + compact label presentation and remain touch-friendly.

## Testing

Test-first coverage must prove:

- the desktop header renders icons and a My Activities destination;
- the My Activities route exists and exposes exactly two post tabs plus a separate Jobs Applied section;
- the comments activity highlights the viewer's own comment before the post content;
- feed repository selects posts commented on by the viewer and de-duplicates them;
- jobs migration is additive and contains approved enums/tables/indexes;
- published job repository/query behavior excludes draft/closed or expired roles;
- applying creates one application with `applied` status and repeat application attempts return an already-applied result;
- application status labels render correctly.

Run `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, exact-head AWS Infrastructure CI, guarded migration apply, guarded staging deploy, then restore all action files to `plan`.

## Out of scope

- recruiter/company dashboard;
- job creation/editing UI;
- candidate withdrawal action;
- interview scheduling;
- email/SMS application notifications;
- ranking/matching recommendations.
