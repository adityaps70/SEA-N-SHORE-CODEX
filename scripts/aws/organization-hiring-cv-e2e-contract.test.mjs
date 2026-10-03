import assert from 'node:assert/strict'
import fs from 'node:fs'

const script = fs.readFileSync('scripts/aws/organization-hiring-staging-e2e.mjs', 'utf8')

assert.match(script, /setInputFiles/)
assert.match(script, /Attach CV \(PDF\)/)
assert.match(script, /Submit application/)
assert.match(script, /View CV \(PDF\)/)
assert.match(script, /ORGANIZATION_HIRING_E2E_CV_UPLOAD_REVIEW_VERIFIED=true/)

console.log('ORGANIZATION_HIRING_CV_E2E_CONTRACT_VERIFIED=true')
