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

## Phase 4 Aurora application runtime checkpoint
Phase 4 introduces the Aurora PostgreSQL application client in parallel with the current Supabase data path. Adding the database client or ECS runtime values does not itself route any protected feature to Aurora.

The server-only Aurora runtime contract is:

```text
AURORA_HOST
AURORA_PORT
AURORA_DATABASE
AURORA_USER
AURORA_PASSWORD
AURORA_SSL
```

`AURORA_HOST`, `AURORA_PORT`, `AURORA_DATABASE`, and `AURORA_SSL` are ordinary ECS environment values sourced from Terraform-managed Aurora resources. `AURORA_USER` and `AURORA_PASSWORD` are ECS secrets sourced directly from the RDS-managed Secrets Manager secret; their values must never be copied into Terraform variables, GitHub variables, build arguments, logs, or source files.

The ECS execution role receives only `secretsmanager:GetSecretValue` for the single Aurora managed-master secret. The application task role does not require Secrets Manager access because ECS injects these values before the container starts.

The Node database client uses a lazy bounded `pg` pool and parameterized queries. Transactions must use `BEGIN`, `COMMIT`, `ROLLBACK`, and always release the checked-out client. The browser must never receive database credentials or a direct Aurora connection path.

Before any live ECS revision receives the Aurora runtime contract, require all of the following to pass:

```bash
npm run lint
npm run typecheck
npm test
terraform -chdir=infra/aws/bootstrap validate
terraform -chdir=infra/aws/app validate
```

CI and Docker use npm 11.6.0 because npm 10.9.8 on Node 22 has reproduced the `Cannot read properties of null (reading 'edgesOut')` resolver failure. Do not bypass verification with `--force` or `--legacy-peer-deps`.

Do not apply a full Terraform plan while the unrelated CloudFront account-verification blocker is present. If the reviewed plan contains CloudFront creation or other unrelated changes, deploy the ECS task-definition revision independently and retain the preceding Supabase-backed revision for immediate rollback.

Until Phase 4 protected feature cutover is verified, keep the existing Supabase environment variables and Supabase application path intact. If Aurora runtime verification fails, redeploy the prior ECS task-definition revision; no Supabase source data should be deleted or modified as part of this rollback.

## Phase 4 verification gate

Current verification candidate branch: `feat/aws-native-phase-0-1`.

Code-complete Cognito/Aurora cutover checkpoint before the final staging smoke was commit:

```text
645a8c2ce5b59b84aebdbda72e61962d2c8e068d
```

AWS Infrastructure CI run `33955408326` completed successfully for that exact SHA. The gate included lint, TypeScript, the full Vitest suite, Terraform validation for both app and bootstrap, Terraform plan guard tests, the GitHub SSM execution contract, and a production Docker build. Do not treat a later code-changing commit as verified until the same gate passes on that later exact SHA.

### Staging deployment record

`AWS Staging Deploy` run `33957677252` completed successfully from branch `feat/aws-native-phase-0-1` at commit `a6b559f5d2a207964444d2251b89ab643b3a59d6`. That commit only added the Phase 4 verification documentation on top of the verified application SHA above.

The deployment produced and pushed this immutable ECR image:

```text
310356785722.dkr.ecr.ap-south-1.amazonaws.com/sea-n-shore:a6b559f5d2a207964444d2251b89ab643b3a59d6-33957677252
```

Image digest:

```text
sha256:8e97d15bbe4168bc24406328146ec6112bf905c6c5fac7dd17418b28480b1795
```

The ECS service `sea-n-shore-staging-web` in cluster `sea-n-shore-staging` was updated to task definition:

```text
arn:aws:ecs:ap-south-1:310356785722:task-definition/sea-n-shore-staging-web:5
```

The GitHub workflow waited for `aws ecs wait services-stable` and completed successfully. Deployment stability is therefore verified; real-user application smoke and post-smoke CloudWatch/Aurora evidence remain separate gates.

### Remaining Supabase references after protected cutover

Remaining references must be classified rather than assumed to be active protected-data dependencies:

- `src/features/feed/media.ts` uses the existing Supabase **Storage** bucket only. It does not read/write application rows or call Supabase RPCs. This is an intentional Phase 5 storage dependency and must be replaced by S3 before Supabase storage/session removal.
- `src/app/auth/callback/route.ts` remains as a dormant rollback/legacy Supabase OAuth callback. Current Cognito email/password authentication does not route protected user journeys through it, and Google sign-in remains hidden until Cognito federation is enabled. Do not use this route as evidence that protected application sessions still depend on Supabase.
- `src/lib/supabase/*` may remain for rollback, legacy callback support, generated database types, and the temporary storage adapter. These files must not be imported by protected application data/auth flows except the explicitly classified Phase 5 storage path above.

### Final staging verification required before declaring Phase 4 complete

Using a real migrated Cognito user, verify in staging:

1. sign in and resolve the permanent Sea N Shore profile UUID through `identity_accounts`;
2. Home feed read;
3. profile read and update;
4. follow and unfollow;
5. connection request, accept/decline/remove lifecycle;
6. notification read/mark-read;
7. supported post create/like/save/comment/vote mutations;
8. sign out, then confirm protected routes reject the cleared Cognito session.

For each mutation, confirm the corresponding Aurora row change directly and confirm no Supabase database/RPC write is required.

Run negative authorization checks for cross-user notification mutation, connection ownership, blocked interactions, and post/profile ownership. The automated repository/service suite must remain green, but the staging smoke is still required to prove the deployed application composition.

After the smoke, review CloudWatch application logs for repeating 5xx, Cognito authorization, identity mapping, Aurora connection, transaction, or SQL errors. Phase 4 is complete only when the live staging journey passes and the deployed application no longer depends on Supabase DB/RLS/RPC/session behavior.

### Rollback

If any staging smoke or authorization check fails, immediately redeploy the recorded previous ECS task definition/image. Do not modify DNS, delete Supabase data, remove Supabase infrastructure, or perform final delta sync as part of Phase 4 rollback.
