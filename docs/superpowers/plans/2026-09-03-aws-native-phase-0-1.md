# AWS-Native Backend Phase 0 + Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a reversible AWS-native foundation for Sea N Shore — source inventory, private Aurora PostgreSQL Serverless v2, Cognito, S3, SES preparation, CloudFront/WAF HTTPS staging, and validation tooling — without cutting the application off Supabase or mutating/deleting any Supabase data.

**Architecture:** Keep the current ECS/Fargate application and Supabase-backed runtime unchanged while adding AWS-native backend infrastructure in parallel. Aurora lives only in private database subnets, Cognito is provisioned but not yet wired into application auth, S3 is private-by-default, CloudFront provides an HTTPS staging edge in front of the existing ALB, and WAF protects the CloudFront distribution. Phase 0 records a reproducible, non-PII source baseline; Phase 1 creates infrastructure only and ends with a no-cutover verification gate.

**Tech Stack:** Terraform 1.10.5, HashiCorp AWS provider `~> 6.0`, AWS ECS/Fargate, Aurora PostgreSQL Serverless v2, Cognito User Pools, S3, SES v2, Secrets Manager, CloudFront, WAF v2, CloudWatch, Node 22, Vitest, Bash, PostgreSQL SQL.

**Spec:** `docs/superpowers/specs/2026-09-03-aws-native-backend-migration-design.md`

## Global Constraints

- Primary AWS region remains `ap-south-1` (Mumbai).
- Preserve every existing Sea N Shore application UUID exactly.
- Supabase remains the source of truth throughout Phase 0 and Phase 1.
- Do not mutate, delete, disable, or make Supabase read-only in this plan.
- Do not remove any Supabase package, environment variable, auth flow, RLS policy, RPC, table, or storage configuration in this plan.
- Do not change production `seaandshore.in` DNS.
- Do not require a custom domain for Phase 1; CloudFront's AWS-managed HTTPS hostname is the staging edge.
- Aurora must not be publicly reachable.
- Browsers must never receive database credentials or AWS credentials.
- Continue GitHub-to-AWS authentication through OIDC; do not create long-lived AWS access keys.
- Sensitive values must not be committed to Git, printed in CI logs, or pasted into chat.
- Existing ECS/ALB behavior must remain available as rollback while the AWS-native foundation is being built.
- No phase is complete merely because Terraform applies successfully; verification and rollback checks are mandatory.

---

## File Structure Locked for This Plan

**Create**

- `scripts/aws/check-terraform-plan.mjs` — rejects destructive Terraform plans and unsafe public RDS instances.
- `scripts/aws/check-terraform-plan.test.mjs` — Vitest coverage for the plan guard.
- `scripts/migration/supabase_inventory.sql` — read-only schema/RLS/function/trigger/storage/auth-count inventory.
- `scripts/migration/supabase_integrity.sql` — read-only row-count and UUID/key digests for migration baselines.
- `scripts/migration/capture_source_baseline.sh` — runs the two SQL files against an operator-supplied PostgreSQL connection and writes local artifacts only.
- `infra/aws/app/aws-native-variables.tf` — Phase 1 variables.
- `infra/aws/app/providers-aws-native.tf` — `us-east-1` provider alias required by CloudFront-scope WAF.
- `infra/aws/app/network-private.tf` — private DB subnets, route table, DB subnet group, Aurora security group.
- `infra/aws/app/database.tf` — Aurora PostgreSQL Serverless v2 and RDS-managed master secret.
- `infra/aws/app/storage.tf` — private media, private documents, and migration-backup S3 buckets.
- `infra/aws/app/edge.tf` — CloudFront HTTPS staging distribution and WAF.
- `infra/aws/app/auth.tf` — Cognito user pool, domain, app client, Google provider secret container, optional Google IdP.
- `infra/aws/app/email.tf` — SES v2 configuration set only; no production sender cutover.
- `infra/aws/app/aws-native-outputs.tf` — Phase 1 outputs and operator-facing callback URLs.
- `docs/migration/aws-native-phase-0-1-runbook.md` — exact apply, verification, Google-secret, and rollback procedure.

**Modify**

- `.gitignore` — ignore Terraform state/plans/local tfvars and local migration artifacts while keeping lockfiles trackable.
- `.github/workflows/aws-infra-ci.yml` — validate AWS infrastructure changes on any branch/PR touching `infra/aws/**`.
- `infra/aws/app/terraform.tfvars.example` — document non-secret Phase 1 variables and safe defaults.

**Generate and commit**

- `infra/aws/bootstrap/.terraform.lock.hcl`
- `infra/aws/app/.terraform.lock.hcl`

Do not split or refactor the existing `infra/aws/app/main.tf` in this plan. New infrastructure references its existing `local.name_prefix`, `local.common_tags`, VPC, ALB, ECS security group, and AWS account data.

---

### Task 1: Terraform Safety, Reproducibility, and CI Guard

**Files:**
- Modify: `.gitignore`
- Create: `scripts/aws/check-terraform-plan.mjs`
- Create: `scripts/aws/check-terraform-plan.test.mjs`
- Modify: `.github/workflows/aws-infra-ci.yml`
- Generate: `infra/aws/bootstrap/.terraform.lock.hcl`
- Generate: `infra/aws/app/.terraform.lock.hcl`

**Interfaces:**
- Consumes: Terraform JSON plan from `terraform show -json tfplan`.
- Produces: `node scripts/aws/check-terraform-plan.mjs plan.json`, exit `0` only when no delete/replace action exists and no `aws_rds_cluster_instance` is public.

- [ ] **Step 1: Write the failing Vitest tests for the Terraform plan guard**

Create `scripts/aws/check-terraform-plan.test.mjs`:

```js
import { describe, expect, it } from 'vitest'
import { evaluateTerraformPlan } from './check-terraform-plan.mjs'

const base = {
  format_version: '1.2',
  resource_changes: [],
}

describe('evaluateTerraformPlan', () => {
  it('accepts additive and in-place changes', () => {
    const result = evaluateTerraformPlan({
      ...base,
      resource_changes: [
        { address: 'aws_s3_bucket.media', change: { actions: ['create'], after: {} } },
        { address: 'aws_ecs_service.web', change: { actions: ['update'], after: {} } },
      ],
    })
    expect(result.errors).toEqual([])
  })

  it('rejects deletes and replacements', () => {
    const result = evaluateTerraformPlan({
      ...base,
      resource_changes: [
        { address: 'aws_vpc.app', change: { actions: ['delete'], after: null } },
        { address: 'aws_lb.app', change: { actions: ['delete', 'create'], after: {} } },
      ],
    })
    expect(result.errors).toEqual([
      'Destructive action on aws_vpc.app: delete',
      'Destructive action on aws_lb.app: delete,create',
    ])
  })

  it('rejects a publicly accessible RDS cluster instance', () => {
    const result = evaluateTerraformPlan({
      ...base,
      resource_changes: [
        {
          address: 'aws_rds_cluster_instance.aurora_writer',
          type: 'aws_rds_cluster_instance',
          change: { actions: ['create'], after: { publicly_accessible: true } },
        },
      ],
    })
    expect(result.errors).toEqual([
      'Unsafe RDS instance aws_rds_cluster_instance.aurora_writer: publicly_accessible=true',
    ])
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail because the guard does not exist**

Run:

```bash
npm test -- scripts/aws/check-terraform-plan.test.mjs
```

Expected: FAIL because `./check-terraform-plan.mjs` cannot be imported.

- [ ] **Step 3: Implement the minimal plan guard**

Create `scripts/aws/check-terraform-plan.mjs`:

```js
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

export function evaluateTerraformPlan(plan) {
  const errors = []

  for (const resource of plan.resource_changes ?? []) {
    const actions = resource.change?.actions ?? []
    if (actions.includes('delete')) {
      errors.push(`Destructive action on ${resource.address}: ${actions.join(',')}`)
    }

    if (
      resource.type === 'aws_rds_cluster_instance' &&
      resource.change?.after?.publicly_accessible === true
    ) {
      errors.push(
        `Unsafe RDS instance ${resource.address}: publicly_accessible=true`,
      )
    }
  }

  return { errors }
}

function main() {
  const path = process.argv[2]
  if (!path) {
    console.error('Usage: node scripts/aws/check-terraform-plan.mjs <plan.json>')
    process.exit(2)
  }

  const plan = JSON.parse(fs.readFileSync(path, 'utf8'))
  const { errors } = evaluateTerraformPlan(plan)
  if (errors.length > 0) {
    for (const error of errors) console.error(error)
    process.exit(1)
  }
  console.log('Terraform plan guard passed: no destructive actions or public RDS instances.')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
npm test -- scripts/aws/check-terraform-plan.test.mjs
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Harden `.gitignore` without ignoring Terraform lockfiles**

Append exactly:

```gitignore
# Terraform local state and secrets
**/.terraform/
**/*.tfstate
**/*.tfstate.*
**/*.tfplan
**/tfplan
**/terraform.tfvars
**/terraform.tfvars.json
crash.log
crash.*.log

# Local migration evidence; upload backups to the dedicated private S3 bucket instead
artifacts/migration/
```

Do **not** add `.terraform.lock.hcl` to `.gitignore`.

- [ ] **Step 6: Update infrastructure CI to run on every relevant branch and run the unit guard tests**

Change the workflow trigger so `push` has no branch restriction and retains the existing path filter. Keep the `pull_request` target `main`. Add after checkout/setup as an independent job or existing container job:

```yaml
      - name: Terraform plan guard unit tests
        run: npm install && npm test -- scripts/aws/check-terraform-plan.test.mjs
```

Keep Terraform `fmt`, `init -backend=false`, and `validate` for both bootstrap and app directories.

- [ ] **Step 7: Generate provider lockfiles with the pinned Terraform version**

Run:

```bash
export PATH="$HOME/bin:$PATH"
terraform version
cd infra/aws/bootstrap && terraform init -backend=false && cd ../../..
cd infra/aws/app && terraform init -backend=false && cd ../../..
```

Expected Terraform CLI: `1.10.5`.

Stage both generated `.terraform.lock.hcl` files.

- [ ] **Step 8: Run full local verification**

```bash
npm run lint
npm run typecheck
npm test
terraform fmt -check -recursive infra/aws
(cd infra/aws/bootstrap && terraform validate)
(cd infra/aws/app && terraform validate)
```

Expected: all commands exit `0`.

- [ ] **Step 9: Commit**

```bash
git add .gitignore .github/workflows/aws-infra-ci.yml \
  scripts/aws/check-terraform-plan.mjs scripts/aws/check-terraform-plan.test.mjs \
  infra/aws/bootstrap/.terraform.lock.hcl infra/aws/app/.terraform.lock.hcl
git commit -m "chore: harden AWS migration safety checks"
```

---

### Task 2: Phase 0 Supabase Source Inventory and Integrity Baseline

**Files:**
- Create: `scripts/migration/supabase_inventory.sql`
- Create: `scripts/migration/supabase_integrity.sql`
- Create: `scripts/migration/capture_source_baseline.sh`
- Create: `docs/migration/aws-native-phase-0-1-runbook.md`

**Interfaces:**
- Consumes: PostgreSQL connection URI supplied only through `SOURCE_DATABASE_URL` in the operator shell.
- Produces: local `artifacts/migration/source-inventory.txt` and `artifacts/migration/source-integrity.txt`; neither is committed.

- [ ] **Step 1: Create a read-only inventory query**

Create `scripts/migration/supabase_inventory.sql` with these statements:

```sql
\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;

SELECT 'table' AS object_type, table_schema, table_name
FROM information_schema.tables
WHERE table_schema IN ('public', 'auth', 'storage')
  AND table_type = 'BASE TABLE'
ORDER BY table_schema, table_name;

SELECT 'column' AS object_type,
       table_schema,
       table_name,
       ordinal_position,
       column_name,
       data_type,
       is_nullable,
       column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;

SELECT 'constraint' AS object_type,
       n.nspname AS schema_name,
       c.relname AS table_name,
       con.conname AS constraint_name,
       pg_get_constraintdef(con.oid, true) AS definition
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
ORDER BY c.relname, con.conname;

SELECT 'index' AS object_type, schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

SELECT 'policy' AS object_type,
       schemaname,
       tablename,
       policyname,
       permissive,
       roles,
       cmd,
       qual,
       with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

SELECT 'function' AS object_type,
       n.nspname AS schema_name,
       p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY p.proname, arguments;

SELECT 'trigger' AS object_type,
       n.nspname AS schema_name,
       c.relname AS table_name,
       t.tgname AS trigger_name,
       pg_get_triggerdef(t.oid, true) AS definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;

SELECT 'storage_bucket' AS object_type, id, name, public
FROM storage.buckets
ORDER BY id;

SELECT 'storage_object_count' AS object_type, bucket_id, count(*) AS object_count
FROM storage.objects
GROUP BY bucket_id
ORDER BY bucket_id;

SELECT 'auth_user_summary' AS object_type,
       count(*) AS user_count,
       md5(coalesce(string_agg(id::text, ',' ORDER BY id), '')) AS user_uuid_digest
FROM auth.users;

COMMIT;
```

This query does not select password hashes, tokens, emails, phone numbers, or profile free-text data.

- [ ] **Step 2: Create deterministic application-table integrity queries**

Create `scripts/migration/supabase_integrity.sql`:

```sql
\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;

WITH target_tables(table_name) AS (
  VALUES
    ('profiles'),
    ('maritime_profiles'),
    ('posts'),
    ('post_comments'),
    ('post_media'),
    ('post_polls'),
    ('post_poll_options'),
    ('post_poll_votes'),
    ('post_reactions'),
    ('saved_posts'),
    ('follows'),
    ('connections'),
    ('notifications'),
    ('profile_skills'),
    ('user_blocks'),
    ('user_roles'),
    ('companies'),
    ('company_members'),
    ('audit_events')
)
SELECT t.table_name,
       (xpath('/row/count/text()', query_to_xml(
          format('SELECT count(*) AS count FROM public.%I', t.table_name),
          false, true, ''
       )))[1]::text::bigint AS row_count
FROM target_tables t
ORDER BY t.table_name;

SELECT 'profiles' AS relation,
       count(*) AS row_count,
       md5(coalesce(string_agg(id::text, ',' ORDER BY id), '')) AS key_digest
FROM public.profiles
UNION ALL
SELECT 'posts', count(*), md5(coalesce(string_agg(id::text || ':' || author_id::text, ',' ORDER BY id), ''))
FROM public.posts
UNION ALL
SELECT 'follows', count(*), md5(coalesce(string_agg(follower_id::text || ':' || following_id::text, ',' ORDER BY follower_id, following_id), ''))
FROM public.follows
UNION ALL
SELECT 'connections', count(*), md5(coalesce(string_agg(id::text || ':' || user_low_id::text || ':' || user_high_id::text || ':' || coalesce(requested_by::text, '') || ':' || status::text, ',' ORDER BY id), ''))
FROM public.connections
UNION ALL
SELECT 'notifications', count(*), md5(coalesce(string_agg(id::text || ':' || recipient_id::text || ':' || coalesce(actor_id::text, ''), ',' ORDER BY id), ''))
FROM public.notifications
UNION ALL
SELECT 'post_reactions', count(*), md5(coalesce(string_agg(post_id::text || ':' || user_id::text || ':' || reaction::text, ',' ORDER BY post_id, user_id), ''))
FROM public.post_reactions
UNION ALL
SELECT 'user_roles', count(*), md5(coalesce(string_agg(user_id::text || ':' || role::text, ',' ORDER BY user_id, role), ''))
FROM public.user_roles;

COMMIT;
```

If live schema inspection shows a column name differs (`status`, `reaction`, or `role`), fix the SQL to the exact live column before running; do not weaken or omit the digest.

- [ ] **Step 3: Create the baseline capture shell script**

Create `scripts/migration/capture_source_baseline.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

: "${SOURCE_DATABASE_URL:?Set SOURCE_DATABASE_URL in your local shell; never commit it.}"

mkdir -p artifacts/migration
umask 077

psql "$SOURCE_DATABASE_URL" -X -f scripts/migration/supabase_inventory.sql \
  > artifacts/migration/source-inventory.txt
psql "$SOURCE_DATABASE_URL" -X -f scripts/migration/supabase_integrity.sql \
  > artifacts/migration/source-integrity.txt

sha256sum artifacts/migration/source-inventory.txt \
  artifacts/migration/source-integrity.txt \
  > artifacts/migration/SHA256SUMS

printf 'Baseline written under artifacts/migration/ (gitignored).\n'
```

Make it executable:

```bash
chmod 700 scripts/migration/capture_source_baseline.sh
```

- [ ] **Step 4: Add the Phase 0/1 operator runbook**

Create `docs/migration/aws-native-phase-0-1-runbook.md` with these non-negotiable sections and commands:

```markdown
# AWS-Native Phase 0 + Phase 1 Runbook

## Safety
Supabase remains live and writable. This runbook never deletes or changes Supabase.

## Source baseline
Export `SOURCE_DATABASE_URL` only in the operator shell, run:

```bash
./scripts/migration/capture_source_baseline.sh
```

Expected sanity before migration work: approximately 7 profiles, 11 posts, 7 follows, 6 connections, and 10 notifications. Live query output is authoritative.

## Terraform state
Use the existing remote state bucket and key:
`sea-n-shore/staging/terraform.tfstate` in `ap-south-1`.

## Plan safety
Always run:

```bash
terraform plan -out=tfplan
terraform show -json tfplan > plan.json
node ../../../scripts/aws/check-terraform-plan.mjs plan.json
```

Do not apply if the guard fails or if the plan proposes replacement of existing VPC, ALB, ECS cluster, ECS service, ECR repository, or IAM/OIDC bootstrap resources.

## Supabase rollback
No rollback action is required during Phase 0/1 because the application remains Supabase-backed. Destroy only newly added Phase 1 resources if rollback is explicitly approved.
```

- [ ] **Step 5: Run the baseline against the current Supabase source**

Use a database URI obtained through the operator's Supabase dashboard/approved secret channel. Do not paste it into chat or commit it.

```bash
SOURCE_DATABASE_URL='postgresql://...from-approved-secret-channel...' \
  ./scripts/migration/capture_source_baseline.sh
cat artifacts/migration/source-integrity.txt
```

Expected: read-only queries complete. Current live counts should be in the same order of magnitude as the known sanity counts; investigate any unexpected zero/missing table before proceeding.

- [ ] **Step 6: Commit only scripts and runbook, never baseline output**

```bash
git add scripts/migration docs/migration/aws-native-phase-0-1-runbook.md
git status --short
```

Verify `artifacts/migration/` is absent from staged files, then:

```bash
git commit -m "chore: add Supabase migration baseline tooling"
```

---

### Task 3: Private Database Network and Aurora PostgreSQL Serverless v2

**Files:**
- Create: `infra/aws/app/aws-native-variables.tf`
- Create: `infra/aws/app/network-private.tf`
- Create: `infra/aws/app/database.tf`
- Modify: `infra/aws/app/terraform.tfvars.example`

**Interfaces:**
- Consumes: existing `aws_vpc.app`, `aws_security_group.ecs`, `data.aws_availability_zones.available`, `local.name_prefix`, `local.common_tags`.
- Produces: private DB subnet group, `aws_rds_cluster.aurora`, `aws_rds_cluster_instance.aurora_writer`, RDS-managed master secret ARN.

- [ ] **Step 1: Add required Phase 1 variables**

Create `infra/aws/app/aws-native-variables.tf`:

```hcl
variable "aurora_engine_version" {
  description = "Aurora PostgreSQL 16.x engine version verified as available for db.serverless in ap-south-1."
  type        = string

  validation {
    condition     = can(regex("^16\\.", var.aurora_engine_version))
    error_message = "aurora_engine_version must be an Aurora PostgreSQL 16.x version."
  }
}

variable "aurora_min_acu" {
  description = "Minimum Aurora Serverless v2 ACUs for staging. Zero enables supported auto-pause."
  type        = number
  default     = 0
}

variable "aurora_max_acu" {
  description = "Maximum Aurora Serverless v2 ACUs for staging."
  type        = number
  default     = 2
}

variable "aurora_auto_pause_seconds" {
  description = "Idle seconds before Aurora Serverless v2 auto-pauses when min ACU is zero."
  type        = number
  default     = 900
}

variable "enable_google_identity_provider" {
  description = "Enable the Cognito Google identity provider after the Google OAuth secret has been populated in Secrets Manager."
  type        = bool
  default     = false
}
```

- [ ] **Step 2: Discover and verify the exact Aurora 16.x engine version in Mumbai before setting tfvars**

Run:

```bash
AURORA_ENGINE_VERSION="$(
  aws rds describe-db-engine-versions \
    --region ap-south-1 \
    --engine aurora-postgresql \
    --query 'DBEngineVersions[?starts_with(EngineVersion, `16.`)].EngineVersion' \
    --output text | tr '\t' '\n' | sort -V | tail -1
)"

test -n "$AURORA_ENGINE_VERSION"
printf 'Selected Aurora PostgreSQL version: %s\n' "$AURORA_ENGINE_VERSION"

aws rds describe-orderable-db-instance-options \
  --region ap-south-1 \
  --engine aurora-postgresql \
  --engine-version "$AURORA_ENGINE_VERSION" \
  --db-instance-class db.serverless \
  --query 'length(OrderableDBInstanceOptions)' \
  --output text
```

Expected final output: integer greater than `0`. Because the selected version is PostgreSQL 16.x and current AWS support for scale-to-zero requires 16.3 or later, also verify:

```bash
python3 - "$AURORA_ENGINE_VERSION" <<'PY'
import sys
major, minor, *_ = map(int, sys.argv[1].split('.'))
assert (major, minor) >= (16, 3), sys.argv[1]
PY
```

Write the resulting exact version only into the local untracked `infra/aws/app/terraform.tfvars`.

- [ ] **Step 3: Add isolated private DB subnets**

Create `infra/aws/app/network-private.tf` with:

```hcl
resource "aws_subnet" "private_db_a" {
  vpc_id                  = aws_vpc.app.id
  cidr_block              = "10.40.30.0/24"
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = false
  tags = merge(local.common_tags, { Name = "${local.name_prefix}-private-db-a" })
}

resource "aws_subnet" "private_db_b" {
  vpc_id                  = aws_vpc.app.id
  cidr_block              = "10.40.40.0/24"
  availability_zone       = data.aws_availability_zones.available.names[1]
  map_public_ip_on_launch = false
  tags = merge(local.common_tags, { Name = "${local.name_prefix}-private-db-b" })
}

resource "aws_route_table" "private_db" {
  vpc_id = aws_vpc.app.id
  tags = merge(local.common_tags, { Name = "${local.name_prefix}-private-db" })
}

resource "aws_route_table_association" "private_db_a" {
  subnet_id      = aws_subnet.private_db_a.id
  route_table_id = aws_route_table.private_db.id
}

resource "aws_route_table_association" "private_db_b" {
  subnet_id      = aws_subnet.private_db_b.id
  route_table_id = aws_route_table.private_db.id
}

resource "aws_db_subnet_group" "aurora" {
  name       = "${local.name_prefix}-aurora"
  subnet_ids = [aws_subnet.private_db_a.id, aws_subnet.private_db_b.id]
  tags       = local.common_tags
}

resource "aws_security_group" "aurora" {
  name        = "${local.name_prefix}-aurora"
  description = "Aurora PostgreSQL reachable only from Sea N Shore ECS tasks"
  vpc_id      = aws_vpc.app.id

  ingress {
    description     = "PostgreSQL from ECS"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, { Name = "${local.name_prefix}-aurora" })
}
```

There is intentionally no internet route on `aws_route_table.private_db`.

- [ ] **Step 4: Add Aurora with AWS-managed master password**

Create `infra/aws/app/database.tf`:

```hcl
resource "aws_cloudwatch_log_group" "aurora_postgresql" {
  name              = "/aws/rds/cluster/${local.name_prefix}-aurora/postgresql"
  retention_in_days = 14
  tags              = local.common_tags
}

resource "aws_rds_cluster" "aurora" {
  cluster_identifier = "${local.name_prefix}-aurora"
  engine             = "aurora-postgresql"
  engine_version     = var.aurora_engine_version
  database_name      = "sea_n_shore"
  master_username    = "sns_cluster_admin"

  manage_master_user_password = true
  storage_encrypted           = true
  db_subnet_group_name        = aws_db_subnet_group.aurora.name
  vpc_security_group_ids      = [aws_security_group.aurora.id]

  backup_retention_period      = 7
  preferred_backup_window      = "18:00-19:00"
  preferred_maintenance_window = "sun:19:30-sun:20:30"
  copy_tags_to_snapshot        = true
  deletion_protection          = true
  skip_final_snapshot          = true

  enabled_cloudwatch_logs_exports = ["postgresql"]

  serverlessv2_scaling_configuration {
    min_capacity             = var.aurora_min_acu
    max_capacity             = var.aurora_max_acu
    seconds_until_auto_pause = var.aurora_auto_pause_seconds
  }

  depends_on = [aws_cloudwatch_log_group.aurora_postgresql]
  tags       = local.common_tags
}

resource "aws_rds_cluster_instance" "aurora_writer" {
  identifier         = "${local.name_prefix}-aurora-writer"
  cluster_identifier = aws_rds_cluster.aurora.id
  instance_class     = "db.serverless"
  engine             = aws_rds_cluster.aurora.engine
  engine_version     = aws_rds_cluster.aurora.engine_version

  publicly_accessible = false

  tags = local.common_tags
}
```

Do not grant the ECS task role access to the RDS master secret in this phase.

- [ ] **Step 5: Extend `terraform.tfvars.example` with safe Phase 1 values**

Append:

```hcl
aurora_engine_version          = "16.3" # operator must replace with the exact verified 16.x version before apply
aurora_min_acu                 = 0
aurora_max_acu                 = 2
aurora_auto_pause_seconds      = 900
enable_google_identity_provider = false
```

The example's `16.3` is documentation-only; the operator must use the discovery command before staging apply.

- [ ] **Step 6: Format, validate, plan, and run the safety guard**

```bash
cd infra/aws/app
terraform fmt
terraform validate
terraform plan -out=tfplan
terraform show -json tfplan > plan.json
node ../../../scripts/aws/check-terraform-plan.mjs plan.json
```

Expected: guard passes; existing VPC/ALB/ECS resources show no delete/replace actions; new DB subnets, DB subnet group, Aurora SG, cluster, and one `db.serverless` instance are additive.

- [ ] **Step 7: Commit**

```bash
git add infra/aws/app/aws-native-variables.tf infra/aws/app/network-private.tf \
  infra/aws/app/database.tf infra/aws/app/terraform.tfvars.example
git commit -m "feat: add private Aurora staging foundation"
```

---

### Task 4: Private S3 Foundation and Migration Backup Bucket

**Files:**
- Create: `infra/aws/app/storage.tf`

**Interfaces:**
- Consumes: `data.aws_caller_identity.current`, `local.name_prefix`, `local.common_tags`.
- Produces: three private/versioned/encrypted buckets: media, private documents, migration backup.

- [ ] **Step 1: Add the three S3 buckets**

Create `infra/aws/app/storage.tf` using this pattern for each bucket:

```hcl
locals {
  media_bucket_name     = "${var.project_name}-${var.environment}-${data.aws_caller_identity.current.account_id}-media"
  documents_bucket_name = "${var.project_name}-${var.environment}-${data.aws_caller_identity.current.account_id}-private"
  migration_bucket_name = "${var.project_name}-${var.environment}-${data.aws_caller_identity.current.account_id}-migration"
}

resource "aws_s3_bucket" "media" {
  bucket        = local.media_bucket_name
  force_destroy = false
  tags          = local.common_tags
}

resource "aws_s3_bucket" "private_documents" {
  bucket        = local.documents_bucket_name
  force_destroy = false
  tags          = local.common_tags
}

resource "aws_s3_bucket" "migration_backup" {
  bucket        = local.migration_bucket_name
  force_destroy = false
  tags          = local.common_tags
}
```

For **each** bucket add:

```hcl
resource "aws_s3_bucket_public_access_block" "..." {
  bucket                  = aws_s3_bucket....id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "..." {
  bucket = aws_s3_bucket....id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "..." {
  bucket = aws_s3_bucket....id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
```

For `migration_backup` additionally add a lifecycle rule that aborts incomplete multipart uploads after 7 days but does **not** expire completed backup objects.

- [ ] **Step 2: Validate no bucket is public**

```bash
terraform fmt
terraform validate
terraform plan -out=tfplan
terraform show -json tfplan > plan.json
node ../../../scripts/aws/check-terraform-plan.mjs plan.json
```

Inspect plan and verify every new `aws_s3_bucket_public_access_block` has all four flags set `true`.

- [ ] **Step 3: Commit**

```bash
git add infra/aws/app/storage.tf
git commit -m "feat: add private AWS storage foundation"
```

---

### Task 5: CloudFront HTTPS Staging Edge and WAF

**Files:**
- Create: `infra/aws/app/providers-aws-native.tf`
- Create: `infra/aws/app/edge.tf`

**Interfaces:**
- Consumes: existing `aws_lb.app.dns_name` and AWS account configuration.
- Produces: `https://<distribution>.cloudfront.net` staging edge, AWS-managed TLS certificate, WAF common rule set, per-IP rate limit.

- [ ] **Step 1: Add the `us-east-1` provider alias for CloudFront-scope WAF**

Create `infra/aws/app/providers-aws-native.tf`:

```hcl
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}
```

- [ ] **Step 2: Add CloudFront managed policy lookups**

At the top of `infra/aws/app/edge.tf`:

```hcl
data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}
```

- [ ] **Step 3: Add the CloudFront-scope WAF**

```hcl
resource "aws_wafv2_web_acl" "edge" {
  provider = aws.us_east_1
  name     = "${local.name_prefix}-edge"
  scope    = "CLOUDFRONT"

  default_action { allow {} }

  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 10
    override_action { none {} }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name_prefix}-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "PerIpRateLimit"
    priority = 20
    action { block {} }

    statement {
      rate_based_statement {
        aggregate_key_type    = "IP"
        evaluation_window_sec = 300
        limit                 = 2000
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name_prefix}-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.name_prefix}-edge"
    sampled_requests_enabled   = true
  }

  tags = local.common_tags
}
```

- [ ] **Step 4: Add CloudFront in front of the current ALB without changing the app URL yet**

```hcl
resource "aws_cloudfront_distribution" "app" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "Sea N Shore staging HTTPS edge"
  web_acl_id      = aws_wafv2_web_acl.edge.arn

  origin {
    domain_name = aws_lb.app.dns_name
    origin_id   = "sea-n-shore-staging-alb"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id       = "sea-n-shore-staging-alb"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
    minimum_protocol_version       = "TLSv1.2_2021"
  }

  tags = local.common_tags
}
```

Do not change `site_url`, Supabase redirects, or ECS environment variables in Phase 1.

- [ ] **Step 5: Validate and commit**

```bash
terraform fmt
terraform validate
terraform plan -out=tfplan
terraform show -json tfplan > plan.json
node ../../../scripts/aws/check-terraform-plan.mjs plan.json

git add infra/aws/app/providers-aws-native.tf infra/aws/app/edge.tf
git commit -m "feat: add CloudFront and WAF staging edge"
```

---

### Task 6: Cognito Foundation and Google Federation Toggle

**Files:**
- Create: `infra/aws/app/auth.tf`

**Interfaces:**
- Consumes: `aws_cloudfront_distribution.app.domain_name`, `var.enable_google_identity_provider`.
- Produces: Cognito user pool, app client, Cognito domain, Google OAuth secret container, optional Google identity provider.

- [ ] **Step 1: Create Cognito user pool and domain**

Create `infra/aws/app/auth.tf`:

```hcl
resource "aws_cognito_user_pool" "app" {
  name                     = "${local.name_prefix}-users"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  mfa_configuration        = "OFF"
  deletion_protection      = "ACTIVE"

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  admin_create_user_config {
    allow_admin_create_user_only = false
  }

  user_attribute_update_settings {
    attributes_require_verification_before_update = ["email"]
  }

  tags = local.common_tags
}

resource "aws_cognito_user_pool_domain" "app" {
  domain       = "${var.project_name}-${var.environment}-${data.aws_caller_identity.current.account_id}"
  user_pool_id = aws_cognito_user_pool.app.id
}
```

- [ ] **Step 2: Create the Secrets Manager container for Google OAuth credentials**

```hcl
resource "aws_secretsmanager_secret" "google_oauth" {
  name                    = "${local.name_prefix}/google-oauth"
  recovery_window_in_days = 7
  tags                    = local.common_tags
}

data "aws_secretsmanager_secret_version" "google_oauth" {
  count     = var.enable_google_identity_provider ? 1 : 0
  secret_id = aws_secretsmanager_secret.google_oauth.id
}

locals {
  google_oauth = var.enable_google_identity_provider
    ? jsondecode(data.aws_secretsmanager_secret_version.google_oauth[0].secret_string)
    : {}
}
```

The secret value, when supplied by the operator, must be JSON with exactly `client_id` and `client_secret` keys. It is never committed.

- [ ] **Step 3: Add conditional Google federation**

```hcl
resource "aws_cognito_identity_provider" "google" {
  count         = var.enable_google_identity_provider ? 1 : 0
  user_pool_id  = aws_cognito_user_pool.app.id
  provider_name = "Google"
  provider_type = "Google"

  provider_details = {
    authorize_scopes = "openid email profile"
    client_id        = local.google_oauth.client_id
    client_secret    = local.google_oauth.client_secret
  }

  attribute_mapping = {
    email    = "email"
    name     = "name"
    username = "sub"
  }
}
```

- [ ] **Step 4: Add an app client that supports Cognito now and Google when enabled**

```hcl
resource "aws_cognito_user_pool_client" "web" {
  name         = "${local.name_prefix}-web"
  user_pool_id = aws_cognito_user_pool.app.id

  generate_secret               = false
  prevent_user_existence_errors = "ENABLED"

  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]

  supported_identity_providers = var.enable_google_identity_provider ? ["COGNITO", "Google"] : ["COGNITO"]

  callback_urls = [
    "https://${aws_cloudfront_distribution.app.domain_name}/auth/callback",
  ]

  logout_urls = [
    "https://${aws_cloudfront_distribution.app.domain_name}/auth/sign-in",
  ]

  access_token_validity  = 60
  id_token_validity      = 60
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  depends_on = [aws_cognito_identity_provider.google]
}
```

- [ ] **Step 5: First Terraform plan must leave Google disabled**

Keep local `terraform.tfvars`:

```hcl
enable_google_identity_provider = false
```

Run validate and plan guard. This must create Cognito without requiring any Google secret.

- [ ] **Step 6: After the first infrastructure apply, populate the Google secret locally and enable federation**

Use the Cognito-domain output from Task 8 to configure the existing Google OAuth application's authorized redirect URI as:

```text
https://<cognito-domain-prefix>.auth.ap-south-1.amazoncognito.com/oauth2/idpresponse
```

Do not remove existing production Google redirect URIs.

In the operator shell only:

```bash
read -r -p 'Google OAuth client ID: ' GOOGLE_CLIENT_ID
read -r -s -p 'Google OAuth client secret: ' GOOGLE_CLIENT_SECRET
printf '\n'

GOOGLE_SECRET_ARN="$(terraform output -raw google_oauth_secret_arn)"
SECRET_JSON="$(jq -n \
  --arg client_id "$GOOGLE_CLIENT_ID" \
  --arg client_secret "$GOOGLE_CLIENT_SECRET" \
  '{client_id:$client_id,client_secret:$client_secret}')"

aws secretsmanager put-secret-value \
  --region ap-south-1 \
  --secret-id "$GOOGLE_SECRET_ARN" \
  --secret-string "$SECRET_JSON"

unset GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET SECRET_JSON
```

Then set only the local untracked tfvars flag:

```hcl
enable_google_identity_provider = true
```

Re-run plan and apply. Never print `data.aws_secretsmanager_secret_version.google_oauth.secret_string`.

- [ ] **Step 7: Commit Terraform only**

```bash
git add infra/aws/app/auth.tf
git commit -m "feat: add Cognito authentication foundation"
```

---

### Task 7: SES Preparation and AWS-Native Outputs

**Files:**
- Create: `infra/aws/app/email.tf`
- Create: `infra/aws/app/aws-native-outputs.tf`

**Interfaces:**
- Consumes: Phase 1 resources.
- Produces: SES configuration set, safe non-secret outputs required by later phases and operator verification.

- [ ] **Step 1: Add SES v2 configuration set without touching the production domain**

Create `infra/aws/app/email.tf`:

```hcl
resource "aws_sesv2_configuration_set" "transactional" {
  configuration_set_name = "${local.name_prefix}-transactional"

  sending_options {
    sending_enabled = true
  }

  suppression_options {
    suppressed_reasons = ["BOUNCE", "COMPLAINT"]
  }

  reputation_options {
    reputation_metrics_enabled = true
  }
}
```

Do not create an SES domain identity in this phase.

- [ ] **Step 2: Add safe outputs**

Create `infra/aws/app/aws-native-outputs.tf`:

```hcl
output "aurora_cluster_endpoint" {
  value = aws_rds_cluster.aurora.endpoint
}

output "aurora_database_name" {
  value = aws_rds_cluster.aurora.database_name
}

output "aurora_master_secret_arn" {
  value     = aws_rds_cluster.aurora.master_user_secret[0].secret_arn
  sensitive = true
}

output "media_bucket_name" {
  value = aws_s3_bucket.media.bucket
}

output "private_documents_bucket_name" {
  value = aws_s3_bucket.private_documents.bucket
}

output "migration_backup_bucket_name" {
  value = aws_s3_bucket.migration_backup.bucket
}

output "staging_cloudfront_domain" {
  value = aws_cloudfront_distribution.app.domain_name
}

output "staging_https_url" {
  value = "https://${aws_cloudfront_distribution.app.domain_name}"
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.app.id
}

output "cognito_web_client_id" {
  value = aws_cognito_user_pool_client.web.id
}

output "cognito_domain" {
  value = "${aws_cognito_user_pool_domain.app.domain}.auth.${var.aws_region}.amazoncognito.com"
}

output "cognito_google_redirect_uri" {
  value = "https://${aws_cognito_user_pool_domain.app.domain}.auth.${var.aws_region}.amazoncognito.com/oauth2/idpresponse"
}

output "google_oauth_secret_arn" {
  value = aws_secretsmanager_secret.google_oauth.arn
}

output "ses_configuration_set_name" {
  value = aws_sesv2_configuration_set.transactional.configuration_set_name
}
```

Do not output secret values or database passwords.

- [ ] **Step 3: Validate and commit**

```bash
terraform fmt
terraform validate
terraform plan -out=tfplan
terraform show -json tfplan > plan.json
node ../../../scripts/aws/check-terraform-plan.mjs plan.json

git add infra/aws/app/email.tf infra/aws/app/aws-native-outputs.tf
git commit -m "feat: add AWS email prep and migration outputs"
```

---

### Task 8: Phase 1 Apply, Backup Upload, Verification, and Stop Gate

**Files:**
- Modify: `docs/migration/aws-native-phase-0-1-runbook.md` only if execution reveals a verified command/output nuance; do not record secrets.

**Interfaces:**
- Consumes: committed Phase 0/1 Terraform and source baseline artifacts.
- Produces: live AWS foundation and a completed verification record. Does **not** cut over app auth or database access.

- [ ] **Step 1: Reconcile the EC2 working copy safely before applying**

The EC2 repo currently contains local Terraform artifacts and may have code divergence. Preserve local configuration first:

```bash
cd ~/SEA-N-SHORE-CODEX
mkdir -p "$HOME/sea-n-shore-local-config-backup"
cp -f infra/aws/app/terraform.tfvars "$HOME/sea-n-shore-local-config-backup/app.terraform.tfvars" 2>/dev/null || true
cp -f infra/aws/bootstrap/terraform.tfvars "$HOME/sea-n-shore-local-config-backup/bootstrap.terraform.tfvars" 2>/dev/null || true
cp -f infra/aws/bootstrap/backend.tf "$HOME/sea-n-shore-local-config-backup/bootstrap.backend.tf" 2>/dev/null || true

git fetch origin
git status --short
```

Do not run `git clean -fdx`. Do not delete remote Terraform state. Resolve any tracked local changes by comparing them with `origin/main` before reset/checkout.

- [ ] **Step 2: Initialize the app stack against the existing remote state**

```bash
export PATH="$HOME/bin:$PATH"
cd ~/SEA-N-SHORE-CODEX/infra/aws/app

terraform init -reconfigure \
  -backend-config="bucket=sea-n-shore-310356785722-ap-south-1-tfstate" \
  -backend-config="key=sea-n-shore/staging/terraform.tfstate" \
  -backend-config="region=ap-south-1" \
  -backend-config="use_lockfile=true"

terraform validate
terraform state list
```

Expected: existing VPC, ALB, ECS, IAM, autoscaling, and log resources are present in state before Phase 1 additions.

- [ ] **Step 3: Create and inspect the complete plan before apply**

```bash
terraform plan -out=tfplan
terraform show -json tfplan > plan.json
node ../../../scripts/aws/check-terraform-plan.mjs plan.json
terraform show tfplan
```

Stop if any existing resource is deleted/replaced or if the plan modifies Supabase configuration, current ECS image, current `site_url`, production DNS, or existing auth redirects.

- [ ] **Step 4: Apply Phase 1 foundation with Google disabled first**

```bash
terraform apply tfplan
```

Expected: additive creation of private DB network, Aurora, S3 buckets, CloudFront, WAF, Cognito base, Google secret container, SES configuration set, and outputs. Current ECS service remains stable.

- [ ] **Step 5: Upload the Phase 0 baseline evidence to the private migration bucket**

From repo root:

```bash
MIGRATION_BUCKET="$(cd infra/aws/app && terraform output -raw migration_backup_bucket_name)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

aws s3 cp artifacts/migration/source-inventory.txt \
  "s3://${MIGRATION_BUCKET}/phase-0/${STAMP}/source-inventory.txt" \
  --sse AES256
aws s3 cp artifacts/migration/source-integrity.txt \
  "s3://${MIGRATION_BUCKET}/phase-0/${STAMP}/source-integrity.txt" \
  --sse AES256
aws s3 cp artifacts/migration/SHA256SUMS \
  "s3://${MIGRATION_BUCKET}/phase-0/${STAMP}/SHA256SUMS" \
  --sse AES256
```

Verify:

```bash
aws s3 ls "s3://${MIGRATION_BUCKET}/phase-0/${STAMP}/"
```

- [ ] **Step 6: Verify private Aurora network posture**

```bash
CLUSTER_ID="sea-n-shore-staging-aurora"
aws rds describe-db-clusters \
  --region ap-south-1 \
  --db-cluster-identifier "$CLUSTER_ID" \
  --query 'DBClusters[0].{Status:Status,Encrypted:StorageEncrypted,DeletionProtection:DeletionProtection,Endpoint:Endpoint}'

aws rds describe-db-instances \
  --region ap-south-1 \
  --db-instance-identifier sea-n-shore-staging-aurora-writer \
  --query 'DBInstances[0].{Status:DBInstanceStatus,Public:PubliclyAccessible,Class:DBInstanceClass}'
```

Expected: cluster `available`, encrypted `true`, deletion protection `true`; writer `available`, `Public=false`, class `db.serverless`.

- [ ] **Step 7: Verify the HTTPS CloudFront edge while the existing ALB remains unchanged**

```bash
HTTPS_URL="$(terraform output -raw staging_https_url)"
printf '%s\n' "$HTTPS_URL"
curl -I "$HTTPS_URL/auth/sign-in"
```

Expected: browser-facing HTTPS response `200-399`. The raw ALB URL may remain available during this phase as rollback/testing path.

- [ ] **Step 8: Verify Cognito base and then enable Google federation**

```bash
aws cognito-idp describe-user-pool \
  --region ap-south-1 \
  --user-pool-id "$(terraform output -raw cognito_user_pool_id)" \
  --query 'UserPool.{Name:Name,DeletionProtection:DeletionProtection,Status:Status}'

terraform output -raw cognito_google_redirect_uri
```

After the Google OAuth application contains that redirect URI and the Secrets Manager JSON has been populated as described in Task 6, set `enable_google_identity_provider=true`, then:

```bash
terraform plan -out=tfplan-google
terraform show -json tfplan-google > plan-google.json
node ../../../scripts/aws/check-terraform-plan.mjs plan-google.json
terraform apply tfplan-google

aws cognito-idp describe-identity-provider \
  --region ap-south-1 \
  --user-pool-id "$(terraform output -raw cognito_user_pool_id)" \
  --provider-name Google \
  --query 'IdentityProvider.{ProviderName:ProviderName,ProviderType:ProviderType}'
```

Expected provider: `Google`, type `Google`.

- [ ] **Step 9: Verify no application cutover happened**

Check the current ECS task definition environment still contains the Supabase public configuration and the existing `NEXT_PUBLIC_SITE_URL` value:

```bash
TASK_DEF="$(terraform output -raw ecs_task_definition_family)"
aws ecs describe-task-definition \
  --region ap-south-1 \
  --task-definition "$TASK_DEF" \
  --query 'taskDefinition.containerDefinitions[?name==`web`].environment[]' \
  --output table
```

Expected: current Supabase URL/publishable configuration still exists; no Aurora secret/database endpoint or Cognito setting has been injected into the running application yet.

- [ ] **Step 10: Verify the current ECS service remains healthy**

```bash
aws ecs describe-services \
  --region ap-south-1 \
  --cluster sea-n-shore-staging \
  --services sea-n-shore-staging-web \
  --query 'services[0].{Status:status,Desired:desiredCount,Running:runningCount,Pending:pendingCount,Deployment:deployments[0].rolloutState}'
```

Expected: `ACTIVE`, desired `1`, running `1`, pending `0`, rollout state `COMPLETED`.

- [ ] **Step 11: Run repository CI checks one final time**

```bash
npm run lint
npm run typecheck
npm test
terraform fmt -check -recursive infra/aws
(cd infra/aws/bootstrap && terraform init -backend=false && terraform validate)
(cd infra/aws/app && terraform init -backend=false && terraform validate)
```

Expected: all green.

- [ ] **Step 12: Stop at the Phase 1 gate**

Do **not**:

- migrate application rows into Aurora yet,
- create Cognito mappings for the existing 7 users yet,
- modify the Next.js auth implementation yet,
- alter `NEXT_PUBLIC_SUPABASE_*` values yet,
- change production DNS,
- disable Supabase writes,
- remove any Supabase data, auth account, RLS policy, RPC, or storage bucket.

Phase 2 starts only after this checklist is reviewed and the live AWS foundation is confirmed healthy.

- [ ] **Step 13: Commit any runbook-only corrections discovered during verified execution**

If no correction is required, make no commit. If a command had to be corrected, commit only the verified documentation change:

```bash
git add docs/migration/aws-native-phase-0-1-runbook.md
git commit -m "docs: record verified AWS foundation procedure"
```

---

## Phase 0 + Phase 1 Acceptance Checklist

Before declaring this plan complete, all of the following must be true:

- [ ] Supabase is still the live application source of truth and has not been mutated by migration work.
- [ ] Source inventory and integrity evidence was captured and backed up privately to S3.
- [ ] Existing Sea N Shore app UUIDs were not changed.
- [ ] Existing VPC, ALB, ECS service, ECR repository, and OIDC deployment path were not replaced.
- [ ] Aurora PostgreSQL Serverless v2 is encrypted, private, and reachable only from the ECS security group on port 5432.
- [ ] Aurora master password is RDS-managed in Secrets Manager and is not exposed to the running application.
- [ ] S3 media, document, and migration buckets have public access blocked, versioning enabled, and server-side encryption enabled.
- [ ] CloudFront provides a working AWS-managed HTTPS staging URL without modifying `seaandshore.in` DNS.
- [ ] WAF is associated with CloudFront and has the common AWS managed rule set plus the approved per-IP rate limit.
- [ ] Cognito user pool/app client/domain exist with email/password capability.
- [ ] Google federation is either successfully enabled after the secret is populated, or the explicit blocker is the operator's Google OAuth credential/console step — never a hidden Terraform/app failure.
- [ ] SES configuration set exists, but no production sender/domain cutover has occurred.
- [ ] Current ECS service remains healthy and still uses the existing Supabase runtime configuration.
- [ ] Terraform plan guard reports no destructive actions.
- [ ] Repository lint, typecheck, tests, Terraform fmt, and Terraform validate all pass.

## Rollback for This Plan

Because the running app remains Supabase-backed, application rollback is unnecessary in Phase 0/1. If AWS-native foundation resources need to be removed, first disable Cognito deletion protection and Aurora deletion protection **only after explicit approval**, then destroy only the newly introduced Phase 1 resources. Do not destroy the existing VPC/ALB/ECS/ECR/OIDC resources and do not touch Supabase.
