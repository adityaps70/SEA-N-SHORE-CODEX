# AWS Migration Rollback and Restore Runbook

This runbook is for the migration period before Sea N Shore production DNS leaves Vercel/Supabase.

## Safety posture

- Vercel/Supabase remains the production rollback path until AWS production cutover is verified and the rollback window expires.
- Do not delete Supabase, Vercel projects, old DNS records, or source data during the observation window.
- Do not use this runbook as authorization for a DNS change.

## Application rollback

1. Record the current ECS service task definition and deployment state.
2. Identify the immediately previous known-good task definition revision for the same family.
3. Confirm its image digest/tag still exists in ECR.
4. If application rollback is required after an AWS deployment, update only the ECS service task definition to the known-good revision.
5. Wait for desired/running/pending to return to the expected stable state and rollout state `COMPLETED`.
6. Verify `/api/health/phase4`, `/api/health/home`, CloudFront HTTPS, WAF behavior, and CloudWatch strong-error scan.

No production DNS rollback is required while the public production domain still points to Vercel.

## Aurora restore

Target posture in Terraform:

- storage encryption enabled;
- deletion protection enabled;
- automated backup retention: 7 days;
- copied tags on snapshots enabled.

Before production cutover, capture a named manual snapshot in addition to automated backups. A restore rehearsal should restore to a separate temporary cluster, never overwrite the active staging/production cluster, and verify table counts plus application-compatible schema before deletion of the rehearsal cluster.

## S3 restore

Application S3 buckets are configured with:

- public access blocked;
- versioning enabled;
- server-side encryption enabled;
- `force_destroy = false`.

Restore an accidentally changed/deleted object by selecting the prior S3 object version. Never delete source Supabase Storage during the migration rollback window.

## Data rollback boundary

Before final production DNS cutover:

- Supabase remains the authoritative legacy source for writes made by current production users.
- Aurora may contain migrated/staging data and must not be treated as the sole production source until final delta reconciliation passes.

At cutover:

1. establish the agreed write-freeze/maintenance boundary;
2. capture final Supabase source baseline;
3. run final delta migration;
4. run `reconcile-postgres.mjs` and storage reconciliation;
5. verify Cognito identity mapping separately;
6. snapshot Aurora;
7. only then move production traffic.

If AWS production verification fails during the rollback window, restore production DNS to the retained Vercel endpoint and keep Supabase unchanged. Reconcile any AWS-only writes before another cutover attempt.

## Exit criteria for retiring the legacy rollback path

- AWS production traffic stable through observation window;
- final database reconciliation has zero unresolved missing source keys;
- storage reconciliation has zero missing/mismatched production objects;
- Cognito identity mapping reconciled;
- Aurora backup/restore rehearsal evidenced;
- S3 version recovery evidenced;
- CloudFront/WAF/ALB health verified;
- SES/Cognito email cutover verified;
- rollback decision owner signs off.
