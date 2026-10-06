import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { guardAction } from './guard-value.mjs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('signup recovery email: guarded, pinned to the 14 audited people, one send each, never an address in output', () => {
  assert.equal(existsSync(new URL('../../.github/workflows/aws-signup-recovery-email.yml', import.meta.url)), true)
  assert.ok(['plan', 'send-once'].includes(guardAction(read('./signup-recovery-email-action.txt'))))
  const script = read('./signup-recovery-email.sh')
  assert.match(script, /SIGNUP_RECOVERY_EMAIL_EXPECTED_SHA/)
  assert.match(script, /EXPECTED_ACCOUNT="310356785722"/)

  // Exactly the 14 people from audit run 37491583916, by Cognito id prefix; refuse more than 14.
  assert.match(script, /GOOGLE = \['f1a3bdda', '21932d1a', '2143edaa', '21438d4a', '51532d2a', '01b38d3a', 'b1d3fd1a'\]/)
  assert.match(script, /EMAIL = \['51232d5a', 'd1731d1a', '11634d1a', '01435d9a', 'f1c32d1a', 'c1f38d9a', '1163dd8a'\]/)
  assert.match(script, /MAX_RECIPIENTS = 14/)
  assert.match(script, /Refusing: \{len\(eligible\)\} recipients exceeds the cap/)
  assert.match(script, /the pinned recipient list is not exactly 14 distinct people/)

  // Re-checked right before each send: no profile (this login or the same address), enabled,
  // not a test address, still in the audited state, never emailed before.
  for (const reason of ['not_found', 'ambiguous', 'disabled', 'no_email', 'test_address', 'state_changed', 'has_profile', 'already_sent']) {
    assert.ok(script.includes(`'skipped:${reason}'`), reason)
  }
  const sendLoop = script.slice(script.indexOf('outcomes = []'))
  assert.match(sendLoop, /result, sub, address = check\(prefix, group, subs_by_prefix\(\)\[prefix\]\)/)
  // The ledger row is written before the HTTP call, so a re-run can never send twice.
  assert.ok(sendLoop.indexOf("'ledger_sending'") < sendLoop.indexOf('urllib.request.urlopen'))
  assert.match(script, /action in \(:sending, :sent\)/)
  assert.match(script, /'Idempotency-Key': 'signup-recovery-2026-10\/' \+ sub/)
  assert.equal((script.match(/insert into public\.audit_events/g) || []).length, 2)
  assert.doesNotMatch(script, /\b(update|delete)\s+(from\s+)?public\./i)
  assert.doesNotMatch(script, /admin-(delete|disable|enable|update|link|create|set)/)

  // The only outbound call is the existing Resend sender's API with its account-email address.
  assert.match(script, /RESEND_ENDPOINT = 'https:\/\/api\.resend\.com\/emails'/)
  assert.equal((script.match(/https:\/\/api\./g) || []).length, 1)
  const fromDefault = /cognito_email_from_address[\s\S]*?default\s*=\s*"([^"]+)"/.exec(read('../../infra/aws/app/cognito-email-sender.tf'))?.[1]
  assert.match(script, new RegExp(`EMAIL_FROM = '${fromDefault}'`))
  assert.match(script, /RESEND_SECRET_ID="sea-n-shore\/resend"/)

  // Never an address in output: output lines carry only id (8 chars), group and result.
  assert.match(script, /json\.dumps\(\{'id': prefix, 'group': group, 'result': result\}/)
  for (const line of script.split('\n').filter((l) => /\bprint\(/.test(l))) {
    assert.doesNotMatch(line, /address|attrs|api_key|secret|email'\)/, line.trim())
  }
  // The address only ever goes to Resend's "to" field and to the database checks as a parameter.
  const uses = script.split('\n').filter((l) => /\baddress\b/.test(l) && !/^\s*#/.test(l) && !/def test_address|test_address\(address\)|VALID_ADDRESS\.match\(address\)|address = |return 'eligible', sub, address|result, sub, address = |domain = address/.test(l))
  assert.deepEqual(uses.map((l) => l.trim()), [
    "if E2E_ADDRESS.match(address) or domain == 'auth.seaandshore.in':",
    `"""('eligible', sub, address) or ('skipped:<reason>', sub, None), from a fresh read."""`,
    `where (provider = 'cognito' and provider_subject = :sub) or lower(coalesce(email, '')) = :address""",`,
    "{'sub': sub, 'address': address})",
    "'to': [address],",
  ])

  // The owner's texts, exactly.
  assert.ok(script.includes(`'subject': "Sorry — your Sea N Shore sign-up didn't finish"`))
  assert.ok(script.includes(`"You tried to join Sea N Shore with Google on 30 Sept or 1 Oct, but a problem on our side stopped your profile from being created. That's fixed now."`))
  assert.ok(script.includes(`"Just sign in again with the same Google account and you'll go straight to setting up your profile: https://seanshore.in/auth/sign-in"`))
  assert.ok(script.includes(`'Sorry for the trouble, and welcome aboard.'`))
  assert.ok(script.includes(`'subject': 'Finish joining Sea N Shore'`))
  assert.ok(script.includes(`"You confirmed your email for Sea N Shore but didn't get as far as signing in. We've since fixed an issue that made the sign-up page fail for some people."`))
  assert.ok(script.includes(`'Sign in with the email and password you chose to set up your profile: https://seanshore.in/auth/sign-in'`))
  assert.ok(script.includes(`'Forgot the password? Use "Forgot password" on that page.'`))
  assert.equal((script.match(/'— The Sea N Shore team'/g) || []).length, 2)
  assert.match(script, /FOOTER = "You're receiving this because you started signing up at seanshore\.in\."/)

  assert.match(script, /SIGNUP_RECOVERY_EMAIL_PLAN_ONLY_NO_CHANGES/)
  assert.match(script, /SIGNUP_RECOVERY_EMAIL_VERIFIED=true/)

  // Sending waits for the owner in staging-apply; only plan skips it.
  const workflow = read('../../.github/workflows/aws-signup-recovery-email.yml')
  assert.match(workflow, /plan\|discover\) echo "approval=false"/)
  assert.match(workflow, /environment: staging-apply/)
  assert.match(workflow, /Guard the send against a moved branch/)
  assert.match(workflow, /case "\$ACTION" in plan\|send-once\) ;;/)
})
