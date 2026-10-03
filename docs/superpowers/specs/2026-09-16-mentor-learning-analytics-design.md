# Mentor Learning Analytics Design

## Goal

Give approved Sea N Shore mentors a read-only analytics workspace that answers a practical question: **Are learners enrolling, progressing and completing the mentor's courses?** The first slice must use the LMS data already persisted in Aurora, remain strictly scoped to courses owned by the authenticated mentor, and avoid exposing learner personally identifiable information.

## Scope

This slice adds mentor-facing learning analytics only. It does not add commerce, payouts, learner-level exports, ratings, cohorts, notifications, new event tracking or a new database migration.

The mentor analytics workspace lives at `/learn/studio/analytics` and is reachable from Mentor Studio.

## Authorization and privacy

- The page requires an authenticated AWS user through the existing Cognito-backed `requireAwsUser()` path.
- The user must have an active approved mentor state, matching the existing `/learn/studio` authorization behavior; otherwise redirect to `/learn/teach`.
- Repository queries scope all facts through `learning_courses -> learning_mentors` with `mentor.user_id = $1` and `mentor.status = 'active'`.
- Analytics output is aggregate only. It must not expose learner name, learner email, learner ID, response text, attachment paths, certificate verification codes or other learner-level records.
- Revoked enrollments are excluded from learner/progress/completion analytics.
- Assignment analytics may count attempts and outcomes but may not return learner-identifying fields.

## Data sources

Use current AWS-native LMS tables only:

- `public.learning_courses` for mentor ownership and course identity/status.
- `public.learning_mentors` for active mentor ownership.
- `public.learning_enrollments` for total/current/completed enrollments.
- `public.learning_course_sections` and `public.learning_lessons` for the denominator of published course materials.
- `public.learning_progress` for per-enrollment completed-material progress.
- `public.learning_certificates` for certificates issued from completed enrollments.
- `public.learning_assignment_attempts` plus assignment/lesson/section joins for pending, passed and needs-revision outcomes.

No new schema is required for this version.

## Metric definitions

### Portfolio summary

For all courses owned by the mentor:

- **Courses:** number of owned courses returned by the analytics projection. Draft/review/published/archived courses remain visible so a mentor can see a complete teaching portfolio.
- **Published courses:** owned courses whose current status is `published`.
- **Enrollments:** non-revoked enrollments across owned courses. Each course/learner enrollment counts once according to the existing unique enrollment model.
- **In progress:** non-revoked enrollments whose status is `active`.
- **Completed:** enrollments whose status is `completed`.
- **Completion rate:** `completed / enrollments * 100`, rounded to the nearest whole percent; zero when there are no enrollments.
- **Average progress:** average of each non-revoked enrollment's course progress percentage. For each enrollment, progress is completed published lessons divided by total published lessons for that course, rounded to the nearest whole percent; a course with zero published lessons contributes zero progress.
- **Certificates issued:** certificates whose `course_id` belongs to the mentor's owned courses.
- **Assignments awaiting review:** assignment attempts on owned courses with `status = 'submitted'`.
- **Assignments passed:** graded attempts with `passed = true`.
- **Assignments needing revision:** graded attempts with `passed = false`.

Assignment counts are attempt counts, not learner counts. This preserves the current revision/resubmission history model and makes the review workload explicit.

### Per-course breakdown

For each owned course return:

- course ID
- slug
- title
- status
- enrollments
- in-progress enrollments
- completed enrollments
- completion rate
- average progress
- certificates issued
- assignments awaiting review
- assignments passed
- assignments needing revision

The page orders courses by meaningful learning activity first, then title as a deterministic fallback. A course with no learners remains visible with zero metrics.

## Repository boundary

Create `src/features/learning/mentor-analytics-repository.ts` with a single public read model:

```ts
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
```

Expose:

```ts
mentorAnalyticsRepository.getForMentor(mentorUserId: string): Promise<MentorLearningAnalytics>
```

Use one aggregate SQL query or a small fixed number of aggregate queries. Avoid N+1 per-course querying. Numeric PostgreSQL values are normalized to finite non-negative integers at the repository boundary.

## Query shape

The safest implementation is a CTE-based aggregate query:

1. `owned_courses` establishes authorization/ownership first.
2. `published_lesson_counts` calculates each course's published-material denominator.
3. `enrollment_progress` produces one row per non-revoked enrollment with its progress percentage.
4. `enrollment_metrics`, `certificate_metrics` and `assignment_metrics` aggregate independently by course.
5. The final `select` left-joins those aggregates to `owned_courses`, preserving zero-activity courses and preventing join multiplication.

The mentor user ID is always passed as `$1`; it is never interpolated into SQL.

## UI

### Mentor Studio entry point

Add an `Analytics` action beside `Review assignments` / `Create course`, linking to `/learn/studio/analytics`. The existing operational Studio counters remain unchanged.

### Analytics page

Use the existing Sea N Shore Learning visual language rather than a generic admin dashboard:

- Back link to Mentor Studio.
- Header: `Learning analytics` with concise copy that these are aggregate outcomes across the mentor's courses.
- Primary metric cards: enrollments, completion rate, average progress, certificates.
- Secondary operational cards: in progress, completed, assignments awaiting review, revision outcomes.
- Course performance section as responsive cards/table-like rows with course title/status and the core per-course learning metrics.
- Empty state for an approved mentor with no courses yet, linking to `/learn/studio/courses/new`.
- No charting dependency in this slice. Numeric clarity comes before decorative graphs; charts can be added later when time-series tracking exists.

## Testing

Repository tests must prove:

- the mentor ID is parameterized as `$1`;
- SQL ownership is scoped through `learning_mentors` and active mentor status;
- revoked enrollments are excluded;
- zero-activity courses map to zeros;
- PostgreSQL numeric strings map to numbers;
- completion and average-progress values are returned correctly;
- no learner PII field exists in the returned analytics model.

Page tests must prove:

- active mentors see the analytics headline and aggregate cards;
- per-course metrics render;
- empty state renders for no courses;
- non-active mentors redirect to `/learn/teach` and analytics are not queried;
- Mentor Studio exposes the `/learn/studio/analytics` entry point.

## Delivery discipline

- Work only on `feat/aws-native-phase-0-1`.
- Re-fetch the live branch before every repository write.
- Do not touch `main`, merge, create a PR, force-push or reset.
- Implement production behavior RED -> GREEN.
- No database migration or AWS one-shot migration action is required for this slice.
- Keep all existing one-shot guards in `plan`.
- Require exact-head AWS Infrastructure CI success before calling the slice complete.
- Staging deployment/E2E is a separate guarded operation after repository behavior is green; do not arm deployment merely to test repository logic.