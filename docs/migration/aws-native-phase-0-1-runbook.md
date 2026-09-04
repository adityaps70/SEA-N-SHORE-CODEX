# AWS-Native Phase 0 + Phase 1 Runbook

## Safety
Supabase remains live and writable. Phase 0/1 never deletes or changes Supabase.

## Source baseline
In the operator terminal, set `SOURCE_DATABASE_URL` through an approved secret channel and run:

```bash
./scripts/migration/capture_source_baseline.sh
```

Known pre-plan sanity is approximately 7 profiles, 11 posts, 7 follows, 6 connections, and 10 notifications; the live query is authoritative.

## Terraform state
Use the existing state bucket `sea-n-shore-310356785722-ap-south-1-tfstate`, key `sea-n-shore/staging/terraform.tfstate`, region `ap-south-1`, with `use_lockfile=true`.

## Plan safety
Always run:

```bash
terraform plan -out=tfplan
terraform show -json tfplan > plan.json
node ../../../scripts/aws/check-terraform-plan.mjs plan.json
```

Do not apply if the guard fails or if the human-readable plan replaces the existing VPC, ALB, ECS cluster/service, ECR repository, or IAM/OIDC bootstrap resources.

## Rollback
No application rollback is required during Phase 0/1 because the runtime remains Supabase-backed. Destroy only newly added Phase 1 resources after explicit approval.

## Phase 3 Cognito checkpoint
Phase 3 adds Cognito authentication primitives in parallel with the existing Supabase runtime. The live application remains Supabase-backed until the Aurora repository and server-side authorization layer are ready to cut over together.

Before applying ECS runtime configuration changes, verify the Cognito auth unit suite:

```bash
./node_modules/.bin/vitest run \
  src/lib/auth/cognito-api.test.ts \
  src/lib/auth/cognito-cookies.test.ts \
  src/lib/auth/cognito-session.test.ts \
  src/features/auth/cognito-actions.test.ts
```

Expected current checkpoint: all four files pass. Cognito tokens, passwords, challenge sessions, database credentials, and OAuth secrets must never be printed or committed.

The ECS task definition may receive only these non-secret Cognito identifiers during Phase 3:

```text
AWS_COGNITO_REGION
AWS_COGNITO_USER_POOL_ID
AWS_COGNITO_CLIENT_ID
```

Do not add an auth-provider cutover flag, remove Supabase environment variables, alter `src/proxy.ts`, or switch protected application pages to Cognito during Phase 3.

If a Cognito staging verification fails, stop the new Cognito path and leave the existing Supabase auth/session path active. Do not delete or pause Supabase until the final Aurora cutover and rollback window have completed.
