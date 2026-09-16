# Mentor Learning Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a privacy-safe, read-only mentor analytics workspace that summarizes enrollment, progress, completion, certificate and assignment outcomes for courses owned by the authenticated mentor.

**Architecture:** Add a focused `mentor-analytics-repository` read model backed by aggregate Aurora queries scoped through the active mentor's owned courses. Render the read model at `/learn/studio/analytics` and add a discoverable Mentor Studio entry point. Reuse existing LMS tables; no schema migration, new event tracking or commerce logic is required.

**Tech Stack:** Next.js 16, React 19, TypeScript, PostgreSQL/Aurora, existing Cognito AWS auth helpers, Vitest + Testing Library, GitHub Actions exact-head CI.

**Spec:** `docs/superpowers/specs/2026-09-16-mentor-learning-analytics-design.md`

## Global Constraints

- Work only on `feat/aws-native-phase-0-1`; never touch `main`, merge, create a PR, force-push or reset.
- Re-fetch the live branch head before every repository write.
- AWS staging account remains `310356785722`; never use `992382634586`.
- Implement every production behavior RED -> GREEN.
- Use existing LMS/Aurora tables only; this slice must not introduce a migration.
- Analytics must be mentor-owned and aggregate only; do not expose learner name, learner email, learner ID, assignment response text, attachment paths or certificate verification codes.
- Exclude revoked enrollments from learner/progress/completion analytics.
- Keep every existing one-shot action guard in `plan` throughout repository development.
- Require exact-head six-job AWS Infrastructure CI success before calling repository implementation complete.

---

### Task 1: RED mentor analytics repository contract

**Files:**
- Create: `src/features/learning/mentor-analytics-repository.test.ts`

**Interfaces:**
- Consumes existing tables `learning_courses`, `learning_mentors`, `learning_enrollments`, `learning_course_sections`, `learning_lessons`, `learning_progress`, `learning_certificates`, `learning_assignment_attempts` and `learning_assignments`.
- Defines the expected `createMentorAnalyticsRepository({ query })` API before production implementation exists.

- [ ] **Step 1: Write a failing repository test for aggregate mapping**

Create a query stub returning two per-course aggregate rows. Assert that `getForMentor('mentor-user-1')` returns:

```ts
{
  summary: {
    courseCount: 2,
    publishedCourseCount: 1,
    enrollmentCount: 10,
    activeEnrollmentCount: 6,
    completedEnrollmentCount: 4,
    completionRate: 40,
    averageProgress: 61,
    certificateCount: 3,
    pendingAssignmentCount: 2,
    passedAssignmentCount: 5,
    revisionAssignmentCount: 1,
  },
  courses: [/* normalized numeric rows */],
}
```

Use PostgreSQL-style numeric strings in the fixture so mapping behavior is real.

- [ ] **Step 2: Assert ownership/privacy SQL contract**

Capture the SQL text and values passed to the stub, then assert:

```ts
expect(sql).toContain('mentor.user_id = $1')
expect(sql).toContain("mentor.status = 'active'")
expect(sql).toContain("enrollment.status <> 'revoked'")
expect(values).toEqual(['mentor-user-1'])
expect(result.courses[0]).not.toHaveProperty('learnerId')
expect(result.courses[0]).not.toHaveProperty('learnerName')
```

Also assert independent aggregate CTEs are used for enrollment, certificate and assignment counts so joins cannot multiply metrics.

- [ ] **Step 3: Assert zero-state normalization**

Return one owned course whose aggregate columns are PostgreSQL `0` strings and assert completion rate and average progress are `0` rather than `NaN`.

- [ ] **Step 4: Commit RED only**

Commit message:

```text
test: define mentor learning analytics contract
```

- [ ] **Step 5: Verify exact-head CI fails for the intended missing module**

Observe the `AWS Infrastructure CI` run for the RED commit. The expected failure is Application verify caused by the missing `mentor-analytics-repository` production module; unrelated Terraform/guard failures are blockers and must be investigated rather than accepted as RED evidence.

---

### Task 2: GREEN aggregate repository

**Files:**
- Create: `src/features/learning/mentor-analytics-repository.ts`
- Test: `src/features/learning/mentor-analytics-repository.test.ts`

**Interfaces:**

Produce:

```ts
export type MentorCourseAnalytics = {
  courseId: string
  slug: string
  title: string
  status: CourseStatus
  enrollmentCount: number
  activeEnrollmentCount: number
  completedEnrollmentCount: number
  completionRate: number
  averageProgress: number
  certificateCount: number
  pendingAssignmentCount: number
  passedAssignmentCount: number
  revisionAssignmentCount: number
}

export type MentorLearningAnalytics = {
  summary: {
    courseCount: number
    publishedCourseCount: number
    enrollmentCount: number
    activeEnrollmentCount: number
    completedEnrollmentCount: number
    completionRate: number
    averageProgress: number
    certificateCount: number
    pendingAssignmentCount: number
    passedAssignmentCount: number
    revisionAssignmentCount: number
  }
  courses: MentorCourseAnalytics[]
}

export function createMentorAnalyticsRepository(input?: { query?: MentorAnalyticsQuery }): {
  getForMentor(mentorUserId: string): Promise<MentorLearningAnalytics>
}

export const mentorAnalyticsRepository = createMentorAnalyticsRepository()
```

- [ ] **Step 1: Implement a CTE-based aggregate query**

Use these logical CTEs:

```sql
with owned_courses as (... mentor.user_id = $1 ...),
published_lesson_counts as (...),
enrollment_progress as (... enrollment.status <> 'revoked' ...),
enrollment_metrics as (...),
certificate_metrics as (...),
assignment_metrics as (...)
select ... from owned_courses ...
```

`enrollment_progress` must produce exactly one row per enrollment and calculate progress from published lesson count and completed `learning_progress` rows. Aggregate certificates and assignment attempts independently before joining to courses.

- [ ] **Step 2: Normalize database values at the repository boundary**

Add small helpers that convert numeric/string/null aggregate values into finite non-negative integer numbers. Validate course status using the same allowed status set as the course domain.

- [ ] **Step 3: Derive portfolio summary in TypeScript from course rows**

Calculate totals from mapped course analytics. Calculate portfolio completion rate from completed/enrollment totals and portfolio average progress as an enrollment-weighted average of course progress:

```ts
const weightedProgress = courses.reduce(
  (sum, course) => sum + course.averageProgress * course.enrollmentCount,
  0,
)
const averageProgress = enrollmentCount > 0
  ? Math.round(weightedProgress / enrollmentCount)
  : 0
```

This avoids averaging course averages equally when course populations differ.

- [ ] **Step 4: Verify repository tests GREEN**

The exact-head Application verify job must pass the new repository test. If CI reveals SQL-shape or TypeScript issues, fix production code without weakening the contract.

- [ ] **Step 5: Commit GREEN**

Commit message:

```text
feat: add mentor learning analytics read model
```

---

### Task 3: RED analytics page contract

**Files:**
- Create: `src/app/(app)/learn/studio/analytics/page.test.tsx`

**Interfaces:**
- Mocks `requireAwsUser`, `learningRepository.getMentorApplicationState`, and `mentorAnalyticsRepository.getForMentor`.
- Production page will live at `/learn/studio/analytics`.

- [ ] **Step 1: Write active-mentor rendering test**

Fixture summary:

```ts
{
  courseCount: 2,
  publishedCourseCount: 1,
  enrollmentCount: 10,
  activeEnrollmentCount: 6,
  completedEnrollmentCount: 4,
  completionRate: 40,
  averageProgress: 61,
  certificateCount: 3,
  pendingAssignmentCount: 2,
  passedAssignmentCount: 5,
  revisionAssignmentCount: 1,
}
```

Assert the page renders `Learning analytics`, the primary aggregate metrics and both course titles.

- [ ] **Step 2: Write authorization test**

For `kind: 'none'` and an inactive/suspended mentor state, assert redirect to `/learn/teach` and assert analytics repository is never called.

- [ ] **Step 3: Write no-course empty-state test**

When `courses: []`, assert copy `Publish your first course to start measuring learner outcomes` and a link to `/learn/studio/courses/new`.

- [ ] **Step 4: Commit RED only**

Commit message:

```text
test: define mentor analytics workspace
```

- [ ] **Step 5: Verify exact-head Application verify fails because `./page` is missing**

Do not accept failures unrelated to the intentionally missing page.

---

### Task 4: GREEN mentor analytics workspace

**Files:**
- Create: `src/app/(app)/learn/studio/analytics/page.tsx`
- Test: `src/app/(app)/learn/studio/analytics/page.test.tsx`

**Interfaces:**
- Calls `mentorAnalyticsRepository.getForMentor(user.id)` only after active mentor authorization succeeds.

- [ ] **Step 1: Implement authorization identical to Mentor Studio**

```ts
const user = await requireAwsUser()
const mentorState = await learningRepository.getMentorApplicationState(user.id)
if (mentorState.kind !== 'mentor' || mentorState.mentorStatus !== 'active') {
  return redirect('/learn/teach')
}
const analytics = await mentorAnalyticsRepository.getForMentor(user.id)
```

- [ ] **Step 2: Render primary learning outcome cards**

Render Enrollments, Completion rate, Average progress and Certificates issued as the first visual group. Percent values append `%` in presentation only.

- [ ] **Step 3: Render operational outcome cards**

Render In progress, Completed, Awaiting review and Needs revision. Include a link to `/learn/studio/assignments` when `pendingAssignmentCount > 0`.

- [ ] **Step 4: Render per-course performance**

Each owned course card shows title/status plus enrollment, completion rate, average progress, certificates and assignment review workload. Keep zero-activity courses visible.

- [ ] **Step 5: Render empty state**

For no courses, provide the required empty-state copy and `/learn/studio/courses/new` CTA.

- [ ] **Step 6: Verify page tests GREEN and commit**

Commit message:

```text
feat: add mentor learning analytics workspace
```

---

### Task 5: Mentor Studio analytics entry point

**Files:**
- Modify: `src/app/(app)/learn/studio/page.test.tsx`
- Modify: `src/app/(app)/learn/studio/page.tsx`

**Interfaces:**
- Adds a stable `Analytics` link to `/learn/studio/analytics` for every active mentor; it does not replace existing assignment/course actions.

- [ ] **Step 1: RED — extend Studio test first**

Add:

```ts
expect(screen.getByRole('link', { name: /analytics/i })).toHaveAttribute(
  'href',
  '/learn/studio/analytics',
)
```

Commit/test this expectation before changing production page.

- [ ] **Step 2: GREEN — add the Studio action**

Add an `Analytics` action in the existing top action group, using existing button styles and a suitable Lucide analytics icon. Do not add another repository query to the Studio landing page.

- [ ] **Step 3: Verify existing Studio tests and analytics page tests GREEN**

Ensure existing Review assignments/Create course behavior remains unchanged.

- [ ] **Step 4: Commit**

Commit message:

```text
feat: link mentor studio to learning analytics
```

---

### Task 6: Full verification and safe-state closeout

**Files:**
- No production changes expected unless verification finds a defect.

- [ ] **Step 1: Re-fetch branch and inspect all commits in this slice**

Confirm every commit is on `feat/aws-native-phase-0-1` and no concurrent branch movement was overwritten.

- [ ] **Step 2: Require exact-head AWS Infrastructure CI 6/6 green**

Require success for:

- Terraform validate app
- GitHub SSM execution contract
- Terraform plan guard tests
- Terraform validate bootstrap
- Docker build
- Application verify, including lint/typecheck/tests

- [ ] **Step 3: Re-check critical one-shot guards**

At minimum verify `scripts/aws/staging-deploy-action.txt`, LMS migration guards and other currently relevant one-shot actions remain `plan`. This slice should never need to arm a migration.

- [ ] **Step 4: Decide staging verification without weakening safety**

Because this is a new authenticated page, repository completion requires CI only. A live staging browser proof requires an exact-head staging deployment and suitable mentor fixture. If that guarded operation is performed, arm only after exact-head CI is green, restore the deploy guard to `plan` immediately after terminal status, then inspect logs and require a final safe-head 6/6 CI. If no deployment is intentionally armed in this slice, report repository/CI completion separately from live staging deployment status.

- [ ] **Step 5: Completion claim**

Only call the mentor analytics slice complete after fresh exact-head evidence. Report whether live staging was or was not redeployed; never imply new UI is live if it was only repository-verified.