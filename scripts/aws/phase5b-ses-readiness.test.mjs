import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const scriptUrl = new URL('./phase5b-ses-readiness.sh', import.meta.url)

test('Phase 5B readiness checks SES production access, identity, DKIM, DNS and Cognito', () => {
  const script = fs.readFileSync(scriptUrl, 'utf8')

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
