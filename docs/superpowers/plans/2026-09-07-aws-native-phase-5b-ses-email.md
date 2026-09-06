# AWS-Native Phase 5B — SES Transactional Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Cognito sign-up verification and password-reset email delivery onto Amazon SES in `ap-south-1` using `Sea N Shore <no-reply@seaandshore.in>`, with verified DKIM, SES production access, and fresh staging delivery evidence.

**Architecture:** Keep Cognito responsible for verification/reset codes and message timing. Add a verified SES domain identity and least-privilege Cognito sending authorization in committed Terraform, gate the Cognito `DEVELOPER` email cutover behind explicit readiness, and use a narrow GitHub OIDC operational path while the known WAF provider-state drift prevents a safe unrestricted app-stack apply. DNS changes are limited to SES verification/DKIM records at the current authoritative provider; production nameservers and website routing remain untouched.

**Tech Stack:** Terraform 1.16.x, HashiCorp AWS provider 6.62.x, Amazon SES v2, Amazon Cognito, GitHub Actions OIDC, AWS CLI, Node.js tests, existing AWS staging in `ap-south-1`.

**Spec:** `docs/superpowers/specs/2026-09-07-aws-native-phase-5b-ses-email-design.md`

## Global Constraints

- Work only on `feat/aws-native-phase-0-1`.
- Never merge to `main` and never create a PR unless explicitly requested.
- Approved sender: `Sea N Shore <no-reply@seaandshore.in>`.
- SES region: `ap-south-1`.
- SES identity: domain identity `seaandshore.in` with Easy DKIM using `RSA_2048_BIT`.
- Do not change production nameservers, website DNS, production traffic, Vercel availability, or registrar during Phase 5B.
- Do not decommission Supabase or remove remaining Supabase runtime/packages in this phase.
- Do not run a full `infra/aws/app` Terraform plan/apply while the orphaned CloudFront WAF `aws.us_east_1` provider-state problem remains unresolved.
- Any live AWS mutation must mirror committed Terraform intent.
- SES production access in `ap-south-1` is required before the Cognito SES cutover is declared complete.
- Never log passwords, verification/reset codes, OAuth secrets, database secrets, Supabase keys, or auth tokens.
- Preserve the current working Cognito email configuration until SES identity, DKIM, and production-access gates pass.
- Existing staging ECS revision 24 remains the known-good application baseline unless a later verified deploy changes it.

---

## File Structure

- `infra/aws/app/email.tf` — SES configuration set, `seaandshore.in` SES v2 identity, 2048-bit Easy DKIM intent, Cognito sending-authorization policy.
- `infra/aws/app/auth.tf` — existing Cognito user pool plus gated SES `email_configuration` block.
- `infra/aws/app/aws-native-variables.tf` — explicit email domain, sender, display name, and `enable_cognito_ses_email` readiness flag.
- `infra/aws/app/terraform.tfvars.example` — documents non-secret Phase 5B variables.
- `scripts/aws/phase5b-ses-readiness.sh` — read-only DNS/SES/Cognito readiness inspection and fail-closed cutover preconditions.
- `scripts/aws/phase5b-ses-readiness.test.mjs` — source-contract tests for readiness/sandbox/identity gates.
- `scripts/aws/phase5b-ses-cutover.sh` — narrow AWS CLI cutover helper that preserves unrelated Cognito user-pool settings and updates only SES email configuration after gates pass.
- `scripts/aws/phase5b-ses-cutover.test.mjs` — source-contract tests for sender, source ARN, configuration set, preservation behavior, and rollback capture.
- `.github/workflows/aws-phase5b-ses.yml` — temporary/bounded GitHub OIDC execution surface for discovery, SES identity reconciliation, verification checks, and optional Cognito cutover. Remove it after Phase 5B is proven if it is not generally useful.
- `scripts/aws/remote-execution-config.test.mjs` — extend only if needed to validate the new workflow permissions/shape.

---

### Task 1: Read-only SES/DNS/Cognito discovery

**Files:**
- Create: `scripts/aws/phase5b-ses-readiness.sh`
- Create: `scripts/aws/phase5b-ses-readiness.test.mjs`

**Interfaces:**
- Consumes: AWS CLI credentials from GitHub OIDC; region `ap-south-1`; domain `seaandshore.in`; existing Cognito user-pool name/ID discovery.
- Produces: safe readiness output fields `AUTHORITATIVE_NS`, `SES_PRODUCTION_ACCESS`, `SES_IDENTITY_STATUS`, `SES_DKIM_STATUS`, `SES_DKIM_TOKENS`, `COGNITO_EMAIL_SENDING_ACCOUNT`, `COGNITO_SOURCE_ARN`, `COGNITO_CONFIGURATION_SET`; exit non-zero only when invoked in `--require-cutover-ready` mode and a required gate is false.

- [ ] **Step 1: Write the failing readiness contract test**

Create `scripts/aws/phase5b-ses-readiness.test.mjs` that reads the shell script and asserts it contains the exact approved constants and AWS checks:

```js
import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const script = fs.readFileSync(new URL('./phase5b-ses-readiness.sh', import.meta.url), 'utf8')

test('Phase 5B readiness checks SES production access, identity, DKIM, DNS and Cognito', () => {
  assert.match(script, /seaandshore\.in/)
  assert.match(script, /ap-south-1/)
  assert.match(script, /sesv2 get-account/)
  assert.match(script, /sesv2 get-email-identity/)
  assert.match(script, /dig \+short NS/)
  assert.match(script, /cognito-idp describe-user-pool/)
  assert.match(script, /--require-cutover-ready/)
  assert.match(script, /ProductionAccessEnabled/)
  assert.match(script, /VerificationStatus/)
  assert.match(script, /DkimAttributes/)
})
```

- [ ] **Step 2: Run the test to prove RED**

Run:

```bash
node --test scripts/aws/phase5b-ses-readiness.test.mjs
```

Expected: FAIL because `scripts/aws/phase5b-ses-readiness.sh` does not exist.

- [ ] **Step 3: Implement the read-only readiness script**

The script must:

```bash
#!/usr/bin/env bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-ap-south-1}"
SES_DOMAIN="${SES_DOMAIN:-seaandshore.in}"
REQUIRE_READY="${1:-}"

aws sts get-caller-identity >/dev/null

dig +short NS "$SES_DOMAIN" | sort
aws sesv2 get-account --region "$AWS_REGION" --query 'ProductionAccessEnabled' --output text

if aws sesv2 get-email-identity --region "$AWS_REGION" --email-identity "$SES_DOMAIN" >/tmp/phase5b-identity.json 2>/dev/null; then
  jq -r '.VerificationStatus, .DkimAttributes.Status, (.DkimAttributes.Tokens[]? // empty)' /tmp/phase5b-identity.json
else
  echo 'SES_IDENTITY_STATUS=NOT_CREATED'
fi

POOL_ID="${COGNITO_USER_POOL_ID:-$(aws cognito-idp list-user-pools --region "$AWS_REGION" --max-results 60 --query "UserPools[?Name=='sea-n-shore-staging-users'].Id | [0]" --output text)}"
aws cognito-idp describe-user-pool --region "$AWS_REGION" --user-pool-id "$POOL_ID" --query 'UserPool.EmailConfiguration'
```

In `--require-cutover-ready` mode, fail unless `ProductionAccessEnabled=true`, `VerificationStatus=SUCCESS`, `DkimAttributes.Status=SUCCESS`, and the intended SES identity exists. Do not fail discovery merely because DNS is external.

- [ ] **Step 4: Run the readiness unit contract GREEN**

Run:

```bash
node --test scripts/aws/phase5b-ses-readiness.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add scripts/aws/phase5b-ses-readiness.sh scripts/aws/phase5b-ses-readiness.test.mjs
git commit -m "test: add Phase 5B SES readiness gate"
```

---

### Task 2: Commit SES identity and least-privilege Cognito authorization intent

**Files:**
- Modify: `infra/aws/app/email.tf`
- Modify: `infra/aws/app/aws-native-variables.tf`
- Modify: `infra/aws/app/terraform.tfvars.example`
- Create: `scripts/aws/phase5b-ses-terraform.test.mjs`

**Interfaces:**
- Consumes: `data.aws_caller_identity.current`, `aws_cognito_user_pool.app`, existing `aws_sesv2_configuration_set.transactional`.
- Produces: `aws_sesv2_email_identity.transactional_domain`; `data.aws_iam_policy_document.cognito_ses_sender`; `aws_ses_identity_policy.cognito_sender`; variables `ses_domain`, `ses_from_address`, `ses_from_display_name`, `enable_cognito_ses_email`.

- [ ] **Step 1: Write failing Terraform source-contract tests**

Create `scripts/aws/phase5b-ses-terraform.test.mjs` to assert:

```js
assert.match(emailTf, /resource "aws_sesv2_email_identity" "transactional_domain"/)
assert.match(emailTf, /email_identity\s*=\s*var\.ses_domain/)
assert.match(emailTf, /next_signing_key_length\s*=\s*"RSA_2048_BIT"/)
assert.match(emailTf, /email\.cognito-idp\.amazonaws\.com/)
assert.match(emailTf, /aws:SourceAccount/)
assert.match(emailTf, /aws:SourceArn/)
assert.match(emailTf, /SES:SendEmail/)
assert.match(emailTf, /SES:SendRawEmail/)
assert.doesNotMatch(emailTf, /ses:\*/i)
assert.match(varsTf, /default\s*=\s*"seaandshore\.in"/)
assert.match(varsTf, /default\s*=\s*"no-reply@seaandshore\.in"/)
assert.match(varsTf, /enable_cognito_ses_email/)
```

- [ ] **Step 2: Run RED**

```bash
node --test scripts/aws/phase5b-ses-terraform.test.mjs
```

Expected: FAIL on missing identity/policy/variables.

- [ ] **Step 3: Add variables**

Add to `aws-native-variables.tf`:

```hcl
variable "ses_domain" {
  description = "SES domain identity used for transactional email."
  type        = string
  default     = "seaandshore.in"
}

variable "ses_from_address" {
  description = "Approved transactional FROM address."
  type        = string
  default     = "no-reply@seaandshore.in"
}

variable "ses_from_display_name" {
  description = "Display name for transactional email."
  type        = string
  default     = "Sea N Shore"
}

variable "enable_cognito_ses_email" {
  description = "Switch Cognito from default email delivery to verified SES after readiness gates pass."
  type        = bool
  default     = false
}
```

Document these values in `terraform.tfvars.example`, keeping `enable_cognito_ses_email = false` by default.

- [ ] **Step 4: Add SES v2 domain identity and Easy DKIM**

Extend `email.tf`:

```hcl
resource "aws_sesv2_email_identity" "transactional_domain" {
  email_identity         = var.ses_domain
  configuration_set_name = aws_sesv2_configuration_set.transactional.configuration_set_name

  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }

  tags = local.common_tags
}
```

- [ ] **Step 5: Add Cognito-scoped sending authorization**

Use the Cognito email service principal documented for same-region SES and constrain by both account and exact user-pool ARN:

```hcl
data "aws_iam_policy_document" "cognito_ses_sender" {
  statement {
    sid       = "AuthorizeSeaNShoreCognito"
    effect    = "Allow"
    actions   = ["SES:SendEmail", "SES:SendRawEmail"]
    resources = [aws_sesv2_email_identity.transactional_domain.arn]

    principals {
      type        = "Service"
      identifiers = ["email.cognito-idp.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = [aws_cognito_user_pool.app.arn]
    }
  }
}

resource "aws_ses_identity_policy" "cognito_sender" {
  identity = aws_sesv2_email_identity.transactional_domain.arn
  name     = "${local.name_prefix}-cognito-sender"
  policy   = data.aws_iam_policy_document.cognito_ses_sender.json
}
```

- [ ] **Step 6: Run GREEN tests and Terraform static checks**

```bash
node --test scripts/aws/phase5b-ses-terraform.test.mjs
terraform -chdir=infra/aws/app fmt -check
terraform -chdir=infra/aws/app validate
```

Expected: all PASS. Do not run a full plan/apply.

- [ ] **Step 7: Commit Task 2**

```bash
git add infra/aws/app/email.tf infra/aws/app/aws-native-variables.tf infra/aws/app/terraform.tfvars.example scripts/aws/phase5b-ses-terraform.test.mjs
git commit -m "feat: define SES transactional identity"
```

---

### Task 3: Add gated Cognito SES email configuration

**Files:**
- Modify: `infra/aws/app/auth.tf`
- Modify: `scripts/aws/phase5b-ses-terraform.test.mjs`

**Interfaces:**
- Consumes: `var.enable_cognito_ses_email`, approved sender variables, `aws_sesv2_email_identity.transactional_domain`, `aws_sesv2_configuration_set.transactional`.
- Produces: Cognito `email_configuration` that remains `COGNITO_DEFAULT` while the flag is false and becomes SES `DEVELOPER` only when explicitly enabled.

- [ ] **Step 1: Extend the test first**

Add assertions that `auth.tf` contains:

```js
assert.match(authTf, /email_sending_account\s*=\s*var\.enable_cognito_ses_email\s*\?\s*"DEVELOPER"\s*:\s*"COGNITO_DEFAULT"/)
assert.match(authTf, /source_arn/)
assert.match(authTf, /configuration_set/)
assert.match(authTf, /Sea N Shore/)
assert.match(authTf, /no-reply@seaandshore\.in/)
```

- [ ] **Step 2: Run RED**

```bash
node --test scripts/aws/phase5b-ses-terraform.test.mjs
```

Expected: FAIL on missing Cognito email configuration.

- [ ] **Step 3: Add the minimal gated Cognito configuration**

Inside `aws_cognito_user_pool.app`, add one `email_configuration` block whose values are conditional. The false path must remain equivalent to Cognito default delivery and must not require a verified SES source ARN. The true path must set:

```hcl
email_sending_account  = "DEVELOPER"
source_arn             = aws_sesv2_email_identity.transactional_domain.arn
from_email_address     = "${var.ses_from_display_name} <${var.ses_from_address}>"
reply_to_email_address = var.ses_from_address
configuration_set      = aws_sesv2_configuration_set.transactional.configuration_set_name
```

Use `null` for SES-only fields while `enable_cognito_ses_email` is false so Terraform does not push an unverified sender prematurely.

- [ ] **Step 4: Run GREEN static verification**

```bash
node --test scripts/aws/phase5b-ses-terraform.test.mjs
terraform -chdir=infra/aws/app fmt -check
terraform -chdir=infra/aws/app validate
npm test -- --runInBand
```

Expected: PASS; existing auth action semantics unchanged.

- [ ] **Step 5: Commit Task 3**

```bash
git add infra/aws/app/auth.tf scripts/aws/phase5b-ses-terraform.test.mjs
git commit -m "feat: gate Cognito SES delivery"
```

---

### Task 4: Add safe operational SES reconciliation and Cognito cutover helper

**Files:**
- Create: `scripts/aws/phase5b-ses-cutover.sh`
- Create: `scripts/aws/phase5b-ses-cutover.test.mjs`
- Create or modify: `.github/workflows/aws-phase5b-ses.yml`
- Modify: `scripts/aws/remote-execution-config.test.mjs` only if needed for workflow contract coverage.

**Interfaces:**
- Consumes: GitHub OIDC role, approved AWS account/region/domain, current user-pool ID, existing transactional configuration set.
- Produces: idempotent operations `discover`, `ensure-identity`, `verify-ready`, `cutover`, `verify-cutover`, `rollback-cognito`; captured pre-cutover Cognito email configuration stored only as a workflow artifact or `/tmp` JSON without secrets.

- [ ] **Step 1: Write failing cutover contract tests**

The test must assert the script:

```js
assert.match(script, /ensure-identity/)
assert.match(script, /verify-ready/)
assert.match(script, /cutover/)
assert.match(script, /rollback-cognito/)
assert.match(script, /Sea N Shore <no-reply@seaandshore\.in>/)
assert.match(script, /sea-n-shore-staging-transactional/)
assert.match(script, /sesv2 get-account/)
assert.match(script, /sesv2 get-email-identity/)
assert.match(script, /cognito-idp describe-user-pool/)
assert.match(script, /cognito-idp update-user-pool/)
assert.match(script, /EmailSendingAccount=DEVELOPER/)
assert.doesNotMatch(script, /delete-user-pool|delete-email-identity|ses:\*/i)
```

- [ ] **Step 2: Run RED**

```bash
node --test scripts/aws/phase5b-ses-cutover.test.mjs
```

Expected: FAIL because the script does not exist.

- [ ] **Step 3: Implement `ensure-identity` idempotently**

Use AWS CLI SES v2. If the identity already exists, describe it and do not recreate it. If absent, create `seaandshore.in`, set DKIM key length to 2048 if needed, and attach the committed Cognito authorization policy equivalent. Print only identity status, DKIM status, and exact DKIM CNAME names/values required for DNS.

- [ ] **Step 4: Implement `verify-ready` fail-closed**

Require:

```text
ProductionAccessEnabled=true
VerificationStatus=SUCCESS
DkimAttributes.Status=SUCCESS
identity ARN == arn:aws:ses:ap-south-1:310356785722:identity/seaandshore.in
configuration set == sea-n-shore-staging-transactional
```

If any gate fails, exit non-zero before touching Cognito.

- [ ] **Step 5: Implement `cutover` with preservation**

Before update:

```bash
aws cognito-idp describe-user-pool ... > /tmp/phase5b-user-pool-before.json
```

Build the `update-user-pool` request from the current mutable user-pool settings, changing only `EmailConfiguration`. The new email configuration must be:

```json
{
  "EmailSendingAccount": "DEVELOPER",
  "SourceArn": "arn:aws:ses:ap-south-1:310356785722:identity/seaandshore.in",
  "From": "Sea N Shore <no-reply@seaandshore.in>",
  "ReplyToEmailAddress": "no-reply@seaandshore.in",
  "ConfigurationSet": "sea-n-shore-staging-transactional"
}
```

Do not reconstruct user-pool settings from guesses. Preserve all values returned by `describe-user-pool` that `update-user-pool` requires/supports.

- [ ] **Step 6: Implement `rollback-cognito`**

Restore the exact pre-cutover email configuration captured immediately before the cutover. Refuse rollback if the capture file is missing or belongs to a different user pool.

- [ ] **Step 7: Add bounded GitHub OIDC workflow**

The workflow must be `workflow_dispatch` plus branch-restricted push use only if direct dispatch is unavailable. Inputs:

```text
action: discover | ensure-identity | verify-ready | cutover | verify-cutover | rollback-cognito
```

It must assume `arn:aws:iam::310356785722:role/sea-n-shore-staging-github-deploy`, run the committed helper, and never echo credentials/secrets.

- [ ] **Step 8: Run GREEN**

```bash
node --test scripts/aws/phase5b-ses-cutover.test.mjs scripts/aws/phase5b-ses-readiness.test.mjs scripts/aws/phase5b-ses-terraform.test.mjs
npm test -- --runInBand
terraform -chdir=infra/aws/app fmt -check
terraform -chdir=infra/aws/app validate
```

Expected: PASS.

- [ ] **Step 9: Commit Task 4**

```bash
git add scripts/aws/phase5b-ses-cutover.sh scripts/aws/phase5b-ses-cutover.test.mjs .github/workflows/aws-phase5b-ses.yml scripts/aws/remote-execution-config.test.mjs
git commit -m "ops: add safe Phase 5B SES cutover"
```

---

### Task 5: Exact-head CI and Stage A live SES readiness

**Files:**
- No production source changes unless a specific CI/AWS denial identifies a real missing contract.

**Interfaces:**
- Consumes: exact branch head from Tasks 1-4.
- Produces: exact-head CI evidence; authoritative DNS provider evidence; SES production-access evidence; SES identity/DKIM tokens/status.

- [ ] **Step 1: Run exact-head repository verification**

Require all existing AWS Infrastructure CI jobs plus new Phase 5B tests to pass on the exact SHA. Record run ID and SHA.

- [ ] **Step 2: Run `discover` through GitHub OIDC**

Collect:

```text
AWS account/role
current authoritative NS for seaandshore.in
SES ProductionAccessEnabled
existing identity state
existing DKIM state/tokens
current Cognito EmailConfiguration
```

Do not expose secrets.

- [ ] **Step 3: Run `ensure-identity` only after source is GREEN**

Create/reconcile the SES identity and Cognito sending-authorization policy. Do not update Cognito email delivery yet.

- [ ] **Step 4: Handle DNS verification safely**

If the current authoritative DNS is Route 53 in account `310356785722`, add only the three SES DKIM CNAME records through a narrow Route 53 operation matching committed intent.

If DNS is external and no authorized connector is available, stop at this exact boundary and present the three generated CNAME records for one manual DNS update. Do not move nameservers or website DNS.

- [ ] **Step 5: Wait for SES identity/DKIM verification**

Poll no more frequently than once per minute through the workflow until `VerificationStatus=SUCCESS` and DKIM `Status=SUCCESS`. Record fresh evidence.

- [ ] **Step 6: Verify/request SES production access**

If `ProductionAccessEnabled=false`, do not cut over Cognito. Use AWS SES account details to confirm sandbox state and request production access for transactional authentication email. Stop Phase 5B execution at this external AWS approval boundary until access is granted.

- [ ] **Step 7: Run `verify-ready`**

Expected: success only when identity, DKIM, and production access are all ready.

---

### Task 6: Stage B Cognito cutover and delivery smoke tests

**Files:**
- Modify `infra/aws/app/terraform.tfvars.example` only if documentation must reflect the final enabled staging state; do not place environment-specific live state in source unless already the repo convention.
- No other source changes unless verification exposes a real bug.

**Interfaces:**
- Consumes: Stage A fully ready SES identity and exact-head GREEN source.
- Produces: live Cognito `DEVELOPER` SES configuration; successful sign-up verification delivery; successful password-reset delivery; rollback capture.

- [ ] **Step 1: Re-run exact-head CI immediately before cutover**

Record exact SHA/run. Do not cut over from an unverified head.

- [ ] **Step 2: Run `cutover`**

Expected live Cognito email configuration:

```text
EmailSendingAccount=DEVELOPER
SourceArn=arn:aws:ses:ap-south-1:310356785722:identity/seaandshore.in
From=Sea N Shore <no-reply@seaandshore.in>
ReplyToEmailAddress=no-reply@seaandshore.in
ConfigurationSet=sea-n-shore-staging-transactional
```

- [ ] **Step 3: Verify Cognito live state immediately**

Run `verify-cutover`; fail and rollback if any field differs.

- [ ] **Step 4: Controlled sign-up confirmation smoke**

Use a controlled email address owned by the operator. Create a staging sign-up through the normal app flow. Verify the confirmation email arrives from `no-reply@seaandshore.in`. Do not log the confirmation code.

- [ ] **Step 5: Controlled forgot-password smoke**

Use a controlled existing staging account. Trigger forgot password through the app. Verify the reset email arrives from `no-reply@seaandshore.in`. Do not log the reset code.

- [ ] **Step 6: Verify AWS/application health**

Fresh checks:

```text
/api/health/phase4 -> 200
/api/health/home -> 200
ECS desired/running/pending healthy
SES sending statistics show accepted sends for controlled tests
CloudWatch contains no repeating new auth/email runtime errors
S3 media/feed remains healthy
```

- [ ] **Step 7: Roll back if either controlled delivery test fails**

Run `rollback-cognito`, verify the previous email configuration is restored, and keep the SES identity/DKIM records in place unless they are proven incorrect.

- [ ] **Step 8: Remove temporary workflow if no longer needed**

If `.github/workflows/aws-phase5b-ses.yml` exists only for this migration, delete it after completion and run cleanup-head CI. If it provides a reusable safe verification surface, retain it only if the workflow is branch-safe and least-privilege.

- [ ] **Step 9: Record final completion evidence**

Phase 5B is complete only after fresh evidence proves:

```text
SES identity SUCCESS
DKIM SUCCESS
ProductionAccessEnabled=true
Cognito DEVELOPER delivery configured exactly as approved
sign-up confirmation received
password-reset email received
sender no-reply@seaandshore.in
application health green
no repeating email/runtime errors
```

---

## Plan Self-Review

- Spec coverage: SES identity, 2048-bit DKIM, DNS boundary, sandbox/production-access gate, Cognito cutover, least privilege, rollback, exact-head CI, controlled delivery tests, and explicit non-goals are each mapped to tasks above.
- Placeholder scan: no `TBD`, `TODO`, "implement later", or undefined implementation steps remain.
- Type/name consistency: `ses_domain`, `ses_from_address`, `ses_from_display_name`, `enable_cognito_ses_email`, `transactional_domain`, `cognito_ses_sender`, and the approved configuration-set name are used consistently across tasks.
- Safety check: no unrestricted Terraform app apply, production DNS cutover, `main` work, PR, Vercel shutdown, or Supabase decommission is included.
