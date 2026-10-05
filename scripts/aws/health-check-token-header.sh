# Round 15: sourced by the workflows that call the deep health check (/api/health/home) from a
# GitHub runner holding the staging OIDC deploy role.
#
# write_health_check_header <file> writes "x-health-check-token: <token>" to <file> (mode 600) for
# `curl -H @<file>`, so the token never appears in argv, the environment or the log. The token is
# masked in the Actions log before anything else touches it and is never echoed.
#
# Ordering: until the release that gives the live web task HEALTH_CHECK_TOKEN, the old app ignores
# the header, so a secret that cannot be read yet (not created, or the deploy role not yet allowed)
# only leaves the file empty, with a warning. Once the live web task has HEALTH_CHECK_TOKEN, a
# secret that cannot be read fails the caller.
HEALTH_CHECK_TOKEN_SECRET_ID="sea-n-shore-staging/health-check-token"

health_check_token_required() {
  local cluster="${ECS_CLUSTER:-sea-n-shore-staging}"
  local service="${ECS_SERVICE:-sea-n-shore-staging-web}"
  local container="${ECS_CONTAINER_NAME:-web}"
  local task definition
  task="$(aws ecs describe-services --cluster "$cluster" --services "$service" --query 'services[0].taskDefinition' --output text)" || return 1
  [[ "$task" == arn:aws:ecs:*:310356785722:task-definition/* ]] || return 1
  definition="$(aws ecs describe-task-definition --task-definition "$task" --query taskDefinition --output json)" || return 1
  jq -r --arg name "$container" '[.containerDefinitions[] | select(.name == $name) | (.secrets // [])[] | select(.name == "HEALTH_CHECK_TOKEN")] | length > 0' <<<"$definition"
}

write_health_check_header() {
  local out="$1" token="" required=""
  : > "$out"
  chmod 600 "$out"
  required="$(health_check_token_required)" || { echo "Could not read the live web task definition to decide whether the health check token is required." >&2; return 1; }
  [[ "$required" == true || "$required" == false ]] || { echo "Unexpected answer for whether the health check token is required." >&2; return 1; }
  echo "HEALTH_CHECK_TOKEN_REQUIRED_BY_LIVE_TASK=$required"
  if token="$(aws secretsmanager get-secret-value --secret-id "$HEALTH_CHECK_TOKEN_SECRET_ID" --query SecretString --output text 2>/dev/null)"; then
    echo "::add-mask::$token"
    if [[ "$token" =~ ^[A-Za-z0-9]{32,}$ ]]; then
      printf 'x-health-check-token: %s\n' "$token" > "$out"
      token=""
      echo "HEALTH_CHECK_TOKEN_SENT=true"
      return 0
    fi
    token=""
    echo "The health check token secret does not hold a usable token." >&2
    [[ "$required" == false ]] || return 1
  else
    token=""
    [[ "$required" == false ]] || { echo "The live web task requires HEALTH_CHECK_TOKEN but the secret $HEALTH_CHECK_TOKEN_SECRET_ID could not be read." >&2; return 1; }
  fi
  echo "::warning::The health check token is not available yet and the live web task does not require it; calling /api/health/home without it."
  echo "HEALTH_CHECK_TOKEN_SENT=false"
}
