#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
POOL_NAME="sea-n-shore-staging-users"
TEST_EMAIL_REGEX='^sea-n-shore-.*@example[.]com$'
ACTION="$(tr -d '[:space:]' < scripts/aws/staging-data-cleanup-action.txt)"

[[ "${STAGING_DATA_CLEANUP_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "STAGING_DATA_CLEANUP_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$STAGING_DATA_CLEANUP_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
[[ "$ACTION" == "plan" || "$ACTION" == "cleanup-once" ]] || {
  echo "Unsupported staging data cleanup action: $ACTION" >&2
  exit 1
}
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
[[ "$CLUSTER_ARN" == "arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora" ]]
[[ -n "$SECRET_ARN" ]]

POOL_ID="$(aws cognito-idp list-user-pools --region "$AWS_REGION" --max-results 60 --query "UserPools[?Name=='$POOL_NAME'].Id | [0]" --output text)"
[[ -n "$POOL_ID" && "$POOL_ID" != "None" ]]

sql() {
  aws rds-data execute-statement \
    --region "$AWS_REGION" \
    --resource-arn "$CLUSTER_ARN" \
    --secret-arn "$SECRET_ARN" \
    --database "$DATABASE_NAME" \
    --sql "$1" \
    --output json
}

read -r -d '' CLEANUP_CTES <<'SQL' || true
base_candidates AS (
  SELECT DISTINCT
    p.id,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.identity_accounts ia
        WHERE ia.profile_id = p.id
          AND ia.provider = 'cognito'
          AND lower(coalesce(ia.email, '')) ~ '^sea-n-shore-.*@example[.]com$'
      ) THEN 'test'
      ELSE 'legacy_pending'
    END AS candidate_kind
  FROM public.profiles p
  WHERE EXISTS (
    SELECT 1
    FROM public.identity_accounts ia
    WHERE ia.profile_id = p.id
      AND ia.provider = 'cognito'
      AND lower(coalesce(ia.email, '')) ~ '^sea-n-shore-.*@example[.]com$'
  )
  OR EXISTS (
    SELECT 1
    FROM public.legacy_organization_conversions loc
    WHERE loc.profile_id = p.id
      AND loc.status = 'pending'
      AND p.identity_root::text = 'organisation'
  )
),
financial_profiles AS (
  SELECT DISTINCT b.id
  FROM base_candidates b
  WHERE EXISTS (SELECT 1 FROM public.seller_earnings x WHERE x.seller_profile_id = b.id)
     OR EXISTS (SELECT 1 FROM public.payout_accounts x WHERE x.seller_profile_id = b.id)
     OR EXISTS (SELECT 1 FROM public.payouts x WHERE x.seller_profile_id = b.id)
     OR EXISTS (
       SELECT 1 FROM public.event_payment_orders x
       WHERE x.profile_id = b.id
         AND (x.provider_payment_id IS NOT NULL OR x.status IN ('paid', 'refunded'))
     )
     OR EXISTS (
       SELECT 1 FROM public.course_payment_orders x
       WHERE x.profile_id = b.id
         AND (x.provider_payment_id IS NOT NULL OR x.status IN ('paid', 'refunded'))
     )
     OR EXISTS (SELECT 1 FROM public.subscription_payments x WHERE x.profile_id = b.id)
     OR EXISTS (
       SELECT 1
       FROM public.subscription_checkouts sc
       JOIN public.subscription_payments sp ON sp.checkout_id = sc.id
       WHERE sc.profile_id = b.id
     )
     OR EXISTS (
       SELECT 1 FROM public.account_subscriptions s
       WHERE s.profile_id = b.id
         AND s.status IN ('trialing', 'active', 'past_due')
     )
),
engagement_protected_legacy AS (
  SELECT DISTINCT b.id
  FROM base_candidates b
  WHERE b.candidate_kind = 'legacy_pending'
    AND (
      EXISTS (
        SELECT 1
        FROM public.jobs j
        JOIN public.job_applications a ON a.job_id = j.id
        WHERE j.created_by_user_id = b.id
          AND NOT EXISTS (SELECT 1 FROM base_candidates bc WHERE bc.id = a.applicant_id)
      )
      OR EXISTS (
        SELECT 1
        FROM public.events e
        JOIN public.event_attendees a ON a.event_id = e.id
        WHERE e.host_user_id = b.id
          AND NOT EXISTS (SELECT 1 FROM base_candidates bc WHERE bc.id = a.user_id)
      )
      OR EXISTS (
        SELECT 1
        FROM public.learning_courses c
        JOIN public.learning_enrollments e ON e.course_id = c.id
        WHERE c.created_by_user_id = b.id
          AND NOT EXISTS (SELECT 1 FROM base_candidates bc WHERE bc.id = e.learner_id)
      )
      OR EXISTS (
        SELECT 1
        FROM public.posts p
        JOIN public.post_comments c ON c.post_id = p.id
        WHERE p.author_id = b.id
          AND NOT EXISTS (SELECT 1 FROM base_candidates bc WHERE bc.id = c.author_id)
      )
      OR EXISTS (
        SELECT 1
        FROM public.posts p
        JOIN public.post_reactions r ON r.post_id = p.id
        WHERE p.author_id = b.id
          AND NOT EXISTS (SELECT 1 FROM base_candidates bc WHERE bc.id = r.user_id)
      )
      OR EXISTS (
        SELECT 1
        FROM public.conversations c
        WHERE (c.direct_user_low_id = b.id OR c.direct_user_high_id = b.id)
          AND (
            (c.direct_user_low_id <> b.id AND NOT EXISTS (SELECT 1 FROM base_candidates bc WHERE bc.id = c.direct_user_low_id))
            OR
            (c.direct_user_high_id <> b.id AND NOT EXISTS (SELECT 1 FROM base_candidates bc WHERE bc.id = c.direct_user_high_id))
          )
      )
    )
),
safe_profiles AS (
  SELECT b.id, b.candidate_kind
  FROM base_candidates b
  WHERE NOT EXISTS (SELECT 1 FROM financial_profiles f WHERE f.id = b.id)
    AND NOT EXISTS (SELECT 1 FROM engagement_protected_legacy e WHERE e.id = b.id)
),
financial_companies AS (
  SELECT DISTINCT c.id
  FROM public.companies c
  WHERE EXISTS (SELECT 1 FROM public.seller_earnings x WHERE x.seller_company_id = c.id)
     OR EXISTS (SELECT 1 FROM public.payout_accounts x WHERE x.seller_company_id = c.id)
     OR EXISTS (SELECT 1 FROM public.payouts x WHERE x.seller_company_id = c.id)
     OR EXISTS (SELECT 1 FROM public.subscription_payments x WHERE x.company_id = c.id)
     OR EXISTS (
       SELECT 1
       FROM public.subscription_checkouts sc
       JOIN public.subscription_payments sp ON sp.checkout_id = sc.id
       WHERE sc.company_id = c.id
     )
     OR EXISTS (
       SELECT 1 FROM public.account_subscriptions s
       WHERE s.company_id = c.id
         AND s.status IN ('trialing', 'active', 'past_due')
     )
),
stale_companies AS (
  SELECT c.id
  FROM public.companies c
  JOIN public.profiles creator ON creator.id = c.created_by
  WHERE (
      EXISTS (SELECT 1 FROM safe_profiles s WHERE s.id = c.created_by)
      OR creator.account_status::text = 'deletion_requested'
    )
    AND NOT EXISTS (SELECT 1 FROM financial_companies f WHERE f.id = c.id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.company_members cm
      JOIN public.profiles member ON member.id = cm.user_id
      WHERE cm.company_id = c.id
        AND cm.approved_at IS NOT NULL
        AND cm.role::text IN ('owner', 'administrator')
        AND member.account_status::text = 'active'
        AND NOT EXISTS (SELECT 1 FROM safe_profiles s WHERE s.id = member.id)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.jobs j
      JOIN public.profiles author ON author.id = j.created_by_user_id
      WHERE j.company_id = c.id
        AND author.account_status::text = 'active'
        AND NOT EXISTS (SELECT 1 FROM safe_profiles s WHERE s.id = author.id)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.events e
      JOIN public.profiles host ON host.id = e.host_user_id
      WHERE e.company_id = c.id
        AND host.account_status::text = 'active'
        AND NOT EXISTS (SELECT 1 FROM safe_profiles s WHERE s.id = host.id)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.learning_courses lc
      JOIN public.profiles author ON author.id = lc.created_by_user_id
      WHERE lc.company_id = c.id
        AND author.account_status::text = 'active'
        AND NOT EXISTS (SELECT 1 FROM safe_profiles s WHERE s.id = author.id)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.posts p
      JOIN public.profiles author ON author.id = p.author_id
      WHERE p.company_id = c.id
        AND author.account_status::text = 'active'
        AND NOT EXISTS (SELECT 1 FROM safe_profiles s WHERE s.id = author.id)
    )
),
stale_jobs AS (
  SELECT DISTINCT j.id
  FROM public.jobs j
  LEFT JOIN public.profiles creator ON creator.id = j.created_by_user_id
  WHERE EXISTS (SELECT 1 FROM safe_profiles s WHERE s.id = j.created_by_user_id)
     OR EXISTS (SELECT 1 FROM stale_companies c WHERE c.id = j.company_id)
     OR (
       creator.account_status::text = 'deletion_requested'
       AND (j.company_id IS NULL OR EXISTS (SELECT 1 FROM stale_companies c WHERE c.id = j.company_id))
     )
)
SQL

PLAN_SQL="WITH $CLEANUP_CTES
SELECT
  (SELECT count(*)::text FROM base_candidates WHERE candidate_kind='test'),
  (SELECT count(*)::text FROM base_candidates WHERE candidate_kind='legacy_pending'),
  (SELECT count(*)::text FROM financial_profiles),
  (SELECT count(*)::text FROM engagement_protected_legacy),
  (SELECT count(*)::text FROM safe_profiles),
  (SELECT count(*)::text FROM stale_companies),
  (SELECT count(*)::text FROM stale_jobs),
  (SELECT count(*)::text FROM public.legacy_organization_conversions WHERE status='completed'),
  (SELECT count(*)::text FROM public.jobs WHERE created_by_user_id IS NULL),
  (SELECT count(*)::text FROM (
     SELECT lower(btrim(name)) FROM public.companies GROUP BY lower(btrim(name)) HAVING count(*) > 1
   ) duplicate_names),
  (SELECT count(*)::text FROM public.organization_applications
   WHERE status IN ('pending','changes_requested') AND submitted_at < now() - interval '90 days'),
  (SELECT count(*)::text FROM public.company_access_requests
   WHERE status='pending' AND requested_at < now() - interval '90 days'),
  (SELECT count(*)::text FROM public.posts
   WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days'),
  (SELECT count(*)::text FROM public.jobs
   WHERE status::text='draft' AND created_at < now() - interval '90 days'),
  (SELECT count(*)::text FROM public.events
   WHERE status='draft' AND created_at < now() - interval '90 days'),
  (SELECT count(*)::text FROM public.learning_courses
   WHERE status='draft' AND created_at < now() - interval '90 days')
"

PLAN_JSON="$(sql "$PLAN_SQL")"
mapfile -t PLAN_COUNTS < <(jq -r '.records[0][] | .stringValue // (.longValue|tostring) // "0"' <<<"$PLAN_JSON")
[[ "${#PLAN_COUNTS[@]}" -eq 16 ]]

echo "STAGING_DATA_CLEANUP_ACTION=$ACTION"
echo "STAGING_DATA_CLEANUP_TEST_PROFILE_CANDIDATES=${PLAN_COUNTS[0]}"
echo "STAGING_DATA_CLEANUP_PENDING_LEGACY_ORG_CANDIDATES=${PLAN_COUNTS[1]}"
echo "STAGING_DATA_CLEANUP_FINANCIAL_PROTECTED=${PLAN_COUNTS[2]}"
echo "STAGING_DATA_CLEANUP_ENGAGEMENT_PROTECTED_LEGACY=${PLAN_COUNTS[3]}"
echo "STAGING_DATA_CLEANUP_SAFE_PROFILE_CANDIDATES=${PLAN_COUNTS[4]}"
echo "STAGING_DATA_CLEANUP_STALE_COMPANY_CANDIDATES=${PLAN_COUNTS[5]}"
echo "STAGING_DATA_CLEANUP_STALE_JOB_CANDIDATES=${PLAN_COUNTS[6]}"
echo "STAGING_DATA_CLEANUP_COMPLETED_LEGACY_CONVERSIONS_PRESERVED=${PLAN_COUNTS[7]}"
echo "STAGING_DATA_CLEANUP_NULL_CREATOR_JOBS_REVIEW=${PLAN_COUNTS[8]}"
echo "STAGING_DATA_CLEANUP_DUPLICATE_ORG_NAME_GROUPS_REVIEW=${PLAN_COUNTS[9]}"
echo "STAGING_DATA_CLEANUP_OLD_ORG_APPLICATIONS_REVIEW=${PLAN_COUNTS[10]}"
echo "STAGING_DATA_CLEANUP_OLD_ACCESS_REQUESTS_REVIEW=${PLAN_COUNTS[11]}"
echo "STAGING_DATA_CLEANUP_OLD_DELETED_POSTS_REVIEW=${PLAN_COUNTS[12]}"
echo "STAGING_DATA_CLEANUP_OLD_DRAFT_JOBS_REVIEW=${PLAN_COUNTS[13]}"
echo "STAGING_DATA_CLEANUP_OLD_DRAFT_EVENTS_REVIEW=${PLAN_COUNTS[14]}"
echo "STAGING_DATA_CLEANUP_OLD_DRAFT_COURSES_REVIEW=${PLAN_COUNTS[15]}"

if [[ "$ACTION" == "plan" ]]; then
  echo "STAGING_DATA_CLEANUP_PLAN_VERIFIED=true"
  exit 0
fi

# Re-evaluate the exact candidates immediately before the one-shot mutation.
mapfile -t SAFE_PROFILE_IDS < <(sql "WITH $CLEANUP_CTES SELECT id::text FROM safe_profiles ORDER BY id" | jq -r '.records[]?[0].stringValue // empty')
mapfile -t SAFE_TEST_PROFILE_IDS < <(sql "WITH $CLEANUP_CTES SELECT id::text FROM safe_profiles WHERE candidate_kind='test' ORDER BY id" | jq -r '.records[]?[0].stringValue // empty')
mapfile -t SAFE_LEGACY_PROFILE_IDS < <(sql "WITH $CLEANUP_CTES SELECT id::text FROM safe_profiles WHERE candidate_kind='legacy_pending' ORDER BY id" | jq -r '.records[]?[0].stringValue // empty')
mapfile -t STALE_COMPANY_IDS < <(sql "WITH $CLEANUP_CTES SELECT id::text FROM stale_companies ORDER BY id" | jq -r '.records[]?[0].stringValue // empty')
mapfile -t STALE_JOB_IDS < <(sql "WITH $CLEANUP_CTES SELECT id::text FROM stale_jobs ORDER BY id" | jq -r '.records[]?[0].stringValue // empty')

for id in "${SAFE_PROFILE_IDS[@]}" "${STALE_COMPANY_IDS[@]}" "${STALE_JOB_IDS[@]}"; do
  [[ -z "$id" || "$id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] || {
    echo "Unsafe cleanup UUID encountered." >&2
    exit 1
  }
done

uuid_list() {
  if [[ "$#" -eq 0 ]]; then
    printf "NULL::uuid"
    return
  fi
  local first=true
  local id
  for id in "$@"; do
    if [[ "$first" == true ]]; then first=false; else printf ","; fi
    printf "'%s'::uuid" "$id"
  done
}

PROFILE_SQL="$(uuid_list "${SAFE_PROFILE_IDS[@]}")"
TEST_PROFILE_SQL="$(uuid_list "${SAFE_TEST_PROFILE_IDS[@]}")"
LEGACY_PROFILE_SQL="$(uuid_list "${SAFE_LEGACY_PROFILE_IDS[@]}")"
COMPANY_SQL="$(uuid_list "${STALE_COMPANY_IDS[@]}")"
JOB_SQL="$(uuid_list "${STALE_JOB_IDS[@]}")"

# Capture Cognito identifiers before identity mappings are removed. Values are never printed.
IDENTITY_FILE="$(mktemp)"
trap 'rm -f "$IDENTITY_FILE"' EXIT
sql "select coalesce(email,''), provider_subject
     from public.identity_accounts
     where provider='cognito' and profile_id in ($PROFILE_SQL)
     order by profile_id" > "$IDENTITY_FILE"

# Delete Cognito identities first. If an unexpected identity error occurs, stop before DB mutation.
while IFS=$'\t' read -r EMAIL SUBJECT; do
  [[ -n "$EMAIL" || -n "$SUBJECT" ]] || continue
  DELETED=false
  for USERNAME in "$EMAIL" "$SUBJECT"; do
    [[ -n "$USERNAME" ]] || continue
    set +e
    GET_OUTPUT="$(aws cognito-idp admin-get-user --region "$AWS_REGION" --user-pool-id "$POOL_ID" --username "$USERNAME" 2>&1)"
    GET_STATUS=$?
    set -e
    if [[ $GET_STATUS -eq 0 ]]; then
      aws cognito-idp admin-delete-user --region "$AWS_REGION" --user-pool-id "$POOL_ID" --username "$USERNAME" >/dev/null
      DELETED=true
      break
    fi
    if ! grep -q 'UserNotFoundException' <<<"$GET_OUTPUT"; then
      echo "Unexpected Cognito lookup failure during cleanup." >&2
      exit 1
    fi
  done
  : "$DELETED"
done < <(jq -r '.records[]? | [(.[0].stringValue // ""), (.[1].stringValue // "")] | @tsv' "$IDENTITY_FILE")

TX_ID="$(aws rds-data begin-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --query transactionId --output text)"
[[ -n "$TX_ID" && "$TX_ID" != "None" ]]
TX_OPEN=true
rollback() {
  if [[ "${TX_OPEN:-false}" == true ]]; then
    aws rds-data rollback-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX_ID" >/dev/null 2>&1 || true
  fi
}
trap 'rollback; rm -f "$IDENTITY_FILE"' EXIT

tx() {
  aws rds-data execute-statement \
    --region "$AWS_REGION" \
    --resource-arn "$CLUSTER_ARN" \
    --secret-arn "$SECRET_ARN" \
    --database "$DATABASE_NAME" \
    --transaction-id "$TX_ID" \
    --sql "$1" >/dev/null
}

# Preserve active organization pages by moving creator attribution to a real approved owner/admin.
tx "update public.companies c
    set created_by = (
      select cm.user_id
      from public.company_members cm
      join public.profiles p on p.id=cm.user_id
      where cm.company_id=c.id
        and cm.approved_at is not null
        and cm.role::text in ('owner','administrator')
        and p.account_status::text='active'
        and cm.user_id not in ($PROFILE_SQL)
      order by case when cm.role::text='owner' then 0 else 1 end, cm.created_at asc
      limit 1
    ),
    updated_at = now()
    where c.created_by in ($PROFILE_SQL)
      and c.id not in ($COMPANY_SQL)
      and exists (
        select 1
        from public.company_members cm
        join public.profiles p on p.id=cm.user_id
        where cm.company_id=c.id
          and cm.approved_at is not null
          and cm.role::text in ('owner','administrator')
          and p.account_status::text='active'
          and cm.user_id not in ($PROFILE_SQL)
      )"

# Remove stale visible product/content first.
tx "delete from public.jobs where id in ($JOB_SQL)"
tx "delete from public.learning_enrollments
    where learner_id in ($PROFILE_SQL)
       or course_id in (
         select id from public.learning_courses
         where created_by_user_id in ($PROFILE_SQL) or company_id in ($COMPANY_SQL)
       )"
tx "delete from public.learning_courses
    where created_by_user_id in ($PROFILE_SQL) or company_id in ($COMPANY_SQL)"
tx "delete from public.learning_mentors where user_id in ($PROFILE_SQL)"
tx "delete from public.learning_mentor_applications where user_id in ($PROFILE_SQL)"
tx "delete from public.events where host_user_id in ($PROFILE_SQL) or company_id in ($COMPANY_SQL)"
tx "delete from public.post_comments where author_id in ($PROFILE_SQL)"
tx "delete from public.post_reactions where user_id in ($PROFILE_SQL)"
tx "delete from public.saved_posts where user_id in ($PROFILE_SQL)"
tx "delete from public.post_poll_votes where user_id in ($PROFILE_SQL)"
tx "delete from public.posts where author_id in ($PROFILE_SQL) or company_id in ($COMPANY_SQL)"
tx "delete from public.conversations
    where direct_user_low_id in ($PROFILE_SQL) or direct_user_high_id in ($PROFILE_SQL)"

# Remove member-owned activities and stale workflow rows.
tx "delete from public.job_applications where applicant_id in ($PROFILE_SQL)"
tx "delete from public.job_saves where user_id in ($PROFILE_SQL)"
tx "delete from public.job_alerts where user_id in ($PROFILE_SQL)"
tx "delete from public.job_recruiter_notes where recruiter_id in ($PROFILE_SQL)"
tx "delete from public.job_reports where reporter_id in ($PROFILE_SQL)"
tx "delete from public.content_reports where reporter_id in ($PROFILE_SQL)"
tx "delete from public.event_attendees where user_id in ($PROFILE_SQL)"
tx "delete from public.company_access_requests where user_id in ($PROFILE_SQL)"
tx "delete from public.organization_applications where submitted_by in ($PROFILE_SQL)"
tx "delete from public.company_members where user_id in ($PROFILE_SQL)"
tx "delete from public.organization_follows where follower_id in ($PROFILE_SQL)"
tx "delete from public.notifications where recipient_id in ($PROFILE_SQL) or actor_id in ($PROFILE_SQL)"
tx "delete from public.follows where follower_id in ($PROFILE_SQL) or following_id in ($PROFILE_SQL)"
tx "delete from public.connections where user_low_id in ($PROFILE_SQL) or user_high_id in ($PROFILE_SQL) or requested_by in ($PROFILE_SQL)"
tx "delete from public.user_blocks where blocker_id in ($PROFILE_SQL) or blocked_id in ($PROFILE_SQL)"
tx "delete from public.message_reactions where profile_id in ($PROFILE_SQL)"
tx "delete from public.profile_documents where profile_id in ($PROFILE_SQL)"
tx "delete from public.profile_experiences where profile_id in ($PROFILE_SQL)"
tx "delete from public.profile_credentials where profile_id in ($PROFILE_SQL)"
tx "delete from public.profile_visas where profile_id in ($PROFILE_SQL)"
tx "delete from public.learning_certificates where learner_id in ($PROFILE_SQL)"
tx "delete from public.learning_assignment_attempts where learner_id in ($PROFILE_SQL)"
tx "delete from public.maritime_profiles where user_id in ($PROFILE_SQL)"
tx "delete from public.profile_skills where user_id in ($PROFILE_SQL)"
tx "delete from public.user_roles where user_id in ($PROFILE_SQL)"
tx "delete from public.feature_verifications where profile_id in ($PROFILE_SQL)"
tx "delete from public.entitlement_grants where profile_id in ($PROFILE_SQL)"
tx "delete from public.payment_customer_contacts where profile_id in ($PROFILE_SQL)"
tx "delete from public.seller_fee_overrides where seller_profile_id in ($PROFILE_SQL) or seller_company_id in ($COMPANY_SQL)"
tx "delete from public.event_payment_orders where profile_id in ($PROFILE_SQL)"
tx "delete from public.course_payment_orders where profile_id in ($PROFILE_SQL)"
tx "delete from public.subscription_checkouts where profile_id in ($PROFILE_SQL) or company_id in ($COMPANY_SQL)"
tx "delete from public.account_subscriptions where profile_id in ($PROFILE_SQL) or company_id in ($COMPANY_SQL)"

# Keep append-only/administrative history without retaining a deleted actor identity.
tx "update public.audit_events set actor_id=null where actor_id in ($LEGACY_PROFILE_SQL)"
tx "delete from public.audit_events where actor_id in ($TEST_PROFILE_SQL)"
tx "update public.job_application_events set actor_id=null where actor_id in ($PROFILE_SQL)"
tx "update public.payment_audit_events set actor_profile_id=null where actor_profile_id in ($PROFILE_SQL)"
tx "update public.plan_prices set created_by=null where created_by in ($PROFILE_SQL)"
tx "update public.platform_fee_settings set updated_by=null where updated_by in ($PROFILE_SQL)"
tx "update public.payout_settings set updated_by=null where updated_by in ($PROFILE_SQL)"

# Withdraw newsletter linkage while retaining append-only consent history.
tx "insert into public.newsletter_consent_events (subscriber_id, event_type, topics, source)
    select id, 'unsubscribed', topics, 'staging_data_cleanup'
    from public.newsletter_subscribers
    where profile_id in ($PROFILE_SQL) and status <> 'unsubscribed'"
tx "update public.newsletter_subscribers
    set status='unsubscribed',
        unsubscribed_at=coalesce(unsubscribed_at, now()),
        ses_sync_status=case when confirmed_at is not null or ses_sync_status <> 'not_required' then 'pending' else 'not_required' end,
        ses_sync_attempts=0,
        ses_sync_error=null,
        ses_next_attempt_at=now(),
        profile_id=null,
        updated_at=now()
    where profile_id in ($PROFILE_SQL)"

# Remove orphan/test organization pages only after their visible products are gone.
tx "delete from public.companies where id in ($COMPANY_SQL)"

# Remove identity mappings and conversion prompts, then anonymize the retained profile row.
tx "delete from public.legacy_organization_conversions where profile_id in ($PROFILE_SQL)"
tx "delete from public.identity_accounts where profile_id in ($PROFILE_SQL)"
tx "update public.profiles
    set slug=null,
        profile_type=null,
        persona=null,
        profile_intents='{}'::text[],
        community_relationship=null,
        institution_name=null,
        specialization=null,
        identity_root=null,
        primary_identity=null,
        primary_identity_family=null,
        secondary_identities='{}'::text[],
        full_name='Deleted member',
        avatar_path=null,
        cover_path=null,
        location=null,
        headline=null,
        summary=null,
        contact_visibility='private',
        account_status='deletion_requested',
        onboarding_completed_at=null,
        username_change_count=0,
        updated_at=now()
    where id in ($PROFILE_SQL)"

aws rds-data commit-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX_ID" >/dev/null
TX_OPEN=false

VERIFY_JSON="$(sql "WITH $CLEANUP_CTES
SELECT
  (SELECT count(*)::text FROM safe_profiles),
  (SELECT count(*)::text FROM stale_companies),
  (SELECT count(*)::text FROM stale_jobs)")"
mapfile -t VERIFY_COUNTS < <(jq -r '.records[0][] | .stringValue // "0"' <<<"$VERIFY_JSON")
[[ "${VERIFY_COUNTS[0]}" == "0" ]]
[[ "${VERIFY_COUNTS[1]}" == "0" ]]
[[ "${VERIFY_COUNTS[2]}" == "0" ]]

echo "STAGING_DATA_CLEANUP_APPLIED_PROFILE_COUNT=${#SAFE_PROFILE_IDS[@]}"
echo "STAGING_DATA_CLEANUP_APPLIED_COMPANY_COUNT=${#STALE_COMPANY_IDS[@]}"
echo "STAGING_DATA_CLEANUP_APPLIED_JOB_COUNT=${#STALE_JOB_IDS[@]}"
echo "STAGING_DATA_CLEANUP_APPLY_VERIFIED=true"
