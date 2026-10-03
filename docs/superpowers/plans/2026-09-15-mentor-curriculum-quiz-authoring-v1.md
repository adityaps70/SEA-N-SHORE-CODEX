# Mentor Curriculum + Quiz Authoring V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add production-safe mentor curriculum and quiz authoring to the existing Sea N Shore LMS, editable only while a mentor-owned course is `draft` or `changes_requested`, and frozen once submitted.

**Architecture:** Extend the existing Mentor Studio course editor rather than introducing a second authoring surface. Add a mentor-owned curriculum repository for sections, lessons, and atomic quiz definitions; expose validated server actions; strengthen course submission with curriculum readiness checks; then render a focused curriculum editor in the existing edit page. Reuse `learning_course_sections`, `learning_lessons`, `learning_quizzes`, `learning_quiz_questions`, and `learning_quiz_options`; no schema migration is required.

**Tech Stack:** Next.js App Router, React, TypeScript, Zod, PostgreSQL (`pg`), Vitest/Testing Library, existing AWS-native database and CI workflow.

**Spec:** Approved conversation design: Mentor Curriculum + Quiz Authoring V1, frozen on submission.

## Global Constraints

- Repository: `adityaps70/SEA-N-SHORE-CODEX`.
- Work only on branch `feat/aws-native-phase-0-1`.
- Re-fetch the live branch head before every repository write and reconcile if it moved.
- Never touch `main`, merge, create a PR, force-push, or reset.
- Mentor mutations require an authenticated active mentor who owns the course.
- Mentor curriculum is editable only when course status is `draft` or `changes_requested`.
- Submitted/approved/published/archived curriculum is immutable to mentors.
- Quiz scoring/correctness remains server-authoritative; never expose correct answers to learner read models.
- Do not fabricate course content or quiz questions.
- No new database migration in this slice.
- No staging deployment unless explicitly requested.
- Use RED -> GREEN TDD for behavior changes and certify the final exact head through existing Infrastructure CI.

---

### Task 1: Mentor Curriculum Repository

**Files:**
- Create: `src/features/learning/mentor-curriculum-repository.test.ts`
- Create: `src/features/learning/mentor-curriculum-repository.ts`

**Interfaces:**
- Produces `MentorCurriculum`, `MentorCurriculumSection`, `MentorCurriculumLesson`, `MentorQuizDefinition`.
- Produces repository methods for `getCurriculum`, section create/update/delete/move, lesson create/update/delete/move, and `saveQuizDefinition`.

- [ ] Write failing repository tests proving ownership, active-mentor requirement, draft/change-requested editability, deterministic dense positions, and atomic quiz replacement.
- [ ] Verify RED in exact-head CI.
- [ ] Implement the smallest transaction-safe repository satisfying those contracts.
- [ ] Verify GREEN and existing learning tests.
- [ ] Commit.

### Task 2: Mentor Curriculum Server Actions

**Files:**
- Create: `src/features/learning/mentor-curriculum-actions.test.ts`
- Create: `src/features/learning/mentor-curriculum-actions.ts`

**Interfaces:**
- Consumes Task 1 repository.
- Produces validated actions for sections, lessons, moves, deletes, and atomic quiz save.

- [ ] Write failing action tests for UUID validation, normalized text, lesson-type-specific fields, quiz shape, exactly one correct option, and safe mutation errors.
- [ ] Verify RED.
- [ ] Implement Zod validation, `requireAwsUser`, repository calls, and Studio path revalidation.
- [ ] Verify GREEN.
- [ ] Commit.

### Task 3: Submission Readiness Gate

**Files:**
- Modify: `src/features/learning/course-repository.test.ts`
- Modify: `src/features/learning/course-repository.ts`
- Modify: `src/features/learning/course-actions.test.ts`
- Modify: `src/features/learning/course-actions.ts`

**Interfaces:**
- Strengthens existing `submitCourse(actorId, courseId)` without changing the public workflow.
- Produces specific readiness errors surfaced safely by `submitCourseForReview`.

- [ ] Add failing tests for no sections, empty sections, missing required lesson content, missing quiz definition, quiz with no questions, options fewer than two, and not exactly one correct option.
- [ ] Verify RED.
- [ ] Implement readiness queries under the same locked transaction before status transition.
- [ ] Map repository readiness errors to clear mentor-facing messages.
- [ ] Verify GREEN.
- [ ] Commit.

### Task 4: Mentor Curriculum Editor UI

**Files:**
- Create: `src/features/learning/components/mentor-curriculum-editor.test.tsx`
- Create: `src/features/learning/components/mentor-curriculum-editor.tsx`
- Modify: `src/app/(app)/learn/studio/courses/[courseId]/edit/page.test.tsx`
- Modify: `src/app/(app)/learn/studio/courses/[courseId]/edit/page.tsx`

**Interfaces:**
- Consumes curriculum read model and Task 2 actions.
- Renders inside the existing editable course page.

- [ ] Write failing component/page tests for sections, lesson-type selection, add/edit/delete, accessible move up/down controls, nested quiz editor, readiness guidance, and no editor for non-editable statuses.
- [ ] Verify RED.
- [ ] Implement a focused client editor with explicit save controls and safe pending/error states.
- [ ] Integrate it below Course Details and above Submit for Review.
- [ ] Verify GREEN.
- [ ] Commit.

### Task 5: Exact-Head Certification

**Files:** none unless a CI-discovered defect requires a test-first fix.

- [ ] Re-fetch branch head and confirm it is the expected implementation head.
- [ ] Run/observe exact-head Infrastructure CI.
- [ ] Confirm Application Verify install/lint/typecheck/test, Docker build, Terraform validation/plan guards, and SSM/schema contracts are green.
- [ ] If CI reveals a defect, add a failing regression test first, fix minimally, and re-certify the new exact head.
- [ ] Confirm no staging deployment occurred.
