// Round 14: one Terraform runner at a time on the bootstrap host (queued with flock, never cancelled),
// tight path filters, signal-safe work-dir cleanup, and the runner fixes that came out of the congestion.
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const read = (path) => readFileSync(path, 'utf8')
const workflows = readdirSync('.github/workflows').filter((name) => name.endsWith('.yml')).map((name) => `.github/workflows/${name}`)
const scripts = readdirSync('scripts/aws').filter((name) => name.endsWith('.sh')).map((name) => `scripts/aws/${name}`)
const triggerPaths = (path) => read(path).split('\njobs:')[0]

const terraformRunners = [
  'cognito-custom-domain-infra', 'ecs-resend-secret-policy', 'ecs-task-aurora-policy', 'ecs-task-cashfree-secret-policy',
  'ecs-task-cognito-admin-policy', 'ecs-task-media-policy-state', 'edge-origin-lockdown-infra', 'edge-recovery',
  'multi-login-auth-infra', 'newsletter-signing-secret', 'origin-tls-certificate', 'phase2-hardening-infra',
  'phase3-reliability-infra', 'realtime-infra', 'seaandshore-domain', 'seanshore-domain-bootstrap',
  'security-hardening-infra', 'ses-identity-state', 'social-events-infra', 'social-shared-iam-state', 'web-resilience-infra',
]

test('every Terraform runner (and disk maintenance) queues on one bootstrap host lock', () => {
  const lock = read('scripts/aws/bootstrap-terraform-lock.sh')
  assert.match(lock, /TERRAFORM_HOST_LOCK_FILE="\/var\/tmp\/sea-n-shore-terraform-host\.lock"/)
  assert.match(lock, /TERRAFORM_HOST_LOCK_WAIT_SECONDS="\$\{TERRAFORM_HOST_LOCK_WAIT_SECONDS:-600\}"/)
  assert.match(lock, /exec 9>>"\$TERRAFORM_HOST_LOCK_FILE"/)
  assert.match(lock, /flock -w "\$TERRAFORM_HOST_LOCK_WAIT_SECONDS" 9 \|\|/)
  assert.doesNotMatch(lock, /flock -n|flock -u/)
  assert.match(lock, /TMPDIR="\$\(mktemp -d \/var\/tmp\/sns-tf\.XXXXXX\)"\n  export TMPDIR/)

  for (const name of [...terraformRunners, 'bootstrap-disk-maintenance']) {
    const script = read(`scripts/aws/${name}.sh`)
    const account = script.search(/get-caller-identity/)
    const lockAt = script.indexOf('source scripts/aws/bootstrap-terraform-lock.sh')
    assert.ok(account > 0 && lockAt > account, `${name} must take the host lock right after its account check`)
    assert.ok(lockAt < script.indexOf('terraform ') || !script.includes('terraform '), `${name} must hold the lock before Terraform runs`)
  }
  // Every script that runs a state-backed Terraform plan or apply is in the list above.
  for (const path of scripts) {
    const script = read(path)
    if (!/terraform[^\n]* (plan|apply)\b/.test(script) || /init -backend=false/.test(script)) continue
    if (path.endsWith('terraform-state-unlock.sh')) continue
    assert.match(script, /source scripts\/aws\/bootstrap-terraform-lock\.sh/, `${path} runs Terraform without the host lock`)
  }
  // The S3 lock escape hatch must never queue behind a wedged runner.
  assert.doesNotMatch(read('scripts/aws/terraform-state-unlock.sh'), /bootstrap-terraform-lock/)
})

test('a merge only triggers the runners whose own files changed', () => {
  const shared = {
    'aws-multi-login-auth-infra': ['infra/aws/app/main.tf', 'infra/aws/app/aws-native-variables.tf', 'scripts/aws/public-site-url.txt'],
    'aws-newsletter-signing-secret': ['infra/aws/app/main.tf'],
    'aws-edge-state-audit': ['infra/aws/app/**'],
    'aws-independence-readiness': ['infra/aws/app/database.tf', 'infra/aws/app/storage.tf'],
    // The one-shot realtime cutover runner; in-place realtime changes go through realtime-typing-infra.
    'aws-realtime-infra': ['infra/aws/app/realtime.tf', 'infra/aws/app/lambda/realtime-connection.mjs', 'infra/aws/app/lambda/realtime-authorizer.mjs', 'infra/aws/app/lambda/realtime-fanout.mjs'],
  }
  for (const [workflow, paths] of Object.entries(shared)) {
    const on = triggerPaths(`.github/workflows/${workflow}.yml`)
    for (const path of paths) assert.ok(!on.includes(`- ${path}\n`), `${workflow} must not trigger on ${path}`)
  }
  assert.match(triggerPaths('.github/workflows/aws-edge-state-audit.yml'), /- infra\/aws\/app\/edge\.tf\n/)
  // No Terraform runner triggers on the shared main.tf or the shared variables file.
  for (const name of terraformRunners) {
    const workflow = `.github/workflows/aws-${name}.yml`
    if (!existsSync(workflow)) continue
    const on = triggerPaths(workflow)
    assert.ok(!on.includes('- infra/aws/app/main.tf\n'), `${workflow} triggers on main.tf`)
  }
})

test('every work-dir cleanup trap also runs on HUP, INT and TERM', () => {
  for (const path of [...workflows, ...scripts]) {
    for (const line of read(path).split('\n')) {
      if (!/^\s*trap '.*' EXIT(;|$)/.test(line)) continue
      assert.match(line, /' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM$/, `${path}: ${line.trim()}`)
    }
  }
})

test('the stale one-shot Aurora retention runner is retired and the Cognito admin runner uses the repository site URL', () => {
  for (const path of ['.github/workflows/aws-aurora-backup-retention.yml', 'scripts/aws/aurora-backup-retention.sh', 'scripts/aws/aurora-backup-retention-action.txt']) {
    assert.ok(!existsSync(path), `${path} should be retired`)
  }
  const cognitoAdmin = read('scripts/aws/ecs-task-cognito-admin-policy.sh')
  assert.match(cognitoAdmin, /PUBLIC_SITE_URL="\$\(tr -d '\[:space:\]' < scripts\/aws\/public-site-url\.txt\)"/)
  assert.match(cognitoAdmin, /site_url = os\.environ\['PUBLIC_SITE_URL'\]/)
  assert.doesNotMatch(cognitoAdmin, /item\['name'\] == 'NEXT_PUBLIC_SITE_URL'/)
})

// Round 14: plans that hang are interrupted and retried once; Terraform runs with a small memory footprint.
function runBoundedPlan(stubBody) {
  const dir = mkdtempSync(join(tmpdir(), 'tf-bounded-'))
  try {
    writeFileSync(join(dir, 'terraform'), `#!/usr/bin/env bash\n${stubBody}\n`)
    chmodSync(join(dir, 'terraform'), 0o755)
    const lock = read('scripts/aws/bootstrap-terraform-lock.sh')
    const source = lock.slice(lock.indexOf('TERRAFORM_PLAN_TIMEOUT_SECONDS="'))
    const script = `set -euo pipefail\n${source}\nset +e\nterraform_plan_bounded "${dir}/plan.log" -chdir=x plan -out=y\necho "STATUS=$?"\ncat "${dir}/plan.log"\n`
    return execFileSync('bash', ['-c', script], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, TERRAFORM_PLAN_TIMEOUT_SECONDS: '1' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('Terraform on the host is bounded: low memory footprint, plans interrupted and retried once', () => {
  const lock = read('scripts/aws/bootstrap-terraform-lock.sh')
  assert.match(lock, /export GOMEMLIMIT="\$\{GOMEMLIMIT:-320MiB\}"/)
  assert.match(lock, /export TF_CLI_ARGS_plan="\$\{TF_CLI_ARGS_plan:--parallelism=4\}"/)
  assert.match(lock, /export TF_CLI_ARGS_apply="\$\{TF_CLI_ARGS_apply:--parallelism=4\}"/)
  assert.match(lock, /timeout --signal=INT --kill-after=120 "\$TERRAFORM_PLAN_TIMEOUT_SECONDS" terraform "\$@"/)
  assert.doesNotMatch(lock, /TF_LOG/)
  for (const runner of ['multi-login-auth-infra', 'edge-recovery']) {
    const script = read(`scripts/aws/${runner}.sh`)
    assert.doesNotMatch(script, /^terraform -chdir="\$APP_DIR" plan /m, `${runner} has an unbounded plan`)
    assert.match(script, /terraform_plan_bounded "\$[A-Z_]+\/[a-z-]+\.log" -chdir="\$APP_DIR" plan /)
  }

  const finished = runBoundedPlan('echo "Plan: 0 to add"')
  assert.match(finished, /STATUS=0/)
  assert.match(finished, /Plan: 0 to add/)
  assert.doesNotMatch(finished, /TIMED_OUT/)

  const failed = runBoundedPlan('echo "Error: bad config" >&2; exit 1')
  assert.match(failed, /STATUS=1/)
  assert.doesNotMatch(failed, /TIMED_OUT/)

  const hung = runBoundedPlan('sleep 30')
  assert.match(hung, /TERRAFORM_PLAN_TIMED_OUT_ATTEMPT=1/)
  assert.match(hung, /TERRAFORM_PLAN_TIMED_OUT_ATTEMPT=2/)
  assert.match(hung, /TERRAFORM_PLAN_TIMED_OUT_MEM_AVAILABLE_MB=\d+/)
  assert.match(hung, /STATUS=124/)
})
