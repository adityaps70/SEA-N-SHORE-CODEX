#!/usr/bin/env bash
set -euo pipefail

PHASE="${1:-}"
AWS_REGION="${AWS_REGION:-ap-south-1}"
COGNITO_POOL_NAME="${COGNITO_POOL_NAME:-sea-n-shore-staging-users}"
APPLICANT="${E2E_APPLICANT_EMAIL:-}"
ADMIN="${E2E_ADMIN_EMAIL:-}"
UNAUTHORIZED="${E2E_UNAUTHORIZED_EMAIL:-}"
ORGANIZATION_NAME="${E2E_ORGANIZATION_NAME:-}"
JOB_TITLE="${E2E_JOB_TITLE:-}"
APPLICATION_ID="${E2E_APPLICATION_ID:-}"
COMPANY_ID="${E2E_COMPANY_ID:-}"
JOB_ID="${E2E_JOB_ID:-}"

for EMAIL in "$APPLICANT" "$ADMIN" "$UNAUTHORIZED"; do
  [[ "$EMAIL" == sea-n-shore-hiring-e2e-* && "$EMAIL" == *@example.com ]] || { echo "Unsafe disposable email target." >&2; exit 1; }
done
[[ "$ORGANIZATION_NAME" == "E2E Hiring Organization "* ]] || { echo "Unsafe organization target." >&2; exit 1; }
[[ "$JOB_TITLE" == "E2E Chief Officer "* ]] || { echo "Unsafe job target." >&2; exit 1; }

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

profile_ids_sql="SELECT profile_id FROM public.identity_accounts WHERE provider='cognito' AND email IN ('$APPLICANT','$ADMIN','$UNAUTHORIZED')"
applicant_id_sql="SELECT profile_id FROM public.identity_accounts WHERE provider='cognito' AND email='$APPLICANT'"
admin_id_sql="SELECT profile_id FROM public.identity_accounts WHERE provider='cognito' AND email='$ADMIN'"
unauthorized_id_sql="SELECT profile_id FROM public.identity_accounts WHERE provider='cognito' AND email='$UNAUTHORIZED'"

case "$PHASE" in
  confirm)
    resolve_pool
    for EMAIL in "$APPLICANT" "$ADMIN" "$UNAUTHORIZED"; do
      aws cognito-idp admin-confirm-sign-up --region "$AWS_REGION" --user-pool-id "$POOL_ID" --username "$EMAIL"
    done
    echo 'ORGANIZATION_HIRING_E2E_ADMIN_CONFIRM_VERIFIED=true'
    ;;

  grant-admin)
    resolve_db
    PROFILE_COUNT=$(sql "SELECT count(*)::text FROM public.identity_accounts WHERE provider='cognito' AND email IN ('$APPLICANT','$ADMIN','$UNAUTHORIZED')" | jq -r '.records[0][0].stringValue // empty')
    [[ "$PROFILE_COUNT" == 3 ]] || { echo "Expected three disposable profiles; found $PROFILE_COUNT." >&2; exit 1; }
    sql "INSERT INTO public.user_roles (user_id, role) SELECT profile_id, 'administrator'::public.app_role FROM public.identity_accounts WHERE provider='cognito' AND email='$ADMIN' ON CONFLICT (user_id, role) DO NOTHING" >/dev/null
    ADMIN_COUNT=$(sql "SELECT count(*)::text FROM public.user_roles ur WHERE ur.user_id=($admin_id_sql) AND ur.role::text='administrator'" | jq -r '.records[0][0].stringValue // empty')
    [[ "$ADMIN_COUNT" == 1 ]]
    echo 'ORGANIZATION_HIRING_E2E_ADMIN_ROLE_VERIFIED=true'
    ;;

  resolve-application)
    resolve_db
    RESULT=$(sql "SELECT oa.id::text, oa.company_id::text FROM public.organization_applications oa JOIN public.companies c ON c.id=oa.company_id WHERE oa.submitted_by=($applicant_id_sql) AND c.name='$ORGANIZATION_NAME' ORDER BY oa.submitted_at DESC LIMIT 1")
    APPLICATION_ID=$(jq -r '.records[0][0].stringValue // empty' <<<"$RESULT")
    COMPANY_ID=$(jq -r '.records[0][1].stringValue // empty' <<<"$RESULT")
    [[ "$APPLICATION_ID" =~ ^[0-9a-f-]{36}$ && "$COMPANY_ID" =~ ^[0-9a-f-]{36}$ ]]
    echo "ORGANIZATION_HIRING_E2E_APPLICATION_ID=$APPLICATION_ID"
    echo "ORGANIZATION_HIRING_E2E_COMPANY_ID=$COMPANY_ID"
    ;;

  verify-approval)
    resolve_db
    [[ "$APPLICATION_ID" =~ ^[0-9a-f-]{36}$ && "$COMPANY_ID" =~ ^[0-9a-f-]{36}$ ]]
    RESULT=$(sql "SELECT oa.status::text, c.is_verified::text, (cm.approved_at IS NOT NULL)::text, cm.is_verified::text FROM public.organization_applications oa JOIN public.companies c ON c.id=oa.company_id JOIN public.company_members cm ON cm.company_id=c.id AND cm.user_id=oa.submitted_by AND cm.role::text='owner' WHERE oa.id='$APPLICATION_ID'::uuid AND c.id='$COMPANY_ID'::uuid")
    ROW=$(jq -r '.records[0] | map(.stringValue // "") | @tsv' <<<"$RESULT")
    [[ "$ROW" == $'approved\ttrue\ttrue\ttrue' ]] || { echo "Approval state mismatch: $ROW" >&2; exit 1; }
    echo 'ORGANIZATION_HIRING_E2E_APPROVAL_VERIFIED=true'
    ;;

  resolve-job)
    resolve_db
    [[ "$COMPANY_ID" =~ ^[0-9a-f-]{36}$ ]]
    RESULT=$(sql "SELECT j.id::text, j.status::text, j.company_id::text, (j.created_by_user_id=($applicant_id_sql))::text FROM public.jobs j WHERE j.company_id='$COMPANY_ID'::uuid AND j.title='$JOB_TITLE' AND j.status::text = 'published' ORDER BY j.created_at DESC LIMIT 1")
    JOB_ID=$(jq -r '.records[0][0].stringValue // empty' <<<"$RESULT")
    STATUS=$(jq -r '.records[0][1].stringValue // empty' <<<"$RESULT")
    JOB_COMPANY_ID=$(jq -r '.records[0][2].stringValue // empty' <<<"$RESULT")
    OWNER_MATCH=$(jq -r '.records[0][3].stringValue // empty' <<<"$RESULT")
    [[ "$JOB_ID" =~ ^[0-9a-f-]{36}$ && "$STATUS" == published && "$JOB_COMPANY_ID" == "$COMPANY_ID" && "$OWNER_MATCH" == true ]]
    echo "ORGANIZATION_HIRING_E2E_JOB_ID=$JOB_ID"
    echo 'ORGANIZATION_HIRING_E2E_JOB_VERIFIED=true'
    ;;

  probe-job)
    resolve_db
    [[ "$COMPANY_ID" =~ ^[0-9a-f-]{36}$ ]]
    PRESENT_COUNT=$(sql "SELECT count(*)::text FROM public.jobs j WHERE j.company_id='$COMPANY_ID'::uuid AND j.title='$JOB_TITLE'" | jq -r '.records[0][0].stringValue // empty')
    echo "ORGANIZATION_HIRING_E2E_JOB_PRESENT_COUNT=$PRESENT_COUNT"
    if [[ "$PRESENT_COUNT" == 0 ]]; then
      JOB_COLUMNS=$(sql "SELECT coalesce(string_agg(column_name || ':' || data_type || ':nullable=' || is_nullable || ':default=' || coalesce(column_default, ''), ',' ORDER BY ordinal_position), '') FROM information_schema.columns WHERE table_schema='public' AND table_name='jobs'" | jq -r '.records[0][0].stringValue // empty')
      JOB_CONSTRAINTS=$(sql "SELECT coalesce(string_agg(c.conname || '=' || pg_get_constraintdef(c.oid), ' | ' ORDER BY c.conname), '') FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' AND r.relname='jobs'" | jq -r '.records[0][0].stringValue // empty')
      REQUIREMENT_COLUMNS=$(sql "SELECT coalesce(string_agg(table_name || '.' || column_name || ':' || data_type || ':nullable=' || is_nullable || ':default=' || coalesce(column_default, ''), ',' ORDER BY table_name, ordinal_position), '') FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('job_certificate_requirements','job_visa_requirements')" | jq -r '.records[0][0].stringValue // empty')
      echo "ORGANIZATION_HIRING_E2E_JOBS_SCHEMA=$JOB_COLUMNS"
      echo "ORGANIZATION_HIRING_E2E_JOBS_CONSTRAINTS=$JOB_CONSTRAINTS"
      echo "ORGANIZATION_HIRING_E2E_REQUIREMENTS_SCHEMA=$REQUIREMENT_COLUMNS"
    fi
    ;;

  verify-unauthorized)
    resolve_db
    MEMBER_COUNT=$(sql "SELECT count(*)::text FROM public.company_members WHERE user_id=($unauthorized_id_sql)" | jq -r '.records[0][0].stringValue // empty')
    ADMIN_COUNT=$(sql "SELECT count(*)::text FROM public.user_roles WHERE user_id=($unauthorized_id_sql) AND role::text='administrator'" | jq -r '.records[0][0].stringValue // empty')
    [[ "$MEMBER_COUNT" == 0 && "$ADMIN_COUNT" == 0 ]]
    echo 'ORGANIZATION_HIRING_E2E_UNAUTHORIZED_VERIFIED=true'
    ;;

  cleanup)
    resolve_db
    resolve_pool
    sql "DELETE FROM public.jobs WHERE title='$JOB_TITLE' AND (created_by_user_id IN ($profile_ids_sql) OR company_id IN (SELECT id FROM public.companies WHERE name='$ORGANIZATION_NAME'))" >/dev/null
    sql "DELETE FROM public.audit_events WHERE actor_id IN ($profile_ids_sql)" >/dev/null
    sql "DELETE FROM public.organization_applications WHERE submitted_by IN ($profile_ids_sql) OR company_id IN (SELECT id FROM public.companies WHERE name='$ORGANIZATION_NAME')" >/dev/null
    sql "DELETE FROM public.company_access_requests WHERE user_id IN ($profile_ids_sql) OR company_id IN (SELECT id FROM public.companies WHERE name='$ORGANIZATION_NAME')" >/dev/null
    sql "DELETE FROM public.company_members WHERE user_id IN ($profile_ids_sql) OR company_id IN (SELECT id FROM public.companies WHERE name='$ORGANIZATION_NAME')" >/dev/null
    sql "DELETE FROM public.companies WHERE name='$ORGANIZATION_NAME' OR created_by=($applicant_id_sql)" >/dev/null
    sql "DELETE FROM public.user_roles WHERE user_id IN ($profile_ids_sql)" >/dev/null
    sql "DELETE FROM public.profiles WHERE id IN ($profile_ids_sql)" >/dev/null

    DB_LEFT=$(sql "SELECT ((SELECT count(*) FROM public.identity_accounts WHERE provider='cognito' AND email IN ('$APPLICANT','$ADMIN','$UNAUTHORIZED')) + (SELECT count(*) FROM public.companies WHERE name='$ORGANIZATION_NAME') + (SELECT count(*) FROM public.jobs WHERE title='$JOB_TITLE'))::text" | jq -r '.records[0][0].stringValue // empty')
    [[ "$DB_LEFT" == 0 ]] || { echo "Disposable DB artifacts remain: $DB_LEFT" >&2; exit 1; }

    for EMAIL in "$APPLICANT" "$ADMIN" "$UNAUTHORIZED"; do
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

    for EMAIL in "$APPLICANT" "$ADMIN" "$UNAUTHORIZED"; do
      set +e
      GET_OUTPUT=$(aws cognito-idp admin-get-user --region "$AWS_REGION" --user-pool-id "$POOL_ID" --username "$EMAIL" 2>&1)
      GET_STATUS=$?
      set -e
      [[ $GET_STATUS -ne 0 ]] && grep -q 'UserNotFoundException' <<<"$GET_OUTPUT"
    done
    echo 'ORGANIZATION_HIRING_E2E_CLEANUP_VERIFIED=true'
    ;;

  *)
    echo "Unsupported remote E2E phase: $PHASE" >&2
    exit 1
    ;;
esac
