// Round 14: one Terraform runner at a time on the bootstrap host (queued with flock, never cancelled),
// tight path filters, signal-safe work-dir cleanup, and the runner fixes that came out of the congestion.
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
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
