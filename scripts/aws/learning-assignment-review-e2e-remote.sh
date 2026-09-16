#!/usr/bin/env bash
set -euo pipefail

PHASE="${1:-}"
AWS_REGION="${AWS_REGION:-ap-south-1}"
COGNITO_POOL_NAME="${COGNITO_POOL_NAME:-sea-n-shore-staging-users}"
MENTOR="${E2E_MENTOR_EMAIL:-}"
LEARNER="${E2E_LEARNER_EMAIL:-}"
MENTOR_NAME="${E2E_MENTOR_NAME:-}"
COURSE_TITLE="${E2E_COURSE_TITLE:-}"
COURSE_SLUG="${E2E_COURSE_SLUG:-}"
FEEDBACK="${E2E_FEEDBACK:-}"

[[ "$MENTOR" == sea-n-shore-learning-review-e2e-* && "$MENTOR" == *-mentor@example.com ]] || { echo "Unsafe disposable mentor email." >&2; exit 1; }
[[ "$LEARNER" == sea-n-shore-learning-review-e2e-* && "$LEARNER" == *-learner@example.com ]] || { echo "Unsafe disposable learner email." >&2; exit 1; }
[[ "$COURSE_TITLE" == "E2E Learning Review Course "* ]] || { echo "Unsafe disposable course title." >&2; exit 1; }
[[ "$COURSE_SLUG" == sea-n-shore-learning-review-e2e-* ]] || { echo "Unsafe disposable course slug." >&2; exit 1; }
[[ -n "$MENTOR_NAME" && -n "$FEEDBACK" ]] || { echo "Required fixture values are missing." >&2; exit 1; }

resolve_pool() {
  POOL_ID=$(aws cognito-idp list-user-pools --region "$AWS_REGION" --max-results 60 --query "UserPools[?Name=='$COGNITO_POOL_NAME'].Id | [0]" --output text)
  [[ -n "$POOL_ID" && "$POOL_ID" != "None" ]] || { echo "Staging Cognito pool not found." >&2; exit 1; }
}

resolve_db() {
  CLUSTER_JSON=$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier sea-n-shore-staging-aurora --output json)
  CLUSTER_ARN=$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")
  SECRET_ARN=$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")
  [[ "$CLUSTER_ARN" == 'arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora' ]]
  [[ -n "$SECRET_ARN" ]]
}

sql() {
  aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database sea_n_shore --sql "$1" --output json
}

mentor_id_sql="SELECT profile_id FROM public.identity_accounts WHERE provider='cognito' AND email='$MENTOR'"
learner_id_sql="SELECT profile_id FROM public.identity_accounts WHERE provider='cognito' AND email='$LEARNER'"
profile_ids_sql="SELECT profile_id FROM public.identity_accounts WHERE provider='cognito' AND email IN ('$MENTOR','$LEARNER')"

case "$PHASE" in
  confirm)
    resolve_pool
    for EMAIL in "$MENTOR" "$LEARNER"; do
      aws cognito-idp admin-confirm-sign-up --region "$AWS_REGION" --user-pool-id "$POOL_ID" --username "$EMAIL"
    done
    echo 'LEARNING_ASSIGNMENT_REVIEW_E2E_CONFIRM_VERIFIED=true'
    ;;

  create-fixture)
    resolve_db
    PROFILE_COUNT=$(sql "SELECT count(*)::text FROM public.identity_accounts WHERE provider='cognito' AND email IN ('$MENTOR','$LEARNER')" | jq -r '.records[0][0].stringValue // empty')
    [[ "$PROFILE_COUNT" == 2 ]] || { echo "Expected two disposable profiles; found $PROFILE_COUNT." >&2; exit 1; }
    RESULT=$(sql "WITH mentor_application AS (
      INSERT INTO public.learning_mentor_applications (
        user_id, applicant_name, current_last_rank, years_experience, vessel_types, specialization,
        certifications, short_bio, proposed_course_topics, status, submitted_at, updated_at,
        reviewed_by, reviewed_at, admin_review_note
      ) VALUES (
        ($mentor_id_sql), '$MENTOR_NAME', 'Master Mariner', 20, ARRAY['Oil Tanker'],
        'Guarded staging assignment review verification', ARRAY['Master Mariner'],
        'Disposable verified mentor created only for the guarded Sea N Shore staging assignment review end-to-end verification.',
        ARRAY['Assignment review workflow'], 'approved', now(), now(), ($mentor_id_sql), now(), 'Guarded E2E fixture.'
      ) RETURNING id
    ), mentor AS (
      INSERT INTO public.learning_mentors (user_id, application_id, status, approved_by, approved_at, created_at, updated_at)
      SELECT ($mentor_id_sql), id, 'active', ($mentor_id_sql), now(), now(), now() FROM mentor_application
      RETURNING id
    ), course AS (
      INSERT INTO public.learning_courses (
        mentor_id, slug, title, subtitle, description, category, level, language,
        learning_outcomes, requirements, target_audience, price_minor, currency, access_type,
        certificate_enabled, course_format, status, reviewed_by, reviewed_at, approved_at, published_at,
        navigation_mode, created_at, updated_at
      ) SELECT id, '$COURSE_SLUG', '$COURSE_TITLE', 'Guarded assignment review verification',
        'Disposable published course used only to verify learner assignment submission, mentor grading and sequential progression on staging.',
        'Safety', 'beginner', 'English', ARRAY['Demonstrate assignment evidence'], ARRAY['Staging E2E user'],
        ARRAY['Maritime professionals'], 0, 'INR', 'free', false, 'recorded', 'published',
        ($mentor_id_sql), now(), now(), now(), 'sequential', now(), now() FROM mentor
      RETURNING id
    ), section AS (
      INSERT INTO public.learning_course_sections (course_id, title, position, created_at, updated_at)
      SELECT id, 'E2E review module', 0, now(), now() FROM course RETURNING id, course_id
    ), assignment_lesson AS (
      INSERT INTO public.learning_lessons (
        section_id, title, lesson_type, position, summary, is_preview, is_downloadable,
        is_published, release_mode, completion_rule, max_attempts, created_at, updated_at
      ) SELECT id, 'E2E evidence assignment', 'assignment', 0,
        'Submit evidence for mentor review.', false, false, true, 'immediate', 'assignment_submit', 2, now(), now()
      FROM section RETURNING id, section_id
    ), assignment AS (
      INSERT INTO public.learning_assignments (
        lesson_id, instructions, accepted_extensions, max_upload_bytes, max_points, passing_percentage, created_at, updated_at
      ) SELECT id, 'Explain how you would verify safe preparation before starting the task. Include clear evidence and controls.',
        ARRAY[]::text[], 10485760, 100, 70, now(), now() FROM assignment_lesson RETURNING id
    ), article_lesson AS (
      INSERT INTO public.learning_lessons (
        section_id, title, lesson_type, position, summary, article_body, is_preview, is_downloadable,
        is_published, release_mode, prerequisite_lesson_id, completion_rule, created_at, updated_at
      ) SELECT section_id, 'Unlocked after mentor pass', 'article', 1,
        'This material proves sequential progression unlock.', 'The mentor pass unlocked this material successfully.',
        false, false, true, 'immediate', id, 'view', now(), now() FROM assignment_lesson RETURNING id
    )
    SELECT course.id::text, assignment_lesson.id::text, article_lesson.id::text FROM course, assignment_lesson, article_lesson")
    COURSE_ID=$(jq -r '.records[0][0].stringValue // empty' <<<"$RESULT")
    ASSIGNMENT_LESSON_ID=$(jq -r '.records[0][1].stringValue // empty' <<<"$RESULT")
    ARTICLE_LESSON_ID=$(jq -r '.records[0][2].stringValue // empty' <<<"$RESULT")
    [[ "$COURSE_ID" =~ ^[0-9a-f-]{36}$ && "$ASSIGNMENT_LESSON_ID" =~ ^[0-9a-f-]{36}$ && "$ARTICLE_LESSON_ID" =~ ^[0-9a-f-]{36}$ ]]
    echo "LEARNING_ASSIGNMENT_REVIEW_E2E_COURSE_ID=$COURSE_ID"
    echo 'LEARNING_ASSIGNMENT_REVIEW_E2E_FIXTURE_VERIFIED=true'
    ;;

  verify-submitted)
    resolve_db
    COUNT=$(sql "SELECT count(*)::text FROM public.learning_assignment_attempts attempt
      JOIN public.learning_lessons lesson ON lesson.id=attempt.lesson_id
      JOIN public.learning_course_sections section ON section.id=lesson.section_id
      JOIN public.learning_courses course ON course.id=section.course_id
      WHERE course.slug='$COURSE_SLUG' AND attempt.learner_id=($learner_id_sql) AND attempt.status::text='submitted'" | jq -r '.records[0][0].stringValue // empty')
    [[ "$COUNT" == 1 ]] || { echo "Expected one submitted assignment attempt; found $COUNT." >&2; exit 1; }
    echo 'LEARNING_ASSIGNMENT_REVIEW_E2E_SUBMISSION_VERIFIED=true'
    ;;

  verify-passed)
    resolve_db
    COUNT=$(sql "SELECT count(*)::text FROM public.learning_assignment_attempts attempt
      JOIN public.learning_lessons lesson ON lesson.id=attempt.lesson_id
      JOIN public.learning_course_sections section ON section.id=lesson.section_id
      JOIN public.learning_courses course ON course.id=section.course_id
      WHERE course.slug='$COURSE_SLUG'
        AND attempt.learner_id=($learner_id_sql)
        AND attempt.status::text='graded' AND attempt.passed=true
        AND attempt.score_points=85 AND attempt.percentage=85
        AND attempt.feedback='$FEEDBACK' AND attempt.graded_by=($mentor_id_sql)
        AND EXISTS (
          SELECT 1 FROM public.learning_progress progress
          WHERE progress.enrollment_id=attempt.enrollment_id AND progress.lesson_id=attempt.lesson_id AND progress.completed=true
        )" | jq -r '.records[0][0].stringValue // empty')
    [[ "$COUNT" == 1 ]] || { echo "Expected one passed, completed assignment grade; found $COUNT." >&2; exit 1; }
    echo 'LEARNING_ASSIGNMENT_REVIEW_E2E_PASS_VERIFIED=true'
    ;;

  cleanup)
    resolve_db
    resolve_pool
    sql "DELETE FROM public.learning_enrollments WHERE course_id IN (SELECT id FROM public.learning_courses WHERE slug='$COURSE_SLUG')" >/dev/null
    sql "DELETE FROM public.learning_courses WHERE slug='$COURSE_SLUG' AND title='$COURSE_TITLE'" >/dev/null
    sql "DELETE FROM public.learning_mentors WHERE user_id=($mentor_id_sql)" >/dev/null
    sql "DELETE FROM public.learning_mentor_applications WHERE user_id=($mentor_id_sql)" >/dev/null
    sql "DELETE FROM public.audit_events WHERE actor_id IN ($profile_ids_sql)" >/dev/null
    sql "DELETE FROM public.user_roles WHERE user_id IN ($profile_ids_sql)" >/dev/null
    sql "DELETE FROM public.profiles WHERE id IN ($profile_ids_sql)" >/dev/null

    DB_LEFT=$(sql "SELECT ((SELECT count(*) FROM public.identity_accounts WHERE provider='cognito' AND email IN ('$MENTOR','$LEARNER')) + (SELECT count(*) FROM public.learning_courses WHERE slug='$COURSE_SLUG'))::text" | jq -r '.records[0][0].stringValue // empty')
    [[ "$DB_LEFT" == 0 ]] || { echo "Disposable learning DB artifacts remain: $DB_LEFT" >&2; exit 1; }

    for EMAIL in "$MENTOR" "$LEARNER"; do
      set +e
      GET_OUTPUT=$(aws cognito-idp admin-get-user --region "$AWS_REGION" --user-pool-id "$POOL_ID" --username "$EMAIL" 2>&1)
      GET_STATUS=$?
      set -e
      if [[ $GET_STATUS -eq 0 ]]; then
        aws cognito-idp admin-delete-user --region "$AWS_REGION" --user-pool-id "$POOL_ID" --username "$EMAIL"
      elif ! grep -q 'UserNotFoundException' <<<"$GET_OUTPUT"; then
        printf '%s\n' "$GET_OUTPUT" >&2
        exit 1
      fi
    done
    echo 'LEARNING_ASSIGNMENT_REVIEW_E2E_CLEANUP_VERIFIED=true'
    ;;

  *)
    echo "Unsupported learning assignment review E2E phase: $PHASE" >&2
    exit 1
    ;;
esac
