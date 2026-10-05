import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('identity cleanup deletes only unmapped E2E test users and the one stale focus row', () => {
  assert.equal(existsSync(new URL('../../.github/workflows/aws-identity-cleanup.yml', import.meta.url)), true)
  assert.ok(['plan', 'run-once', 'accounts-once'].includes(read('./identity-cleanup-action.txt').trim()))
  const script = read('./identity-cleanup.sh')
  assert.match(script, /IDENTITY_CLEANUP_EXPECTED_SHA/)
  assert.match(script, /EXPECTED_ACCOUNT="310356785722"/)
  // Only the disposable E2E addresses, and only users without a profile mapping.
  assert.match(script, /\^sea-n-shore-e2e-\[0-9\]\+-\(seafarer\|shore\|recruiter\|trainer\|student\|family\|enthusiast\|other\)@example\\\.com\$/)
  assert.match(script, /if E2E_EMAIL\.match\(email\) and sub not in mapped:/)
  assert.match(script, /MAX_E2E_DELETIONS=60/)
  assert.match(script, /an E2E target gained a profile before deletion/)
  // The stale row: exactly one, the 09-03 email sign-in, its Cognito user gone, two live sign-ins kept.
  assert.match(script, /STALE_ROW_CREATED_DAY="2026-09-03"/)
  assert.match(script, /len\(stale\) == 1 and stale\[0\]\['created_day'\] == stale_day/)
  assert.match(script, /and len\(live\) == 2/)
  assert.match(script, /where id = cast\(:id as uuid\) and provider = 'cognito' and provider_subject = :sub/)
  assert.match(script, /the focus member would not keep exactly two sign-ins/)
  assert.match(script, /non_e2e_after != non_e2e_unmapped/)
  assert.match(script, /IDENTITY_CLEANUP_PLAN_ONLY_NO_CHANGES/)
  assert.match(script, /IDENTITY_CLEANUP_VERIFIED=true/)
  // No bulk deletes, no profile deletes, no other Cognito writes.
  // Profiles are only deleted one at a time, by id, with the E2E-only and non-admin checks in the statement.
  assert.equal((script.match(/delete from public\.profiles/gi) || []).length, 1)
  assert.match(script, /delete from public\.profiles p\n\s+where p\.id = cast\(:id as uuid\)/)
  assert.doesNotMatch(script, /admin-(disable|enable|update|link|create)/)
  // The focus member's address is never printed.
  assert.doesNotMatch(script, /IDENTITY_CLEANUP_FOCUS_ROW=.*'email'/)
  // accounts-once: whole E2E accounts, only when every sign-in is an E2E address and never an administrator.
  assert.match(script, /ANY_E2E_EMAIL = re\.compile\(r'\^sea-n-shore-\(\?:\(realtime\|events\|hiring\|learning-review\)-\)\?e2e-\[0-9\]\+-\[a-z\]\+@example\\\.com\$'\)/)
  assert.match(script, /all_e2e = all\(ANY_E2E_EMAIL\.match\(r\['email'\]\) for r in prow\)/)
  assert.match(script, /if all_e2e and not prow\[0\]\['is_admin'\]:/)
  assert.match(script, /and not exists \(select 1 from public\.user_roles r where r\.user_id = p\.id and r\.role::text = 'administrator'\)/)
  assert.match(script, /lower\(coalesce\(ia\.email, ''\)\) !~ '\^sea-n-shore-/)
  assert.match(script, /MAX_E2E_ACCOUNTS = 600/)
  assert.match(script, /IDENTITY_CLEANUP_E2E_ACCOUNTS_VERIFIED=true/)
  const workflow = read('../../.github/workflows/aws-identity-cleanup.yml')
  assert.match(workflow, /environment: staging-apply/)
  assert.match(workflow, /Guard cleanup against a moved branch/)
})
