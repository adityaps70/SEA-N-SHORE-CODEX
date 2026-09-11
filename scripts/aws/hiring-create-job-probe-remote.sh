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
    aws rds-data rollback-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX_ID" >/dev/null || true
    ROLLED_BACK=true
  fi
}
trap rollback_probe EXIT

# BEGIN transaction above. Every disposable fixture and createJob-equivalent statement stays inside it.
PROBE_SQL=$(cat <<SQL
DO \$probe\$
DECLARE
  v_user uuid := gen_random_uuid();
  v_company uuid := gen_random_uuid();
  v_job uuid;
  v_stage text := 'fixture_profile';
  v_rows integer;
  v_state text;
  v_message text;
  v_constraint text;
  v_table text;
  v_column text;
BEGIN
  insert into public.profiles (id, full_name)
  values (v_user, 'Hiring Probe User ${MARKER}');

  v_stage := 'fixture_company';
  insert into public.companies (id, slug, name, created_by, is_verified, verified_at, verified_by)
  values (v_company, 'hiring-probe-${MARKER}', 'Hiring Probe ${MARKER}', v_user, true, now(), v_user);

  v_stage := 'fixture_membership';
  insert into public.company_members (company_id, user_id, role, approved_at, is_verified, verified_at, verified_by)
  values (v_company, v_user, 'owner', now(), true, now(), v_user);

  v_stage := 'authorized_company';
  select count(*) into v_rows
  from public.companies c
  join public.company_members cm on cm.company_id = c.id
  where cm.user_id = v_user
    and cm.approved_at is not null
    and cm.role::text = any(array['owner','administrator','recruiter']::text[])
    and c.is_verified = true
    and c.id = v_company;
  if v_rows <> 1 then
    raise exception using errcode = 'P0001', message = 'authorized company row not found';
  end if;

  v_stage := 'insert_job';
  insert into public.jobs (
    title, company_name, company_id, created_by_user_id, location, summary, description, requirements,
    apply_until, status, job_domain, department, rank, vessel_types, experience_min_years, experience_max_years,
    joining_from, joining_until, salary_min, salary_max, salary_currency, salary_period, sailing_regions,
    urgent, easy_apply, published_at
  ) values (
    'E2E Hiring Probe ${MARKER}', 'Hiring Probe ${MARKER}', v_company, v_user, 'Worldwide',
    'Diagnostic published vacancy for the Sea N Shore hiring transaction.',
    'Lead the deck team safely and maintain tanker operating standards.',
    'Valid STCW certification and relevant tanker experience required.',
    null, 'published', 'sea', 'Deck', 'Chief Officer', array['Oil Tanker','Chemical Tanker']::text[], 2, 8,
    null, null, 7000, 8500, 'USD', 'month', array['Worldwide','Middle East']::text[], true, true, now()
  ) returning id into v_job;

  v_stage := 'insert_certificate_requirement';
  insert into public.job_certificate_requirements (job_id, certificate_name, required)
  values (v_job, 'STCW', true), (v_job, 'Advanced Oil Tanker', true)
  on conflict (job_id, certificate_name) do update set required = excluded.required;

  v_stage := 'insert_visa_requirement';
  insert into public.job_visa_requirements (job_id, visa_name, required)
  values (v_job, 'US C1/D', true)
  on conflict (job_id, visa_name) do update set required = excluded.required;
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS
    v_state = RETURNED_SQLSTATE,
    v_message = MESSAGE_TEXT,
    v_constraint = CONSTRAINT_NAME,
    v_table = TABLE_NAME,
    v_column = COLUMN_NAME;
  RAISE EXCEPTION USING
    ERRCODE = v_state,
    MESSAGE = format(
      'HIRING_CREATE_JOB_PROBE_FAILED_STAGE=%s|SQLSTATE=%s|CONSTRAINT=%s|TABLE=%s|COLUMN=%s|MESSAGE=%s',
      v_stage,
      v_state,
      coalesce(v_constraint, ''),
      coalesce(v_table, ''),
      coalesce(v_column, ''),
      left(coalesce(v_message, ''), 300)
    );
END
\$probe\$;
SQL
)

set +e
PROBE_OUTPUT=$(aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database sea_n_shore --transaction-id "$TX_ID" --sql "$PROBE_SQL" --output json 2>&1)
PROBE_STATUS=$?
set -e

FAILURE=0
if [[ $PROBE_STATUS -eq 0 ]]; then
  echo 'HIRING_CREATE_JOB_PROBE_STAGE_OK=authorized_company'
  echo 'HIRING_CREATE_JOB_PROBE_STAGE_OK=insert_job'
  echo 'HIRING_CREATE_JOB_PROBE_STAGE_OK=insert_certificate_requirement'
  echo 'HIRING_CREATE_JOB_PROBE_STAGE_OK=insert_visa_requirement'
else
  FAILURE=1
  SAFE_ERROR=$(tr '\r\n' '  ' <<<"$PROBE_OUTPUT" | sed -E 's/[[:space:]]+/ /g' | cut -c1-1200)
  FAILED_STAGE=$(grep -oE 'HIRING_CREATE_JOB_PROBE_FAILED_STAGE=[^|;" ]+' <<<"$SAFE_ERROR" | head -n1 || true)
  SQLSTATE=$(grep -oE 'SQLSTATE=[0-9A-Z]{5}' <<<"$SAFE_ERROR" | head -n1 | cut -d= -f2 || true)
  echo "${FAILED_STAGE:-HIRING_CREATE_JOB_PROBE_FAILED_STAGE=database_probe}"
  echo "HIRING_CREATE_JOB_PROBE_ERROR_CODE=${SQLSTATE:-unknown}"
  echo "HIRING_CREATE_JOB_PROBE_ERROR_MESSAGE=$SAFE_ERROR"
fi

# ROLLBACK is mandatory even when the probe SQL fails.
rollback_probe
trap - EXIT

VERIFY_SQL="select ((select count(*) from public.profiles where full_name='Hiring Probe User ${MARKER}') + (select count(*) from public.companies where name='Hiring Probe ${MARKER}') + (select count(*) from public.jobs where title='E2E Hiring Probe ${MARKER}'))::text"
VERIFY_OUTPUT=$(aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database sea_n_shore --sql "$VERIFY_SQL" --output json)
REMAINING=$(jq -r '.records[0][0].stringValue // empty' <<<"$VERIFY_OUTPUT")
if [[ "$REMAINING" == 0 ]]; then
  echo 'HIRING_CREATE_JOB_PROBE_ROLLBACK_VERIFIED=true'
else
  echo "HIRING_CREATE_JOB_PROBE_ROLLBACK_VERIFIED=false"
  echo "HIRING_CREATE_JOB_PROBE_REMAINING_COUNT=$REMAINING"
  FAILURE=1
fi

if [[ $FAILURE -eq 0 ]]; then
  echo 'HIRING_CREATE_JOB_PROBE_COMPLETED=true'
fi
exit "$FAILURE"
