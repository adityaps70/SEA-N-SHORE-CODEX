import assert from 'node:assert/strict'
import fs from 'node:fs'

const sql = fs.readFileSync('infra/aws/database/migrations/0031_multi_login_identity.sql', 'utf8')

assert.match(sql, /add column if not exists provider_username text/i)
assert.match(sql, /add column if not exists email_verified boolean/i)
assert.match(sql, /add column if not exists phone_number text/i)
assert.match(sql, /add column if not exists phone_number_verified boolean/i)
assert.match(sql, /drop constraint if exists identity_accounts_profile_id_provider_key/i)
assert.match(sql, /identity_accounts_verified_email_idx/i)
assert.match(sql, /identity_accounts_verified_phone_idx/i)
assert.match(sql, /where provider = 'cognito'\s+and email is not null/i)
assert.match(sql, /set email_verified = true/i)
assert.doesNotMatch(sql, /drop table/i)
assert.doesNotMatch(sql, /drop column/i)
assert.doesNotMatch(sql, /truncate/i)
assert.doesNotMatch(sql, /delete from/i)

console.log('MULTI_LOGIN_IDENTITY_SCHEMA_CONTRACT_VERIFIED=true')
