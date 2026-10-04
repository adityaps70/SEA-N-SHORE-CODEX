// Round 14 (2.12): Secrets Manager rotation for the least-privilege app role's own secret.
// Uses the RDS Data API with the master secret (no VPC networking needed). Steps follow the
// Secrets Manager rotation contract: createSecret, setSecret, testSecret, finishSecret.
import {
  DescribeSecretCommand,
  GetRandomPasswordCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
  UpdateSecretVersionStageCommand,
} from '@aws-sdk/client-secrets-manager'
import { ExecuteStatementCommand, RDSDataClient } from '@aws-sdk/client-rds-data'

const secrets = new SecretsManagerClient({})
const rdsData = new RDSDataClient({})
const masterSecretArn = process.env.AURORA_MASTER_SECRET_ARN
const clusterArn = process.env.AURORA_CLUSTER_ARN
const databaseName = process.env.AURORA_DATABASE ?? 'sea_n_shore'
export const APP_ROLE_PATTERN = /^[a-z_][a-z0-9_]{2,62}$/
export const PASSWORD_PATTERN = /^[A-Za-z0-9]{32,64}$/

async function secretJson(secretId, versionStage, versionId) {
  const result = await secrets.send(new GetSecretValueCommand({ SecretId: secretId, VersionStage: versionStage, VersionId: versionId }))
  return JSON.parse(result.SecretString ?? '{}')
}

async function sql(statement) {
  return rdsData.send(new ExecuteStatementCommand({
    resourceArn: clusterArn,
    secretArn: masterSecretArn,
    database: databaseName,
    sql: statement,
  }))
}

export function alterRoleStatement(username, password) {
  if (!APP_ROLE_PATTERN.test(username)) throw new Error('invalid_app_role')
  if (!PASSWORD_PATTERN.test(password)) throw new Error('invalid_generated_password')
  return `alter role ${username} with login password '${password}'`
}

async function createSecret(secretId, token) {
  try {
    await secretJson(secretId, 'AWSPENDING', token)
    return
  } catch (error) {
    if (error?.name !== 'ResourceNotFoundException') throw error
  }
  const current = await secretJson(secretId, 'AWSCURRENT')
  const generated = await secrets.send(new GetRandomPasswordCommand({ PasswordLength: 40, ExcludePunctuation: true, IncludeSpace: false }))
  await secrets.send(new PutSecretValueCommand({
    SecretId: secretId,
    ClientRequestToken: token,
    SecretString: JSON.stringify({ ...current, password: generated.RandomPassword }),
    VersionStages: ['AWSPENDING'],
  }))
}

async function setSecret(secretId, token) {
  const pending = await secretJson(secretId, 'AWSPENDING', token)
  await sql(alterRoleStatement(pending.username, pending.password))
}

async function testSecret(secretId, token) {
  const pending = await secretJson(secretId, 'AWSPENDING', token)
  if (!APP_ROLE_PATTERN.test(pending.username)) throw new Error('invalid_app_role')
  const result = await sql(`select rolcanlogin from pg_roles where rolname = '${pending.username}'`)
  if (result.records?.[0]?.[0]?.booleanValue !== true) throw new Error('app_role_cannot_log_in')
}

async function finishSecret(secretId, token) {
  const described = await secrets.send(new DescribeSecretCommand({ SecretId: secretId }))
  const versions = described.VersionIdsToStages ?? {}
  const currentVersion = Object.keys(versions).find((id) => versions[id].includes('AWSCURRENT'))
  if (currentVersion === token) return
  await secrets.send(new UpdateSecretVersionStageCommand({
    SecretId: secretId,
    VersionStage: 'AWSCURRENT',
    MoveToVersionId: token,
    RemoveFromVersionId: currentVersion,
  }))
}

export async function handler(event) {
  const { SecretId: secretId, ClientRequestToken: token, Step: step } = event
  const described = await secrets.send(new DescribeSecretCommand({ SecretId: secretId }))
  if (!described.RotationEnabled) throw new Error('rotation_not_enabled')
  const stages = described.VersionIdsToStages?.[token]
  if (!stages) throw new Error('unknown_version')
  if (stages.includes('AWSCURRENT')) return
  if (!stages.includes('AWSPENDING')) throw new Error('version_not_pending')

  if (step === 'createSecret') return createSecret(secretId, token)
  if (step === 'setSecret') return setSecret(secretId, token)
  if (step === 'testSecret') return testSecret(secretId, token)
  if (step === 'finishSecret') return finishSecret(secretId, token)
  throw new Error('unknown_step')
}
