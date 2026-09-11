#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-ap-south-1}"
MARKER="${HIRING_CREATE_JOB_PROBE_MARKER:-}"
[[ "$MARKER" =~ ^[0-9]+$ ]] || { echo 'Unsafe hiring create-job probe marker.' >&2; exit 1; }

CLUSTER_JSON=$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier sea-n-shore-staging-aurora --output json)
CLUSTER_ARN=$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")
SECRET_ARN=$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")
[[ "$CLUSTER_ARN" == 'arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora' ]]
[[ -n "$SECRET_ARN" ]]

TX_ID=$(aws rds-data begin-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database sea_n_shore --query transactionId --output text)
[[ -n "$TX_ID" && "$TX_ID" != None ]]
ROLLED_BACK=false
rollback_probe() {
  if [[ "$ROLLED_BACK" != true && -n "${TX_ID:-}" ]]; then
    aws rds-data rollback-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX_ID" >/dev/null
    ROLLED_BACK=true
  fi
}
trap rollback_probe EXIT

# BEGIN transaction above. This probe performs PostgreSQL parse/type inference only.
# PREPARE parses the exact parameter shape used by createJob; the prepared INSERT is never EXECUTEd.
PROBE_SQL=$(cat <<'SQL'
DO $probe$
DECLARE
  v_state text;
  v_message text;
BEGIN
  BEGIN
    EXECUTE $prepare$
      PREPARE hiring_create_job_parameter_probe AS
      insert into public.jobs (
        title, company_name, company_id, created_by_user_id, location, summary, description, requirements,
        apply_until, status, job_domain, department, rank, vessel_types, experience_min_years, experience_max_years,
        joining_from, joining_until, salary_min, salary_max, salary_currency, salary_period, sailing_regions,
        urgent, easy_apply, published_at
      ) values (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14::text[], $15, $16,
        $17, $18, $19, $20, $21, $22, $23::text[],
        $24, $25, case when $10 = 'published' then now() else null end
      ) returning id
    $prepare$;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_state = RETURNED_SQLSTATE,
      v_message = MESSAGE_TEXT;
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = format(
        'HIRING_CREATE_JOB_PROBE_PARAMETER_SQLSTATE=%s|MESSAGE=%s',
        v_state,
        left(coalesce(v_message, ''), 300)
      );
  END;

  RAISE EXCEPTION USING
    ERRCODE = 'P0001',
    MESSAGE = 'HIRING_CREATE_JOB_PROBE_PARAMETER_SQLSTATE=none|MESSAGE=PREPARE succeeded unexpectedly';
END
$probe$;
SQL
)

set +e
PROBE_OUTPUT=$(aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database sea_n_shore --transaction-id "$TX_ID" --sql "$PROBE_SQL" --output json 2>&1)
PROBE_STATUS=$?
set -e

FAILURE=0
SAFE_ERROR=$(tr '\r\n' '  ' <<<"$PROBE_OUTPUT" | sed -E 's/[[:space:]]+/ /g' | cut -c1-1600)
PARAMETER_SQLSTATE=$(grep -oE 'HIRING_CREATE_JOB_PROBE_PARAMETER_SQLSTATE=([0-9A-Z]{5}|none)' <<<"$SAFE_ERROR" | head -n1 | cut -d= -f2 || true)
PARAMETER_MESSAGE=$(grep -oE 'MESSAGE=[^|;\"]+' <<<"$SAFE_ERROR" | head -n1 | cut -d= -f2- || true)

echo "HIRING_CREATE_JOB_PROBE_PARAMETER_SQLSTATE=${PARAMETER_SQLSTATE:-unknown}"
echo "HIRING_CREATE_JOB_PROBE_PARAMETER_MESSAGE=${PARAMETER_MESSAGE:-unavailable}"

if [[ $PROBE_STATUS -eq 0 ]]; then
  echo 'HIRING_CREATE_JOB_PROBE_UNEXPECTED_STATUS=prepare_wrapper_succeeded'
  FAILURE=1
elif [[ "$PARAMETER_SQLSTATE" == '42P08' ]]; then
  echo 'HIRING_CREATE_JOB_PROBE_PARAMETER_CONFLICT_CONFIRMED=true'
else
  echo "HIRING_CREATE_JOB_PROBE_ERROR_MESSAGE=$SAFE_ERROR"
  FAILURE=1
fi

# ROLLBACK is mandatory even though PREPARE never executes the INSERT.
rollback_probe
trap - EXIT

VERIFY_SQL="select count(*)::text from public.jobs where title='E2E Hiring Probe ${MARKER}'"
VERIFY_OUTPUT=$(aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database sea_n_shore --sql "$VERIFY_SQL" --output json)
REMAINING=$(jq -r '.records[0][0].stringValue // empty' <<<"$VERIFY_OUTPUT")
if [[ "$REMAINING" == 0 ]]; then
  echo 'HIRING_CREATE_JOB_PROBE_ROLLBACK_VERIFIED=true'
else
  echo 'HIRING_CREATE_JOB_PROBE_ROLLBACK_VERIFIED=false'
  echo "HIRING_CREATE_JOB_PROBE_REMAINING_COUNT=$REMAINING"
  FAILURE=1
fi

if [[ $FAILURE -eq 0 ]]; then
  echo 'HIRING_CREATE_JOB_PROBE_COMPLETED=true'
fi
exit "$FAILURE"
