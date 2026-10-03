#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"

[[ "${ONBOARDING_E2E_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "ONBOARDING_E2E_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$ONBOARDING_E2E_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

declare -A EMAILS=(
  [seafarer]="${E2E_SEAFARER_EMAIL:-}"
  [shore]="${E2E_SHORE_EMAIL:-}"
  [recruiter]="${E2E_RECRUITER_EMAIL:-}"
  [trainer]="${E2E_TRAINER_EMAIL:-}"
  [student]="${E2E_STUDENT_EMAIL:-}"
  [family]="${E2E_FAMILY_EMAIL:-}"
  [enthusiast]="${E2E_ENTHUSIAST_EMAIL:-}"
  [other]="${E2E_OTHER_EMAIL:-}"
)

for KEY in seafarer shore recruiter trainer student family enthusiast other; do
  EMAIL="${EMAILS[$KEY]}"
  [[ "$EMAIL" =~ ^sea-n-shore-e2e-[0-9]+-${KEY}@example\.com$ ]] || {
    echo "Unsafe or missing disposable E2E email for $KEY." >&2
    exit 1
  }
done

CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
[[ "$CLUSTER_ARN" == "arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora" ]]
[[ -n "$SECRET_ARN" ]]

read_profile() {
  local EMAIL="$1"
  local SQL="SELECT coalesce(p.persona,''), coalesce(array_to_string(p.profile_intents,','),''), coalesce(p.profile_type::text,''), coalesce(p.headline,''), coalesce(p.specialization,''), coalesce(p.institution_name,''), coalesce(p.community_relationship,''), coalesce(mp.current_company,''), coalesce(mp.rank,''), CASE WHEN mp.user_id IS NULL THEN 'true' ELSE 'false' END, CASE WHEN p.onboarding_completed_at IS NOT NULL THEN 'true' ELSE 'false' END, coalesce(p.role_department_key,''), coalesce(p.role_key,''), coalesce(p.cadet_stage_key,''), coalesce(p.target_department_key,''), coalesce(p.target_role_key,''), coalesce(p.occupation_text,'') FROM public.identity_accounts ia JOIN public.profiles p ON p.id=ia.profile_id LEFT JOIN public.maritime_profiles mp ON mp.user_id=p.id WHERE ia.provider='cognito' AND ia.email='$EMAIL'"
  aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --sql "$SQL" --output json | jq -r '.records[0] | map(.stringValue // "") | @tsv'
}

SEAFARER_ROW="$(read_profile "${EMAILS[seafarer]}")"
SHORE_ROW="$(read_profile "${EMAILS[shore]}")"
RECRUITER_ROW="$(read_profile "${EMAILS[recruiter]}")"
TRAINER_ROW="$(read_profile "${EMAILS[trainer]}")"
STUDENT_ROW="$(read_profile "${EMAILS[student]}")"
FAMILY_ROW="$(read_profile "${EMAILS[family]}")"
ENTHUSIAST_ROW="$(read_profile "${EMAILS[enthusiast]}")"
OTHER_ROW="$(read_profile "${EMAILS[other]}")"

# Round 12: the structured role keys (department, rank / role, cadet stage, target role, occupation) follow each row.
[[ "$SEAFARER_ROW" == $'seafarer\tfind_jobs\tseafarer\tMaster / Captain\t\t\t\tE2E Shipping\tMaster / Captain\tfalse\ttrue\tdeck_officers\tmaster\t\t\t\t' ]]
[[ "$SHORE_ROW" == $'shore_professional\tnetwork\tmaritime_professional\tMarine Superintendent\t\t\t\tE2E Shore\t\tfalse\ttrue\ttechnical_fleet\tmarine_superintendent\t\t\t\t' ]]
[[ "$RECRUITER_ROW" == $'recruiter_hr\thire\trecruiter\tCrewing Manager\t\t\t\tE2E Manning\t\tfalse\ttrue\trecruitment_hr\thr_crewing_manager\t\t\t\t' ]]
[[ "$TRAINER_ROW" == $'trainer_instructor\tteach\ttrainer\tSIRE 2.0\tSIRE 2.0\t\t\tE2E Academy\t\tfalse\ttrue\ttraining\tsimulator_instructor\t\t\t\t' ]]
[[ "$STUDENT_ROW" == $'student_cadet\tlearn\tmaritime_professional\tDeck Cadet (on board)\t\tE2E Maritime Institute\t\t\t\ttrue\ttrue\t\t\tdeck_cadet\tdeck_officers\tthird_officer\t' ]]
[[ "$FAMILY_ROW" == $'seafarer_family\tcommunity\tmaritime_professional\tSeafarer Family\t\t\tSpouse / partner\t\t\ttrue\ttrue\t\t\t\t\t\t' ]]
[[ "$ENTHUSIAST_ROW" == $'maritime_enthusiast\tattend_events\tmaritime_professional\tWeb developer\t\t\t\t\t\ttrue\ttrue\t\t\t\t\t\tWeb developer' ]]
[[ "$OTHER_ROW" == $'other\thost_events\tmaritime_professional\tMaritime technology supporter\t\t\t\t\t\ttrue\ttrue\t\t\t\t\t\tMaritime technology supporter' ]]

echo "ONBOARDING_E2E_PERSONA_PERSISTENCE_VERIFIED=true"
