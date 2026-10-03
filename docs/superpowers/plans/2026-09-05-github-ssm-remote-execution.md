# GitHub-to-SSM Remote Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let migration-branch pushes execute repository-controlled verification on the existing AWS bootstrap EC2 instance through SSM, eliminating repeated manual Session Manager command entry after one bootstrap step.

**Architecture:** Reuse the existing GitHub OIDC staging role, add narrowly scoped SSM Run Command permissions, and add an Actions workflow that discovers the tagged bootstrap instance and invokes only a checked-in remote verification script. Keep remote execution verification-only: no arbitrary command workflow input and no destructive apply/cutover behavior.

**Tech Stack:** GitHub Actions, AWS OIDC, IAM, AWS Systems Manager Run Command, EC2, Bash, Terraform 1.10.5, Node 22.

**Spec:** `docs/superpowers/specs/2026-09-05-github-ssm-remote-execution-design.md`

## Global Constraints

- Target AWS region remains `ap-south-1`.
- Target only the EC2 instance tagged `Name=sea-n-shore-bootstrap`.
- Reuse GitHub Environment `staging` and the existing OIDC role.
- No arbitrary shell text workflow input.
- No IAM administration permissions granted to GitHub.
- Do not print passwords, tokens, database secrets, OAuth secrets, or credentials.
- Do not touch `seaandshore.in` DNS.
- Do not delete, pause, or cut over Supabase.
- Remote execution is verification-only.

---

### Task 1: Define remote-execution security contract

**Files:**
- Create: `scripts/aws/remote-execution-config.test.mjs`
- Modify: `.github/workflows/aws-infra-ci.yml`

**Interfaces:**
- Consumes: repository files as plain text.
- Produces: a Node built-in test that asserts required IAM/workflow/remote-script security invariants.

- [ ] **Step 1: Write failing configuration test**

Create a Node `node:test` test that requires all of the following strings/structures to exist after implementation: `AWS-RunShellScript`, the bootstrap instance tag, no arbitrary `command` input, `scripts/aws/remote-verify.sh`, the SSM actions in Terraform, and the tag restriction.

- [ ] **Step 2: Wire the test into AWS Infrastructure CI without npm install**

Add a `remote-execution-contract` job that runs:

```bash
node --test scripts/aws/remote-execution-config.test.mjs
```

- [ ] **Step 3: Verify RED**

Expected: the push workflow fails this new job because the production workflow/SSM policy files do not yet satisfy the contract.

- [ ] **Step 4: Commit**

```bash
git add scripts/aws/remote-execution-config.test.mjs .github/workflows/aws-infra-ci.yml
git commit -m "test: define GitHub SSM execution contract"
```

---

### Task 2: Add least-privilege GitHub SSM permissions and one-time bootstrap

**Files:**
- Modify: `infra/aws/bootstrap/main.tf`
- Create: `scripts/aws/bootstrap-github-ssm-execution.sh`

**Interfaces:**
- Consumes: existing inline IAM policy `sea-n-shore-staging-github-deploy` and current AWS identity from the bootstrap instance.
- Produces: live/source permissions for `ec2:DescribeInstances`, `ssm:SendCommand`, `ssm:GetCommandInvocation`, `ssm:ListCommandInvocations`, with SSM targeting restricted to the bootstrap instance tag and AWS-managed RunShellScript document.

- [ ] **Step 1: Extend Terraform IAM policy**

Add separate statements for EC2 discovery, the AWS-managed document, the tagged bootstrap instance, and command-result reads. Keep existing ECR/ECS permissions unchanged.

- [ ] **Step 2: Create one-time bootstrap script**

The script must:

```text
resolve account/region -> read current inline policy -> add only missing remote-execution statements -> put the same inline policy back -> print REMOTE EXECUTION IAM BOOTSTRAP COMPLETE
```

It must not require or print credentials.

- [ ] **Step 3: Validate shell syntax and Terraform**

Run:

```bash
bash -n scripts/aws/bootstrap-github-ssm-execution.sh
terraform fmt -check -recursive infra/aws
terraform -chdir=infra/aws/bootstrap init -backend=false
terraform -chdir=infra/aws/bootstrap validate
```

- [ ] **Step 4: Commit**

```bash
git add infra/aws/bootstrap/main.tf scripts/aws/bootstrap-github-ssm-execution.sh
git commit -m "feat: grant GitHub scoped SSM execution"
```

---

### Task 3: Add repository-controlled remote verifier

**Files:**
- Create: `scripts/aws/remote-verify.sh`

**Interfaces:**
- Consumes: exact triggering commit already reset into the existing migration worktree.
- Produces: deterministic verification exit status and non-secret logs.

- [ ] **Step 1: Implement strict shell entry point**

Use `set -euo pipefail`, validate the worktree, and never read secrets.

- [ ] **Step 2: Add verification gates**

At minimum:

```bash
bash -n scripts/aws/*.sh
npm run lint
npm run typecheck
./node_modules/.bin/vitest run
```

When Terraform files exist, also run format and `terraform validate` for bootstrap/app with `-backend=false` initialization as needed.

- [ ] **Step 3: Keep npm install out of the remote path**

The existing EC2 worktree already has dependencies installed with the known-good npm version. Fail with a clear message if `node_modules/.bin/vitest` is absent rather than silently reinstalling with the known-bad npm 10 path.

- [ ] **Step 4: Commit**

```bash
git add scripts/aws/remote-verify.sh
git commit -m "feat: add AWS remote verification entry point"
```

---

### Task 4: Add automatic GitHub-to-SSM workflow

**Files:**
- Create: `.github/workflows/aws-remote-verify.yml`

**Interfaces:**
- Consumes: GitHub SHA, staging OIDC role variable `AWS_ROLE_TO_ASSUME`, AWS region.
- Produces: SSM command invocation and GitHub Actions logs/status.

- [ ] **Step 1: Configure triggers and permissions**

Trigger on pushes to `feat/aws-native-phase-0-1` for migration-relevant paths plus manual dispatch. Use only `id-token: write` and `contents: read`.

- [ ] **Step 2: Discover exactly one bootstrap instance**

Query running EC2 instances tagged `Name=sea-n-shore-bootstrap`. Fail if zero or more than one are returned.

- [ ] **Step 3: Send repository-controlled command**

The SSM command must:

```bash
cd /home/ssm-user/SEA-N-SHORE-CODEX/.worktrees/aws-native-phase-0-1
git fetch origin <triggering-sha>
git reset --hard <triggering-sha>
bash scripts/aws/remote-verify.sh
```

No workflow input may substitute arbitrary shell text.

- [ ] **Step 4: Poll and surface result**

Poll `get-command-invocation` until terminal state, print stdout/stderr, and exit non-zero unless status is `Success`.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/aws-remote-verify.yml
git commit -m "feat: verify migration branch through AWS SSM"
```

---

### Task 5: Bootstrap live IAM and verify end-to-end

**Files:**
- No new production files unless verification reveals a defect.

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: working GitHub push -> OIDC -> SSM -> bootstrap EC2 -> repo verification loop.

- [ ] **Step 1: Run one-time bootstrap from existing SSM session**

```bash
cd ~/SEA-N-SHORE-CODEX/.worktrees/aws-native-phase-0-1
git fetch origin feat/aws-native-phase-0-1
git reset --hard origin/feat/aws-native-phase-0-1
bash scripts/aws/bootstrap-github-ssm-execution.sh
```

Expected:

```text
REMOTE EXECUTION IAM BOOTSTRAP COMPLETE
```

- [ ] **Step 2: Re-run the latest failed AWS Remote Verify workflow or push a no-op migration-doc change**

Expected: OIDC succeeds, exactly one bootstrap instance is found, SSM command reaches `Success`.

- [ ] **Step 3: Verify logs contain quality-gate output and no secrets**

Expected: lint/typecheck/tests appear; no passwords/tokens/secret values appear.

- [ ] **Step 4: Verify Terraform drift is clean for the IAM policy source**

Run bootstrap `terraform validate`; a later normal Terraform plan must not try to remove the SSM statements.

- [ ] **Step 5: Resume Phase 4**

Once the loop is green, use GitHub commits plus remote workflow logs for subsequent Phase 4 TDD/verification instead of asking the user to paste routine AWS shell output.
