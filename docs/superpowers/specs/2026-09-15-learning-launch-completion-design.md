# Sea N Shore Learning V1 Launch Completion Design

## Goal
Finish the remaining launch-critical native LMS work, migrate the pending learning schema safely, deploy the exact certified branch head to AWS staging, and verify the deployed system without expanding into post-launch features.

## Scope

### 1. Administrator curriculum review evidence
The existing administrator course review queue will expose the frozen submitted curriculum in persisted order. Administrators will see sections, lesson titles/types, content evidence, and full quiz evidence including pass percentage, questions, options, and the correct answer. Correctness remains exclusive to mentor/admin authoring and review models; learner quiz reads remain answer-key free.

### 2. Completion certificates
Add one immutable certificate per certificate-enabled completed enrollment. A certificate snapshots learner name, course title, mentor name, course completion timestamp, issue timestamp, certificate number, and public verification code. New completions issue certificates transactionally with course completion. Already-completed eligible enrollments are supported through an idempotent ensure/read path.

Learners receive a certificate action in My Learning only when the enrollment is completed and the course enables certificates. The PDF is generated server-side with existing `pdf-lib`. A public verification page reads by verification code and exposes only certificate evidence, not private account data.

### 3. Final V1 hardening
The learner/admin surfaces must fail closed and show honest empty/error states. Unsupported activity types (`assignment`, `live_session`) remain non-publishable in V1. No proctoring, adaptive assessment, attempt limits, commerce, payouts, AI question generation, or live-class engine is added.

### 4. Database migrations
Keep `0016_learning_foundation.sql` and its proven migration runner unchanged. Apply pending `0017_learning_quiz_assessments.sql` together with a new additive `0018_learning_certificates.sql` using a separate exact-head, one-shot guarded AWS migration workflow. The workflow must use account `310356785722`, GitHub OIDC, the staging bootstrap instance, SSM, and RDS Data API; it must refuse stale branch heads and unexpected partial schema states.

### 5. Staging deployment
After exact-head Infrastructure CI is fully green and both learning migrations are verified, arm the existing `scripts/aws/staging-deploy-action.txt` to `deploy-once`. The existing AWS Staging Deploy workflow must deploy the exact certified image to ECS and verify the exact task/image. Immediately restore the deploy guard to `plan` after the one-shot deployment.

### 6. Staging verification
Verify the public staging endpoint `https://d3prih0q6jofyr.cloudfront.net`, the learning marketplace route, application health/runtime evidence available through the existing deployment workflow, and migration shape evidence. Do not fabricate authenticated mentor/admin/learner E2E results if no staging credentials are available.

## Certificate data model

`public.learning_certificates`:
- `id uuid primary key`
- `enrollment_id uuid unique not null references learning_enrollments(id) on delete restrict`
- `course_id uuid not null references learning_courses(id) on delete restrict`
- `learner_id uuid not null references profiles(id) on delete restrict`
- `certificate_number text unique not null`
- `verification_code uuid unique not null`
- `learner_name text not null`
- `course_title text not null`
- `mentor_name text not null`
- `completed_at timestamptz not null`
- `issued_at timestamptz not null default now()`
- `created_at timestamptz not null default now()`

Indexes support learner history and public verification lookup. The migration is additive/create-only.

## Security and integrity
- Certificate issuance requires an actual completed enrollment and `certificate_enabled = true`.
- Certificate ownership is enforced for authenticated download/read routes.
- Public verification is code-based and returns only immutable certificate evidence.
- Quiz correct answers never enter learner pre-submission read models.
- Administrator curriculum review requires platform administrator authorization.
- All repository writes remain on `feat/aws-native-phase-0-1`; never touch `main`, merge, create a PR, force-push, or reset.
- Re-fetch the live branch head before every repository write.
- One-shot AWS guards return to `plan` immediately after use.

## Success criteria
- Administrator can inspect persisted curriculum and assessment evidence before approval/publication.
- Course completion produces an idempotent certificate when enabled.
- Learner can download a certificate PDF after completion.
- Public verification page validates a real certificate code.
- 0017 and 0018 are applied and shape-verified on staging.
- Exact-head CI is green after all code/workflow changes.
- Exact certified image is deployed to staging and deployment guard is restored to `plan`.
- Public staging smoke checks succeed.
