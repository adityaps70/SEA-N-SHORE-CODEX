import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('live Google auth probe is bounded to the canonical site and expected Cognito domain', async () => {
  const script = await readFile(new URL('./google-auth-live-probe.sh', import.meta.url), 'utf8')

  assert.match(script, /https:\/\/seanshore\.in/)
  assert.match(script, /sea-n-shore-staging-310356785722\.auth\.ap-south-1\.amazoncognito\.com/)
  assert.match(script, /Continue with Google/)
  assert.match(script, /for intent in sign-in sign-up/)
  assert.match(script, /identity_provider=Google/)
  assert.match(script, /aws\.cognito\.signin\.user\.admin/)
  assert.match(script, /prompt=select_account/)
  assert.match(script, /https:\/\/accounts\.google\.com/)
  assert.match(script, /GOOGLE_BUTTON_VERIFIED/)
  assert.match(script, /GOOGLE_COGNITO_START_VERIFIED=/)
  assert.match(script, /GOOGLE_PROVIDER_REDIRECT_VERIFIED=/)
  assert.match(script, /GOOGLE_AUTH_LIVE_VERIFIED=true/)
  assert.doesNotMatch(script, /aws\s+(ecs|cognito-idp|secretsmanager)\s+(update|create|delete|register)/)
})
