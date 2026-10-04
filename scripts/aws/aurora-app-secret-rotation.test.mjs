// Round 14 (2.12): the app secret rotation Lambda only ever sets a password on a plain role name.
import assert from 'node:assert/strict'
import { register } from 'node:module'
import test from 'node:test'

// The Lambda runtime provides the RDS Data API client; it is not a repository dependency.
const stub = 'data:text/javascript,' + encodeURIComponent('export class RDSDataClient { send() {} } export class ExecuteStatementCommand {}')
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(specifier, context, next) {
  if (specifier === '@aws-sdk/client-rds-data') return { url: ${JSON.stringify(stub)}, shortCircuit: true }
  return next(specifier, context)
}`))
const { alterRoleStatement } = await import('../../infra/aws/app/lambda/aurora-app-secret-rotation.mjs')

test('builds the ALTER ROLE only for a plain role name and a generated alphanumeric password', () => {
  const password = 'A'.repeat(40)
  assert.equal(alterRoleStatement('sea_n_shore_app', password), `alter role sea_n_shore_app with login password '${password}'`)
  assert.throws(() => alterRoleStatement('sea_n_shore_app; drop table x', password), /invalid_app_role/)
  assert.throws(() => alterRoleStatement('sea_n_shore_app', "abc'; drop table x; --"), /invalid_generated_password/)
  assert.throws(() => alterRoleStatement('sea_n_shore_app', 'short'), /invalid_generated_password/)
})
