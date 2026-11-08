import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { guardAction } from './guard-value.mjs'

test('Cognito Google/native duplicate repair is guarded and fail-closed', async () => {
  const scriptUrl = new URL('./cognito-google-native-link-repair.sh', import.meta.url)
  const actionUrl = new URL('./cognito-google-native-link-repair-action.txt', import.meta.url)
  const workflowUrl = new URL('../../.github/workflows/aws-cognito-google-native-link-repair.yml', import.meta.url)

  assert.equal(existsSync(scriptUrl), true)
  assert.equal(existsSync(actionUrl), true)
  assert.equal(existsSync(workflowUrl), true)

  const action = guardAction(await readFile(actionUrl, 'utf8'))
  assert.ok(['plan', 'repair-once', 'send-reset-once'].includes(action))

  const script = await readFile(scriptUrl, 'utf8')
  assert.match(script, /EXPECTED_ACCOUNT="310356785722"/)
  assert.match(script, /COGNITO_GOOGLE_NATIVE_LINK_REPAIR_EXPECTED_SHA/)
  assert.match(script, /plan\|repair-once\|send-reset-once/)
  assert.match(script, /UserStatus.*EXTERNAL_PROVIDER/)
  assert.match(script, /email_verified/)
  assert.match(script, /onboarding_completed_at/)
  assert.match(script, /admin-delete-user/)
  assert.match(script, /admin-link-provider-for-user/)
  assert.match(script, /ProviderAttributeName=Cognito_Subject/)
  assert.match(script, /COGNITO_GOOGLE_LINKED_NATIVE_USERS=/)
  assert.match(script, /COGNITO_GOOGLE_LINKED_EMAIL_RESOLUTION_OK=/)
  assert.match(script, /COGNITO_GOOGLE_LINKED_EMAIL_RESOLUTION_MISMATCH=/)
  assert.match(script, /COGNITO_GOOGLE_HISTORICAL_REPAIR_TARGETS=/)
  assert.match(script, /forgot-password/)
  assert.match(script, /COGNITO_GOOGLE_HISTORICAL_RESET_SENT=true/)
  assert.match(script, /COGNITO_GOOGLE_NATIVE_REPAIR_PLAN_ONLY_NO_APPLY=true/)
  assert.match(script, /COGNITO_GOOGLE_NATIVE_REPAIR_APPLY_VERIFIED=true/)
  assert.doesNotMatch(script, /echo .*candidate\['email'\]/)

  const workflow = await readFile(workflowUrl, 'utf8')
  assert.match(workflow, /name: AWS Cognito Google Native Link Repair/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /Guard repair against a moved branch/)
  assert.match(workflow, /environment:\s*staging/)
  assert.match(workflow, /COGNITO_GOOGLE_NATIVE_LINK_REPAIR_EXPECTED_SHA/)
})

// Hotfix P1 (owner's decision): link only the pairs that pass every database check, leave the others exactly as
// they are, and say which check each unsafe pair failed and whether an administrator is among the safe pairs.
test('repair links only safe pairs and reports why the others are unsafe (codes and counts only)', async () => {
  const { spawnSync } = await import('node:child_process')
  const script = await readFile(new URL('./cognito-google-native-link-repair.sh', import.meta.url), 'utf8')
  assert.doesNotMatch(script, /unsafe_candidate_refused/)
  assert.match(script, /if not db_verified:\n    raise SystemExit\('no_safe_candidates'\)/)
  assert.match(script, /COGNITO_GOOGLE_NATIVE_REPAIR_LEFT_UNLINKED=/)
  assert.match(script, /COGNITO_GOOGLE_NATIVE_REPAIR_UNSAFE_REASON=\{reason\}\|/)
  assert.match(script, /COGNITO_PLATFORM_ADMIN_PROFILES=/)
  assert.match(script, /COGNITO_GOOGLE_ONLY_PLATFORM_ADMIN_USERS=/)
  // An administrator role held only by the Google profile would be lost by linking, so that pair is left alone.
  assert.match(script, /reason = 'admin_role_only_on_google_profile'/)
  assert.match(script, /COGNITO_GOOGLE_NATIVE_REPAIR_SAFE_PLATFORM_ADMIN_CANDIDATES=/)
  assert.match(script, /COGNITO_GOOGLE_NATIVE_REPAIR_UNSAFE_PLATFORM_ADMIN_CANDIDATES=/)
  // Only safe pairs are deleted and linked; the plan still stops before any change.
  const planAt = script.indexOf("if action == 'plan':")
  assert.ok(planAt > script.indexOf('COGNITO_GOOGLE_NATIVE_REPAIR_SAFE_PLATFORM_ADMIN_CANDIDATES='))
  assert.ok(planAt < script.indexOf("'admin-delete-user'"))
  assert.match(script, /for candidate in db_verified:\n    run_json\('delete_external_user'/)
  // Nothing personal is printed: no email, username, sub or profile id in any evidence line.
  for (const line of script.split('\n').filter((l) => /print\(f?'COGNITO_GOOGLE/.test(l))) {
    assert.doesNotMatch(line, /\{(candidate|target|email|user|native|google)\b|\['(email|native_sub|google_sub|native_username|google_username|profile_id|provider_subject)'\]/, line)
  }

  const start = script.indexOf('# unsafe-reason:begin\n')
  const end = script.indexOf('# unsafe-reason:end')
  const source = script.slice(start, end)
  const cases = [
    [[{ completed: true, account_status: 'active', profile_id: 'p1' }], [], null],
    [[{ completed: true, account_status: 'active', profile_id: 'p1' }], [{ profile_id: 'p1', completed: true, account_status: 'active' }], null],
    [[{ completed: true, account_status: 'restricted', profile_id: 'p1' }], [{ profile_id: 'p2', completed: false, account_status: 'active' }], null],
    [[], [], 'native_identity_not_unique'],
    [[{ completed: true, account_status: 'active' }, { completed: true, account_status: 'active' }], [], 'native_identity_not_unique'],
    [[{ completed: false, account_status: 'active', profile_id: 'p1' }], [], 'native_profile_onboarding_incomplete'],
    [[{ completed: true, account_status: 'suspended', profile_id: 'p1' }], [], 'native_profile_not_active'],
    [[{ completed: true, account_status: 'active', profile_id: 'p1' }], [{ profile_id: 'p2' }, { profile_id: 'p3' }], 'google_identity_not_unique'],
    [[{ completed: true, account_status: 'active', profile_id: 'p1' }], [{ profile_id: 'p2', completed: true, account_status: 'active' }], 'google_profile_separate_and_in_use'],
    [[{ completed: true, account_status: 'active', profile_id: 'p1' }], [{ profile_id: 'p2', completed: false, account_status: 'deleted' }], 'google_profile_not_active'],
  ]
  const program = `${source}\nimport json, sys\ncases = json.loads(sys.argv[1])\nprint(json.dumps([unsafe_reason(n, g) for n, g, _ in cases]))\n`
  const run = spawnSync('python3', ['-c', program, JSON.stringify(cases)], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(JSON.parse(run.stdout), cases.map((c) => c[2]))
})

// The repair deletes the separate Google Cognito user, so in the same guarded run it deletes that user's identity
// row too: left behind, the row's subject is issued by no Cognito user and the parity audit fails on it (21 Oct
// repair-once left five such rows).
test('repair deletes the deleted Google user\'s identity row in the same run, and only that row', async () => {
  const { spawnSync } = await import('node:child_process')
  const script = await readFile(new URL('./cognito-google-native-link-repair.sh', import.meta.url), 'utf8')

  // Order: plan exits first; then per pair delete the Google user, link, verify the link, and only then the row.
  const planAt = script.indexOf("if action == 'plan':")
  const loop = script.slice(script.indexOf('for candidate in db_verified:\n    run_json'))
  assert.ok(planAt < script.indexOf('google_identities_removed += delete_google_identity(candidate)'))
  const order = ["run_json('delete_external_user'", "run_json('link_provider_user'", "run_json('verify_link'",
    "raise SystemExit('linked_identity_verification_failed')", 'google_identities_removed += delete_google_identity(candidate)',
    'COGNITO_GOOGLE_NATIVE_REPAIR_GOOGLE_IDENTITIES_REMOVED=', 'COGNITO_GOOGLE_NATIVE_REPAIR_APPLY_VERIFIED=true']
  const at = order.map((needle) => loop.indexOf(needle))
  assert.ok(at.every((i) => i >= 0), JSON.stringify(at))
  assert.deepEqual([...at].sort((a, b) => a - b), at)
  assert.match(script, /candidate\['google_identity_profile'\] = google_rows\[0\]\.get\('profile_id'\) if google_rows else None/)
  assert.ok(script.indexOf('COGNITO_GOOGLE_NATIVE_REPAIR_GOOGLE_IDENTITIES_TO_REMOVE=') < planAt)

  // Behaviour of delete_google_identity with a stub run_json: what it sends, and when it refuses.
  const source = script.slice(script.indexOf('# delete-google-identity:begin\n'), script.indexOf('# delete-google-identity:end'))
  const program = `import json, sys
region, cluster_arn, secret_arn, database = 'ap-south-1', 'arn:cluster', 'arn:secret', 'sea_n_shore'
case = json.loads(sys.argv[1])
calls = []
def run_json(label, args):
    calls.append({'label': label, 'sql': args[args.index('--sql') + 1], 'parameters': json.loads(args[args.index('--parameters') + 1])})
    return {'formattedRecords': json.dumps(case['returned'])}
${source}
try:
    result = delete_google_identity(case['candidate'])
except SystemExit as error:
    result = str(error)
print(json.dumps({'result': result, 'calls': calls}))
`
  const run = (candidate, returned) => {
    const r = spawnSync('python3', ['-c', program, JSON.stringify({ candidate, returned })], { encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    return JSON.parse(r.stdout)
  }
  const candidate = { google_sub: 'gsub-1', google_identity_profile: '11111111-1111-1111-1111-111111111111' }

  const removed = run(candidate, [{ profile_id: candidate.google_identity_profile }])
  assert.equal(removed.result, 1)
  assert.equal(removed.calls.length, 1)
  assert.match(removed.calls[0].sql, /^delete from public\.identity_accounts\s+where provider = 'cognito'\s+and provider_subject = :google_sub\s+and profile_id = cast\(:profile as uuid\)/)
  assert.deepEqual(removed.calls[0].parameters, [
    { name: 'google_sub', value: { stringValue: 'gsub-1' } },
    { name: 'profile', value: { stringValue: candidate.google_identity_profile } },
  ])

  // A pair whose Google user never had an identity row sends nothing.
  assert.deepEqual(run({ google_sub: 'gsub-2', google_identity_profile: null }, []), { result: 0, calls: [] })
  // The row must be there exactly once, on the expected profile; anything else stops the run.
  assert.equal(run(candidate, []).result, 'google_identity_delete_count_mismatch')
  assert.equal(run(candidate, [{ profile_id: 'other' }]).result, 'google_identity_delete_count_mismatch')
  assert.equal(run(candidate, [{ profile_id: candidate.google_identity_profile }, { profile_id: candidate.google_identity_profile }]).result,
    'google_identity_delete_count_mismatch')
})
