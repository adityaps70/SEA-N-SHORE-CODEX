import assert from 'node:assert/strict'
import test from 'node:test'
import { isOriginAllowed, parseAllowedOrigins } from '../../infra/aws/app/lambda/realtime-authorizer.mjs'

test('realtime authorizer parses the comma-separated origin list exactly', () => {
  assert.deepEqual(
    parseAllowedOrigins('https://seanshore.in,https://d3prih0q6jofyr.cloudfront.net/'),
    ['https://seanshore.in', 'https://d3prih0q6jofyr.cloudfront.net'],
  )
  assert.deepEqual(parseAllowedOrigins(' https://seanshore.in , ,https://seanshore.in/ '), ['https://seanshore.in'])
  assert.deepEqual(parseAllowedOrigins(undefined), [])
})

test('realtime authorizer allows only the listed browser origins', () => {
  const origins = parseAllowedOrigins('https://seanshore.in,https://d3prih0q6jofyr.cloudfront.net')
  assert.equal(isOriginAllowed('https://seanshore.in', origins), true)
  assert.equal(isOriginAllowed('https://seanshore.in/', origins), true)
  assert.equal(isOriginAllowed('https://d3prih0q6jofyr.cloudfront.net', origins), true)
  assert.equal(isOriginAllowed('https://www.seanshore.in', origins), false)
  assert.equal(isOriginAllowed('http://seanshore.in', origins), false)
  assert.equal(isOriginAllowed('https://seanshore.in.evil.example', origins), false)
  assert.equal(isOriginAllowed('https://seaandshore.in', origins), false)
  // Non-browser clients send no Origin header; the signed ticket still gates them.
  assert.equal(isOriginAllowed('', origins), true)
})
