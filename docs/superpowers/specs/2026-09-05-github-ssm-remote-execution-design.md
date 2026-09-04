# GitHub-to-SSM Remote Execution Design

Date: 2026-09-05
Status: Approved from prior in-chat design and user instruction to implement

## Goal

Allow the Sea N Shore migration workflow to execute repository-controlled verification commands on the existing AWS bootstrap EC2 instance without requiring repeated manual Session Manager copy/paste.

## Architecture

GitHub Actions continues to authenticate to AWS through the existing staging OIDC role. A dedicated workflow reacts to pushes on `feat/aws-native-phase-0-1`, assumes the staging role, discovers the single running EC2 instance tagged `Name=sea-n-shore-bootstrap`, and invokes `AWS-RunShellScript` through Systems Manager Run Command.

The remote command does not accept arbitrary user-provided shell. It fetches the exact GitHub commit that triggered the workflow, resets the existing isolated worktree to that commit, then runs the repository-owned `scripts/aws/remote-verify.sh`. GitHub polls the SSM command, fails when the remote command fails, and copies only SSM stdout/stderr into the Actions log.

## Security Boundary

- Reuse the existing GitHub Actions OIDC role and `staging` GitHub Environment.
- Add only `ec2:DescribeInstances`, `ssm:SendCommand`, `ssm:GetCommandInvocation`, and `ssm:ListCommandInvocations` needed for remote execution.
- Restrict SSM instance targeting to EC2 resources tagged `Name=sea-n-shore-bootstrap`.
- Restrict the SSM document to AWS-managed `AWS-RunShellScript`.
- Do not grant GitHub IAM administration, Secrets Manager read, Session Manager interactive shell, or unrestricted remote command input.
- Do not accept arbitrary shell text as a workflow input.
- Do not print passwords, Cognito tokens, database secrets, OAuth secrets, or GitHub credentials.
- Keep the temporary EC2 AdministratorAccess cleanup as a later migration hardening task; this change does not broaden the EC2 role.

## One-Time Bootstrap

The current GitHub role cannot grant itself SSM permissions. A repository script, `scripts/aws/bootstrap-github-ssm-execution.sh`, will therefore perform one one-time IAM inline-policy update when run from the existing admin-capable bootstrap EC2 instance. The Terraform source is changed to describe the same permissions so the bootstrap remains declarative after that one-time enablement.

After the bootstrap, failed or future GitHub remote-execution runs can be re-run without additional manual AWS shell work.

## Remote Verification Behavior

`scripts/aws/remote-verify.sh` is the only repository-controlled entry point executed by the automatic workflow. It:

1. validates the expected repository/worktree paths;
2. ensures Node and the existing dependencies are available;
3. validates shell scripts and Terraform formatting/configuration when relevant;
4. runs targeted tests for Phase 4 database/auth changes when present;
5. runs typecheck/lint/test gates for application changes according to the migration branch state;
6. exits non-zero on the first failed verification.

The script may evolve through normal reviewed commits as migration tasks change. Because the workflow executes the exact triggering commit, every remote verification is reproducible from Git history.

## Trigger and Concurrency

The workflow triggers automatically on pushes to `feat/aws-native-phase-0-1` that touch application, AWS infrastructure, migration scripts, package configuration, or the workflow itself. It also supports manual dispatch for recovery. A concurrency group cancels stale in-progress verification when a newer commit arrives.

## Failure Handling

- Missing bootstrap instance: fail before SendCommand.
- More than one matching running bootstrap instance: fail rather than pick one.
- SSM command failure/timeout/cancel: surface stdout/stderr and fail the workflow.
- Git fetch/reset failure: fail remotely; do not run tests against stale code.
- Verification failure: preserve Supabase/AWS runtime state; this workflow is verification-only and does not perform application cutover or destructive Terraform apply.

## Success Criteria

The feature is ready when:

1. Terraform validates with the new least-privilege SSM permissions.
2. The one-time bootstrap script updates the live GitHub role without exposing credentials.
3. A push to the migration branch starts the remote verification workflow.
4. The workflow targets only `sea-n-shore-bootstrap` and runs the exact triggering commit.
5. Remote stdout/stderr appears in GitHub Actions.
6. A failing remote verification fails the workflow; a passing verification succeeds.
7. No arbitrary shell workflow input or secret-printing path exists.
