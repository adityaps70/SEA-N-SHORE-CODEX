#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-ap-south-1}"
ECS_CLUSTER="${ECS_CLUSTER:-sea-n-shore-staging}"
ECS_SERVICE="${ECS_SERVICE:-sea-n-shore-staging-web}"
ECS_TASK_DEFINITION="${ECS_TASK_DEFINITION:-sea-n-shore-staging-web}"
ECS_CONTAINER_NAME="${ECS_CONTAINER_NAME:-web}"
ECS_EXECUTION_ROLE="${ECS_EXECUTION_ROLE:-sea-n-shore-staging-ecs-execution}"
ECS_EXECUTION_POLICY_NAME="${ECS_EXECUTION_POLICY_NAME:-sea-n-shore-staging-aurora-secret}"

: "${AURORA_HOST:?Set AURORA_HOST to the Aurora cluster endpoint}"
AURORA_PORT="${AURORA_PORT:-5432}"
: "${AURORA_DATABASE:?Set AURORA_DATABASE to the Aurora database name}"
: "${AURORA_SECRET_ARN:?Set AURORA_SECRET_ARN to the RDS-managed master secret ARN}"

case "$AURORA_HOST" in
  *.rds.amazonaws.com) ;;
  *) echo "AURORA_HOST must be an AWS RDS endpoint." >&2; exit 1 ;;
esac

case "$AURORA_PORT" in
  ''|*[!0-9]*) echo "AURORA_PORT must be numeric." >&2; exit 1 ;;
  *) ;;
esac

case "$AURORA_DATABASE" in
  *[!A-Za-z0-9_]*) echo "AURORA_DATABASE contains unsupported characters." >&2; exit 1 ;;
  *) ;;
esac

case "$AURORA_SECRET_ARN" in
  arn:aws:secretsmanager:"$AWS_REGION":*:secret:rds\!cluster-*) ;;
  *) echo "AURORA_SECRET_ARN must be an RDS-managed Secrets Manager ARN in $AWS_REGION." >&2; exit 1 ;;
esac

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

jq -n --arg secret "$AURORA_SECRET_ARN" '{
  Version: "2012-10-17",
  Statement: [
    {
      Sid: "ReadAuroraManagedMasterSecret",
      Effect: "Allow",
      Action: ["secretsmanager:GetSecretValue"],
      Resource: $secret
    }
  ]
}' > "$TMP_DIR/aurora-secret-policy.json"

aws iam put-role-policy \
  --role-name "$ECS_EXECUTION_ROLE" \
  --policy-name "$ECS_EXECUTION_POLICY_NAME" \
  --policy-document "file://$TMP_DIR/aurora-secret-policy.json"

aws ecs describe-task-definition \
  --region "$AWS_REGION" \
  --task-definition "$ECS_TASK_DEFINITION" \
  --query taskDefinition \
  --output json > "$TMP_DIR/task-definition-current.json"

jq \
  --arg NAME "$ECS_CONTAINER_NAME" \
  --arg HOST "$AURORA_HOST" \
  --arg PORT "$AURORA_PORT" \
  --arg DATABASE "$AURORA_DATABASE" \
  --arg USER_SECRET "${AURORA_SECRET_ARN}:username::" \
  --arg PASSWORD_SECRET "${AURORA_SECRET_ARN}:password::" \
  '
  del(
    .taskDefinitionArn,
    .revision,
    .status,
    .requiresAttributes,
    .compatibilities,
    .registeredAt,
    .registeredBy
  )
  | .containerDefinitions |= map(
      if .name == $NAME then
        .environment = (
          ((.environment // [])
            | map(select(
                .name != "AURORA_HOST"
                and .name != "AURORA_PORT"
                and .name != "AURORA_DATABASE"
                and .name != "AURORA_SSL"
              )))
          + [
              {"name":"AURORA_HOST","value":$HOST},
              {"name":"AURORA_PORT","value":$PORT},
              {"name":"AURORA_DATABASE","value":$DATABASE},
              {"name":"AURORA_SSL","value":"true"}
            ]
        )
        | .secrets = (
          ((.secrets // [])
            | map(select(
                .name != "AURORA_USER"
                and .name != "AURORA_PASSWORD"
              )))
          + [
              {"name":"AURORA_USER","valueFrom":$USER_SECRET},
              {"name":"AURORA_PASSWORD","valueFrom":$PASSWORD_SECRET}
            ]
        )
      else . end
    )
  ' "$TMP_DIR/task-definition-current.json" > "$TMP_DIR/task-definition-new.json"

NEW_TASK_ARN=$(aws ecs register-task-definition \
  --region "$AWS_REGION" \
  --cli-input-json "file://$TMP_DIR/task-definition-new.json" \
  --query 'taskDefinition.taskDefinitionArn' \
  --output text)

test -n "$NEW_TASK_ARN" || { echo "ECS did not return a new task definition ARN." >&2; exit 1; }

aws ecs update-service \
  --region "$AWS_REGION" \
  --cluster "$ECS_CLUSTER" \
  --service "$ECS_SERVICE" \
  --task-definition "$NEW_TASK_ARN" \
  --force-new-deployment > /dev/null

aws ecs wait services-stable \
  --region "$AWS_REGION" \
  --cluster "$ECS_CLUSTER" \
  --services "$ECS_SERVICE"

aws ecs describe-task-definition \
  --region "$AWS_REGION" \
  --task-definition "$NEW_TASK_ARN" \
  --query taskDefinition \
  --output json > "$TMP_DIR/task-definition-verified.json"

jq --arg NAME "$ECS_CONTAINER_NAME" '
  .containerDefinitions[]
  | select(.name == $NAME)
  | {
      environmentNames: [(.environment // [])[].name] | sort,
      secretNames: [(.secrets // [])[].name] | sort
    }
' "$TMP_DIR/task-definition-verified.json" > "$TMP_DIR/runtime-shape.json"

for name in AURORA_HOST AURORA_PORT AURORA_DATABASE AURORA_SSL; do
  jq -e --arg name "$name" '.environmentNames | index($name) != null' "$TMP_DIR/runtime-shape.json" >/dev/null || {
    echo "Missing ECS environment variable after repair: $name" >&2
    exit 1
  }
done

for name in AURORA_USER AURORA_PASSWORD; do
  jq -e --arg name "$name" '.secretNames | index($name) != null' "$TMP_DIR/runtime-shape.json" >/dev/null || {
    echo "Missing ECS secret reference after repair: $name" >&2
    exit 1
  }
done

echo "Aurora ECS runtime wiring repaired successfully."
echo "Task definition: $NEW_TASK_ARN"
