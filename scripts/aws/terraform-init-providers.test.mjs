import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'

// Host Terraform runners get providers from the registry. The persistent worktree's provider cache predates
// hashicorp/random, so `init -plugin-dir=<that cache>` failed (Social Events, Origin TLS, Social Shared IAM State).
const dir = new URL('./', import.meta.url)
const scripts = readdirSync(dir).filter((n) => n.endsWith('.sh')).map((n) => ({ name: n, text: readFileSync(new URL(n, dir), 'utf8') }))
const lock = readFileSync(new URL('../../infra/aws/app/.terraform.lock.hcl', import.meta.url), 'utf8')
const required = [...readFileSync(new URL('../../infra/aws/app/main.tf', import.meta.url), 'utf8').matchAll(/source\s+=\s+"([a-z0-9-]+\/[a-z0-9-]+)"/g)].map((m) => m[1])

test('no host Terraform init uses a local plugin directory', () => {
  for (const { name, text } of scripts) assert.doesNotMatch(text, /-plugin-dir/, name)
})

test('an app init with a read-only lock file only happens when the lock file pins every required provider', () => {
  assert.ok(required.includes('hashicorp/random'))
  const pinned = required.every((source) => lock.includes(`provider "registry.terraform.io/${source}"`))
  for (const { name, text } of scripts) {
    if (/terraform -chdir="\$APP_DIR" init[^\n]*-lockfile=readonly/.test(text)) assert.ok(pinned, `${name}: -lockfile=readonly but the app lock file does not pin ${required.join(', ')}`)
  }
})
