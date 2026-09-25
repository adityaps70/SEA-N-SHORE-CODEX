import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

const scriptUrl = new URL('./phase5b-ses-readiness.sh', import.meta.url)

test('Phase 5B readiness checks SES production access, identity, DKIM, DNS and Cognito', () => {
  const script = fs.readFileSync(scriptUrl, 'utf8')

  assert.match(script, /seanshore\.in/)
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


test('Phase 5B discovery audits the SES domain DNS before migration', () => {
  const script = fs.readFileSync(scriptUrl, 'utf8')

  assert.match(script, /route53 list-hosted-zones-by-name/)
  assert.match(script, /ROUTE53_SES_ZONE_COUNT=/)
  assert.match(script, /ROUTE53_SES_ZONE_ID=/)
  assert.match(script, /ROUTE53_SES_ZONE_AUDIT=UNAVAILABLE/)
  assert.match(script, /if aws route53 list-hosted-zones-by-name/)
  assert.match(script, /LIVE_DNS_A_BEGIN/)
  assert.match(script, /LIVE_DNS_WWW_BEGIN/)
  assert.match(script, /LIVE_DNS_MX_BEGIN/)
  assert.match(script, /LIVE_DNS_TXT_BEGIN/)
  assert.match(script, /LIVE_DNS_CAA_BEGIN/)
  assert.match(script, /dig \+short A "\$SES_DOMAIN"/)
  assert.match(script, /dig \+short MX "\$SES_DOMAIN"/)
  assert.match(script, /dig \+short TXT "\$SES_DOMAIN"/)
  assert.match(script, /dig \+short CAA "\$SES_DOMAIN"/)
})

test('Phase 5B discovery reports SES production-access review status', () => {
  const script = fs.readFileSync(scriptUrl, 'utf8')

  assert.match(script, /sesv2 get-account/)
  assert.match(script, /ReviewDetails\.Status/)
  assert.match(script, /SES_PRODUCTION_ACCESS_REVIEW_STATUS=/)
  assert.match(script, /SES_PRODUCTION_ACCESS_REVIEW_CASE_ID=/)
})
