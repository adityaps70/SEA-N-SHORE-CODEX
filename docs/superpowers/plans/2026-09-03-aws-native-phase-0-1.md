# AWS-Native Backend Phase 0 + Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a reversible AWS-native foundation for Sea N Shore — source inventory, private Aurora PostgreSQL Serverless v2, Cognito, S3, SES preparation, CloudFront/WAF HTTPS staging, and validation tooling — without cutting the application off Supabase or mutating/deleting any Supabase data.

**Architecture:** Keep the current ECS/Fargate application and Supabase-backed runtime unchanged while adding AWS-native backend infrastructure in parallel. Aurora lives only in private database subnets, Cognito is provisioned but not yet wired into application auth, S3 is private-by-default, and CloudFront provides an AWS-managed HTTPS staging hostname in front of the current ALB with WAF attached. Phase 0 records a reproducible non-PII source baseline; Phase 1 creates infrastructure only and ends at a no-cutover verification gate.

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
- Produces: `node scripts/aws/check-terraform-plan.mjs plan.json`; exit `0` only when no delete/replace action exists and no `aws_rds_cluster_instance` is public.

- [ ] **Step 1: Write the failing Vitest tests for the Terraform plan guard**

Create `scripts/aws/check-terraform-plan.test.mjs`:

```js
import { describe, expect, it } from 'vitest'
import { evaluateTerraformPlan } from './check-terraform-plan.mjs'

const base = { format_version: '1.2', resource_changes: [] }

describe('evaluateTerraformPlan', () => {
  it('accepts additive and in-place changes', () => {
    const result = evaluateTerraformPlan({
      ...base,
      resource_changes: [
        { address: 'aws_s3_bucket.app["media"]', type: 'aws_s3_bucket', change: { actions: ['create'], after: {} } },
        { address: 'aws_ecs_service.web', type: 'aws_ecs_service', change: { actions: ['update'], after: {} } },
      ],
    })
    expect(result.errors).toEqual([])
  })

  it('rejects deletes and replacements', () => {
    const result = evaluateTerraformPlan({
      ...base,
      resource_changes: [
        { address: 'aws_vpc.app', type: 'aws_vpc', change: { actions: ['delete'], after: null } },
        { address: 'aws_lb.app', type: 'aws_lb', change: { actions: ['delete', 'create'], after: {} } },
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
      errors.push(`Unsafe RDS instance ${resource.address}: publicly_accessible=true`)
    }
  }

  return { errors }
}

function main() {
  const inputPath = process.argv[2]
  if (!inputPath) {
    console.error('Usage: node scripts/aws/check-terraform-plan.mjs <plan.json>')
    process.exit(2)
  }

  const plan = JSON.parse(fs.readFileSync(inputPath, 'utf8'))
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
# Terraform local state, plans, generated plan JSON, and local variables
**/.terraform/
**/*.tfstate
**/*.tfstate.*
**/*.tfplan
**/tfplan
infra/aws/**/plan*.json
**/terraform.tfvars
**/terraform.tfvars.json
crash.log
crash.*.log

# Local migration evidence; upload backups to the dedicated private S3 bucket instead
artifacts/migration/
```

Do **not** add `.terraform.lock.hcl` to `.gitignore`.

- [ ] **Step 6: Update infrastructure CI to run on every relevant branch and run the guard unit tests**

Change `.github/workflows/aws-infra-ci.yml` to:

```yaml
name: AWS Infrastructure CI

on:
  push:
    paths:
      - Dockerfile
      - .dockerignore
      - infra/aws/**
      - scripts/aws/**
      - .github/workflows/aws-*.yml
  pull_request:
    branches: [main]
    paths:
      - Dockerfile
      - .dockerignore
      - infra/aws/**
      - scripts/aws/**
      - .github/workflows/aws-*.yml

jobs:
  terraform:
    name: Terraform validate
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        directory:
          - infra/aws/bootstrap
          - infra/aws/app
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: 1.10.5
      - name: Terraform format
        run: terraform fmt -check -recursive infra/aws
      - name: Terraform init
        working-directory: ${{ matrix.directory }}
        run: terraform init -backend=false
      - name: Terraform validate
        working-directory: ${{ matrix.directory }}
        run: terraform validate

  guard:
    name: Terraform plan guard tests
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Use Node 22
        uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Install dependencies
        run: npm install
      - name: Run guard tests
        run: npm test -- scripts/aws/check-terraform-plan.test.mjs

  container:
    name: Docker build
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Build production image
        run: |
          docker build \
            --build-arg NEXT_PUBLIC_SITE_URL=http://localhost:3000 \
            --build-arg NEXT_PUBLIC_SUPABASE_URL=https://sea-n-shore-test.supabase.co \
            --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_test_key_for_ci_only \
            -t sea-n-shore:ci .
```

- [ ] **Step 7: Generate provider lockfiles with Terraform 1.10.5**

```bash
export PATH="$HOME/bin:$PATH"
terraform version
(cd infra/aws/bootstrap && terraform init -backend=false)
(cd infra/aws/app && terraform init -backend=false)
```

Expected Terraform CLI: `1.10.5`. Stage both generated `.terraform.lock.hcl` files.

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
- Produces: local `artifacts/migration/source-inventory.txt`, `source-integrity.txt`, and `SHA256SUMS`; none are committed.

- [ ] **Step 1: Create a read-only source inventory**

Create `scripts/migration/supabase_inventory.sql`:

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
WHERE n.nspname IN ('public', 'private')
ORDER BY n.nspname, p.proname, arguments;

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

- [ ] **Step 2: Create deterministic application-table counts and relationship digests**

Create `scripts/migration/supabase_integrity.sql`:

```sql
\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;

SELECT format(
  'SELECT %L AS table_name, count(*) AS row_count FROM public.%I;',
  table_name,
  table_name
)
FROM (VALUES
  ('audit_events'),
  ('companies'),
  ('company_members'),
  ('connections'),
  ('follows'),
  ('maritime_profiles'),
  ('notifications'),
  ('post_comments'),
  ('post_media'),
  ('post_poll_options'),
  ('post_poll_votes'),
  ('post_polls'),
  ('post_reactions'),
  ('posts'),
  ('profile_skills'),
  ('profiles'),
  ('saved_posts'),
  ('user_blocks'),
  ('user_roles')
) AS tables(table_name)
ORDER BY table_name
\gexec

SELECT 'profiles' AS relation,
       count(*) AS row_count,
       md5(coalesce(string_agg(id::text, ',' ORDER BY id), '')) AS key_digest
FROM public.profiles
UNION ALL
SELECT 'posts',
       count(*),
       md5(coalesce(string_agg(id::text || ':' || author_id::text, ',' ORDER BY id), ''))
FROM public.posts
UNION ALL
SELECT 'follows',
       count(*),
       md5(coalesce(string_agg(follower_id::text || ':' || following_id::text, ',' ORDER BY follower_id, following_id), ''))
FROM public.follows
UNION ALL
SELECT 'connections',
       count(*),
       md5(coalesce(string_agg(id::text || ':' || user_low_id::text || ':' || user_high_id::text || ':' || requested_by::text || ':' || status::text, ',' ORDER BY id), ''))
FROM public.connections
UNION ALL
SELECT 'notifications',
       count(*),
       md5(coalesce(string_agg(id::text || ':' || recipient_id::text || ':' || coalesce(actor_id::text, '') || ':' || notification_type::text, ',' ORDER BY id), ''))
FROM public.notifications
UNION ALL
SELECT 'post_reactions',
       count(*),
       md5(coalesce(string_agg(post_id::text || ':' || user_id::text || ':' || reaction_type::text, ',' ORDER BY post_id, user_id), ''))
FROM public.post_reactions
UNION ALL
SELECT 'user_roles',
       count(*),
       md5(coalesce(string_agg(user_id::text || ':' || role::text, ',' ORDER BY user_id, role), ''))
FROM public.user_roles;

COMMIT;
```

These column names match the checked-in schema migrations: `connections.status`, `notifications.notification_type`, `post_reactions.reaction_type`, and `user_roles.role`.

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

Create `docs/migration/aws-native-phase-0-1-runbook.md`:

```markdown
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
```

- [ ] **Step 5: Run the baseline without putting the connection URI in command history**

```bash
read -r -s -p 'Supabase PostgreSQL connection URI: ' SOURCE_DATABASE_URL
printf '\n'
export SOURCE_DATABASE_URL
./scripts/migration/capture_source_baseline.sh
unset SOURCE_DATABASE_URL
cat artifacts/migration/source-integrity.txt
```

Expected: read-only queries complete. Investigate any missing expected table before proceeding.

- [ ] **Step 6: Commit scripts and runbook only**

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
  description = "Enable Cognito Google federation after the Google OAuth JSON secret has been populated in Secrets Manager."
  type        = bool
  default     = false
}
```

- [ ] **Step 2: Discover and verify the exact Aurora 16.x engine version in Mumbai**

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

ORDERABLE_COUNT="$(
  aws rds describe-orderable-db-instance-options \
    --region ap-south-1 \
    --engine aurora-postgresql \
    --engine-version "$AURORA_ENGINE_VERSION" \
    --db-instance-class db.serverless \
    --query 'length(OrderableDBInstanceOptions)' \
    --output text
)"

test "$ORDERABLE_COUNT" -gt 0

python3 - "$AURORA_ENGINE_VERSION" <<'PY'
import sys
major, minor, *_ = map(int, sys.argv[1].split('.'))
assert (major, minor) >= (16, 3), sys.argv[1]
PY
```

Write the resulting exact value into local untracked `infra/aws/app/terraform.tfvars` as `aurora_engine_version`.

- [ ] **Step 3: Add isolated private DB subnets**

Create `infra/aws/app/network-private.tf`:

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

- [ ] **Step 4: Add Aurora with an RDS-managed master password**

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

- [ ] **Step 5: Extend `terraform.tfvars.example`**

Append:

```hcl
aurora_engine_version           = "16.3"
aurora_min_acu                  = 0
aurora_max_acu                  = 2
aurora_auto_pause_seconds       = 900
enable_google_identity_provider = false
```

The committed example uses the minimum supported 16.x auto-pause baseline for documentation; the staging operator must use Step 2 to select the exact currently orderable 16.x version before apply.

- [ ] **Step 6: Format, validate, plan, and run the safety guard**

```bash
cd infra/aws/app
terraform fmt
terraform validate
terraform plan -out=tfplan
terraform show -json tfplan > plan.json
node ../../../scripts/aws/check-terraform-plan.mjs plan.json
```

Expected: no delete/replace actions; new DB subnets, DB subnet group, Aurora SG, cluster, and one `db.serverless` instance are additive.

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
- Consumes: `data.aws_caller_identity.current`, `var.project_name`, `var.environment`, `local.common_tags`.
- Produces: three private/versioned/encrypted buckets keyed as `media`, `private_documents`, `migration_backup`.

- [ ] **Step 1: Add complete private S3 resources using `for_each`**

Create `infra/aws/app/storage.tf`:

```hcl
locals {
  storage_bucket_names = {
    media             = "${var.project_name}-${var.environment}-${data.aws_caller_identity.current.account_id}-media"
    private_documents = "${var.project_name}-${var.environment}-${data.aws_caller_identity.current.account_id}-private"
    migration_backup  = "${var.project_name}-${var.environment}-${data.aws_caller_identity.current.account_id}-migration"
  }
}

resource "aws_s3_bucket" "app" {
  for_each      = local.storage_bucket_names
  bucket        = each.value
  force_destroy = false
  tags          = merge(local.common_tags, { Purpose = each.key })
}

resource "aws_s3_bucket_public_access_block" "app" {
  for_each                = aws_s3_bucket.app
  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "app" {
  for_each = aws_s3_bucket.app
  bucket   = each.value.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "app" {
  for_each = aws_s3_bucket.app
  bucket   = each.value.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "migration_backup" {
  bucket = aws_s3_bucket.app["migration_backup"].id

  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  depends_on = [aws_s3_bucket_versioning.app]
}
```

No bucket policy grants public read access.

- [ ] **Step 2: Validate and inspect public-access settings**

```bash
terraform fmt
terraform validate
terraform plan -out=tfplan
terraform show -json tfplan > plan.json
node ../../../scripts/aws/check-terraform-plan.mjs plan.json
terraform show tfplan
```

Expected: all three public-access-block resources set all four flags to `true`.

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
- Consumes: existing `aws_lb.app.dns_name`.
- Produces: an AWS-managed `cloudfront.net` HTTPS staging hostname and a CloudFront-scope WAF.

- [ ] **Step 1: Add the `us-east-1` provider alias for CloudFront-scope WAF**

Create `infra/aws/app/providers-aws-native.tf`:

```hcl
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}
```

- [ ] **Step 2: Add CloudFront managed policy lookups and WAF**

Create `infra/aws/app/edge.tf` starting with:

```hcl
data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

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

- [ ] **Step 3: Add CloudFront in front of the existing ALB**

Append to `infra/aws/app/edge.tf`:

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
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = local.common_tags
}
```

Do not change `site_url`, Supabase redirects, or ECS environment variables in Phase 1. Browser-to-CloudFront is HTTPS; CloudFront-to-ALB remains HTTP until a custom certificate/domain is separately approved.

- [ ] **Step 4: Validate and commit**

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
- Produces: Cognito user pool, app client, Cognito domain, Secrets Manager Google OAuth secret container, and optional Google identity provider.

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

- [ ] **Step 2: Create the Secrets Manager container and conditional Google IdP**

Append:

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

The Secrets Manager value must be JSON with exactly `client_id` and `client_secret` keys. Terraform state is sensitive and remains in the existing private/versioned state bucket; never expose state publicly.

- [ ] **Step 3: Add an app client for email/password and OAuth code flow**

Append:

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
  supported_identity_providers         = var.enable_google_identity_provider ? ["COGNITO", "Google"] : ["COGNITO"]

  callback_urls = ["https://${aws_cloudfront_distribution.app.domain_name}/auth/callback"]
  logout_urls   = ["https://${aws_cloudfront_distribution.app.domain_name}/auth/sign-in"]

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

- [ ] **Step 4: First plan with Google disabled**

Keep local untracked tfvars:

```hcl
enable_google_identity_provider = false
```

Run `terraform validate`, `terraform plan`, JSON conversion, and the plan guard. The plan must not require a Google secret.

- [ ] **Step 5: After the first apply, populate the Google secret without exposing it**

First output the Cognito redirect URI:

```bash
terraform output -raw cognito_google_redirect_uri
printf '\n'
```

Add exactly that URI to the existing Google OAuth application's authorized redirect URIs without removing any production redirect URI.

Then in the operator shell:

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

Set local tfvars `enable_google_identity_provider = true`, then plan again and run the guard before apply.

- [ ] **Step 6: Commit Terraform only**

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
- Produces: SES configuration set and non-secret operator outputs; the RDS master secret ARN output is marked sensitive.

- [ ] **Step 1: Add SES v2 preparation without touching `seaandshore.in`**

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

Do not create a domain identity or production sender in this phase.

- [ ] **Step 2: Add AWS-native outputs**

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
  value = aws_s3_bucket.app["media"].bucket
}

output "private_documents_bucket_name" {
  value = aws_s3_bucket.app["private_documents"].bucket
}

output "migration_backup_bucket_name" {
  value = aws_s3_bucket.app["migration_backup"].bucket
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

Do not output database passwords or OAuth secret values.

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

### Task 8: Apply, Backup Upload, Verification, and Phase 1 Stop Gate

**Files:**
- Modify: `docs/migration/aws-native-phase-0-1-runbook.md` only if verified execution reveals a command nuance; never record secrets.

**Interfaces:**
- Consumes: committed Phase 0/1 Terraform and source baseline artifacts.
- Produces: live AWS foundation and completed verification evidence. Does not cut over application auth or data access.

- [ ] **Step 1: Reconcile the EC2 working copy without losing local Terraform configuration**

```bash
cd ~/SEA-N-SHORE-CODEX
mkdir -p "$HOME/sea-n-shore-local-config-backup"
cp -f infra/aws/app/terraform.tfvars "$HOME/sea-n-shore-local-config-backup/app.terraform.tfvars" 2>/dev/null || true
cp -f infra/aws/bootstrap/terraform.tfvars "$HOME/sea-n-shore-local-config-backup/bootstrap.terraform.tfvars" 2>/dev/null || true
cp -f infra/aws/bootstrap/backend.tf "$HOME/sea-n-shore-local-config-backup/bootstrap.backend.tf" 2>/dev/null || true

git fetch origin
git diff -- Dockerfile origin/main -- Dockerfile
git diff origin/main -- infra/aws/bootstrap/main.tf
git status --short
```

The Dockerfile diff should be empty because the cache-permission fix is already on remote `main`. If `infra/aws/bootstrap/main.tf` differs, inspect the diff and preserve any legitimate AWS-state-affecting change before resetting tracked code. Do not run `git clean -fdx`.

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

Expected: existing VPC, ALB, ECS, IAM, autoscaling, and log resources are already present before Phase 1 additions.

- [ ] **Step 3: Create and inspect the complete plan before apply**

```bash
terraform plan -out=tfplan
terraform show -json tfplan > plan.json
node ../../../scripts/aws/check-terraform-plan.mjs plan.json
terraform show tfplan
```

Stop if any existing resource is deleted/replaced or if the plan modifies current Supabase runtime configuration, the running ECS image, current `site_url`, production DNS, or existing Supabase auth redirects.

- [ ] **Step 4: Apply Phase 1 with Google disabled first**

```bash
terraform apply tfplan
```

Expected: additive creation of private DB network, Aurora, S3 buckets, CloudFront, WAF, Cognito base, Google secret container, SES configuration set, and outputs. Current ECS service remains stable.

- [ ] **Step 5: Upload Phase 0 evidence to the private migration bucket**

From repository root:

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

aws s3 ls "s3://${MIGRATION_BUCKET}/phase-0/${STAMP}/"
```

Expected: exactly three baseline evidence objects.

- [ ] **Step 6: Verify private Aurora posture**

```bash
aws rds describe-db-clusters \
  --region ap-south-1 \
  --db-cluster-identifier sea-n-shore-staging-aurora \
  --query 'DBClusters[0].{Status:Status,Encrypted:StorageEncrypted,DeletionProtection:DeletionProtection,Endpoint:Endpoint}'

aws rds describe-db-instances \
  --region ap-south-1 \
  --db-instance-identifier sea-n-shore-staging-aurora-writer \
  --query 'DBInstances[0].{Status:DBInstanceStatus,Public:PubliclyAccessible,Class:DBInstanceClass}'
```

Expected: cluster `available`, encrypted `true`, deletion protection `true`; writer `available`, `Public=false`, class `db.serverless`.

- [ ] **Step 7: Verify the HTTPS CloudFront edge**

```bash
HTTPS_URL="$(terraform output -raw staging_https_url)"
printf '%s\n' "$HTTPS_URL"
curl -I "$HTTPS_URL/auth/sign-in"
```

Expected: browser-facing HTTPS response `200-399`. The raw ALB URL remains available during Phase 1.

- [ ] **Step 8: Configure and verify Google federation**

```bash
aws cognito-idp describe-user-pool \
  --region ap-south-1 \
  --user-pool-id "$(terraform output -raw cognito_user_pool_id)" \
  --query 'UserPool.{Name:Name,DeletionProtection:DeletionProtection,Status:Status}'

terraform output -raw cognito_google_redirect_uri
printf '\n'
```

After adding that redirect URI in the existing Google OAuth application and storing the OAuth JSON in Secrets Manager as Task 6 specifies, set local `enable_google_identity_provider=true` and run:

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

Expected: provider name `Google`, provider type `Google`.

- [ ] **Step 9: Verify no application cutover happened**

```bash
TASK_DEF="$(terraform output -raw ecs_task_definition_family)"
aws ecs describe-task-definition \
  --region ap-south-1 \
  --task-definition "$TASK_DEF" \
  --query 'taskDefinition.containerDefinitions[?name==`web`].environment[]' \
  --output table
```

Expected: existing `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and current `NEXT_PUBLIC_SITE_URL` remain. No Aurora endpoint/secret or Cognito runtime setting is injected into the running app yet.

- [ ] **Step 10: Verify the current ECS service remains healthy**

```bash
aws ecs describe-services \
  --region ap-south-1 \
  --cluster sea-n-shore-staging \
  --services sea-n-shore-staging-web \
  --query 'services[0].{Status:status,Desired:desiredCount,Running:runningCount,Pending:pendingCount,Deployment:deployments[0].rolloutState}'
```

Expected: `ACTIVE`, desired `1`, running `1`, pending `0`, rollout state `COMPLETED`.

- [ ] **Step 11: Run repository verification one final time**

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

Do **not** migrate application rows into Aurora, create Cognito mappings for existing users, rewrite Next.js auth, alter `NEXT_PUBLIC_SUPABASE_*`, change production DNS, disable Supabase writes, or remove Supabase data/RLS/RPC/storage. Those actions belong to later plans.

- [ ] **Step 13: Commit only verified runbook corrections if execution required them**

If the checked-in runbook remains accurate, make no documentation commit. If a command required a verified correction:

```bash
git add docs/migration/aws-native-phase-0-1-runbook.md
git commit -m "docs: record verified AWS foundation procedure"
```

---

## Phase 0 + Phase 1 Acceptance Checklist

- [ ] Supabase is still the live application source of truth and was not mutated by migration work.
- [ ] Source inventory/integrity evidence was captured and backed up privately to S3.
- [ ] Existing Sea N Shore application UUIDs were not changed.
- [ ] Existing VPC, ALB, ECS service, ECR repository, and OIDC deployment path were not replaced.
- [ ] Aurora PostgreSQL Serverless v2 is encrypted, private, and accepts port 5432 only from the ECS security group.
- [ ] Aurora master password is RDS-managed in Secrets Manager and is not exposed to the running application.
- [ ] S3 media/document/migration buckets have public access blocked, versioning enabled, and server-side encryption enabled.
- [ ] CloudFront provides a working AWS-managed HTTPS staging URL without changing `seaandshore.in` DNS.
- [ ] WAF is attached to CloudFront with `AWSManagedRulesCommonRuleSet` and the 2,000 requests / 5 minute per-IP rate rule.
- [ ] Cognito user pool/app client/domain exist with email/password capability.
- [ ] Google federation works through Cognito after the operator's Google credential step.
- [ ] SES configuration set exists, but no production sender/domain cutover occurred.
- [ ] Current ECS service remains healthy and still uses the existing Supabase runtime configuration.
- [ ] Terraform plan guard reports no destructive actions.
- [ ] Repository lint, typecheck, tests, Terraform fmt, and Terraform validate all pass.

## Rollback for This Plan

Because the running app remains Supabase-backed, application rollback is unnecessary in Phase 0/1. If the AWS-native foundation must be removed, first obtain explicit approval, disable Cognito and Aurora deletion protection deliberately, and destroy only the resources introduced by this plan. Do not destroy the existing VPC/ALB/ECS/ECR/OIDC resources and do not touch Supabase.
