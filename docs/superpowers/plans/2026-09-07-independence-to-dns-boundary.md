# Sea N Shore Independence-to-DNS-Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push the AWS migration to the maximum safe Supabase/Vercel independence possible without external DNS help, while preserving the current production stack for rollback.

**Architecture:** The AWS staging path remains the target runtime: Cognito for auth, Aurora PostgreSQL for application data, S3 for media, ECS/ALB for compute, CloudFront/WAF for edge, CloudWatch for observability, and GitHub Actions/Terraform for delivery. Legacy Supabase/Vercel assets remain source-of-truth or rollback-only until final production cutover; migration tooling is strictly read-only against source data unless a separately reviewed cutover action is invoked.

**Tech Stack:** Next.js 16, Node 22, PostgreSQL/Aurora, Cognito, S3, ECS/Fargate, ALB, CloudFront, WAF, CloudWatch, Terraform 1.10.5, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-03-aws-native-backend-migration-design.md`

## Global Constraints

- Branch only: `feat/aws-native-phase-0-1`.
- Do not modify `main`, merge, or create a PR.
- No production DNS or nameserver changes.
- No Vercel or Supabase shutdown/deletion.
- No destructive writes to Supabase production data.
- No Cognito-to-SES cutover until DKIM is verified and SES production access is approved.
- No full application Terraform apply while a narrower/read-only path can prove the required state.
- Preserve current production Vercel/Supabase as rollback until AWS production cutover is verified.
- Origin HTTPS stops at the external DNS/ACM validation boundary.

---

### Task 1: Remove package-level Supabase runtime/tooling dependency from the AWS branch

**Files:**
- Modify: `package.json`
- Modify: `scripts/aws/check-phase4-supabase-runtime.sh`
- Modify: `.github/workflows/aws-infra-ci.yml`

**Interfaces:**
- Consumes: existing AWS-native repositories under `src/features/**` and AWS runtime guard.
- Produces: a branch that cannot silently reintroduce Supabase application packages or Vercel runtime configuration.

- [ ] Remove `@supabase/ssr`, `@supabase/supabase-js`, the Supabase CLI dependency, and the `test:db` package script after confirming no application source imports them.
- [ ] Extend the runtime guard to fail if Supabase application packages return to `package.json`.
- [ ] Extend the guard to detect Vercel runtime/build dependencies while allowing documentation/migration-history references.
- [ ] Ensure AWS Infrastructure CI runs the guard whenever migration/independence files change.
- [ ] Verify exact-head AWS Infrastructure CI remains green.

### Task 2: Preserve Supabase schema history only as migration evidence

**Files:**
- Preserve: `supabase/migrations/**`
- Preserve: `supabase/tests/**`
- Preserve: `scripts/migration/supabase_inventory.sql`
- Preserve: `scripts/migration/supabase_integrity.sql`
- Create: `docs/migration/legacy-supabase-evidence.md`

**Interfaces:**
- Consumes: legacy Supabase schema and policies.
- Produces: explicit classification that these files are migration evidence, not AWS runtime dependencies.

- [ ] Document why the legacy tree remains until final reconciliation.
- [ ] State that no AWS build/runtime path may import or execute it.
- [ ] Record deletion criteria: successful final delta, orphan reconciliation, rollback expiration, and production sign-off.

### Task 3: Add reproducible source/target data reconciliation

**Files:**
- Create: `scripts/migration/reconcile-postgres.mjs`
- Create: `scripts/migration/reconcile-postgres.test.mjs`
- Create: `scripts/migration/reconciliation-manifest.json`

**Interfaces:**
- Consumes: `SOURCE_DATABASE_URL`, `TARGET_DATABASE_URL`, manifest of migrated tables and stable keys.
- Produces: JSON report containing row counts, missing IDs, extra IDs, duplicate stable keys, and deterministic per-table checksums where supported.

- [ ] Write tests around manifest validation, canonical row hashing, and mismatch classification.
- [ ] Implement read-only source/target queries with transaction-level read-only enforcement.
- [ ] Fail closed if either URL is missing or points to the same database.
- [ ] Emit machine-readable JSON plus a concise summary.
- [ ] Never mutate either database.

### Task 4: Add storage reconciliation

**Files:**
- Create: `scripts/migration/reconcile-storage.mjs`
- Create: `scripts/migration/reconcile-storage.test.mjs`

**Interfaces:**
- Consumes: exported Supabase storage inventory plus AWS S3 list/object metadata.
- Produces: missing/extra/size-mismatch report and migration retry list.

- [ ] Normalize object paths and metadata.
- [ ] Compare source inventory to S3 inventory without deleting objects.
- [ ] Produce retry manifest for missing/mismatched objects.
- [ ] Add tests for normalization and mismatch classification.

### Task 5: Harden rollback and restore evidence

**Files:**
- Create: `docs/migration/rollback-restore-runbook.md`
- Create: `scripts/aws/check-rollback-readiness.sh`

**Interfaces:**
- Consumes: ECS task definition history, Aurora backup/snapshot configuration, S3 versioning/backup state, current CloudFront distribution.
- Produces: a read-only readiness report and exact rollback sequence.

- [ ] Verify a previous ECS task definition can be identified without deployment.
- [ ] Verify Aurora automated backup/snapshot posture.
- [ ] Verify S3 recovery/versioning posture where configured.
- [ ] Document edge rollback separately from DNS rollback.
- [ ] Keep Vercel/Supabase rollback available until final production cutover.

### Task 6: Prepare origin TLS to the DNS boundary

**Files:**
- Modify only if necessary: `infra/aws/app/edge.tf`
- Create/modify tests under `scripts/aws/` as needed.

**Interfaces:**
- Consumes: proposed origin hostname `origin-staging.seaandshore.in`.
- Produces: reviewed Terraform/config path where the only unresolved input is externally validated ACM DNS.

- [ ] Keep current CloudFront/ALB traffic unchanged until certificate validation succeeds.
- [ ] Prepare certificate/listener/origin HTTPS configuration without applying unvalidated resources.
- [ ] Prove targeted plan safety.
- [ ] Stop at ACM DNS validation if external DNS is required.

### Task 7: Recalculate independence readiness

**Files:**
- Create/update: `docs/migration/independence-readiness.md`

**Interfaces:**
- Consumes: exact-head CI, runtime guard, reconciliation tooling, rollback evidence, DNS blockers.
- Produces: separate code/runtime independence and shutdown-readiness scores for Supabase and Vercel.

- [ ] Count only evidence-backed exit gates.
- [ ] Separate controllable remaining work from old-developer/DNS blockers.
- [ ] Do not call Supabase/Vercel removable until final production delta and rollback evidence are complete.
