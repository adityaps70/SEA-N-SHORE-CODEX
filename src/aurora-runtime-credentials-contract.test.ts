import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function read(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

describe('Aurora runtime credential rotation contract', () => {
  it('lets the running ECS task fetch the current RDS-managed secret after rotation', () => {
    const packageJson = JSON.parse(read('package.json')) as { dependencies?: Record<string, string> }
    const client = read('src/lib/db/client.ts')
    const mainTf = read('infra/aws/app/main.tf')
    const runtimeTf = read('infra/aws/app/ecs-database-runtime.tf')

    expect(packageJson.dependencies?.['@aws-sdk/client-secrets-manager']).toBe('3.1095.0')
    expect(client).toContain("from '@aws-sdk/client-secrets-manager'")
    expect(client).toContain('process.env.AURORA_SECRET_ARN')
    expect(client).toContain('new GetSecretValueCommand({ SecretId: secretArn })')
    expect(client).toContain('credentialProvider: runtimeCredentialProvider')

    expect(mainTf).toContain('{ name = "AURORA_SECRET_ARN", value = local.aurora_master_secret_arn }')
    expect(runtimeTf).toContain('role = aws_iam_role.ecs_task.id')
    expect(runtimeTf).toContain('Action   = ["secretsmanager:GetSecretValue"]')
    expect(runtimeTf).toContain('Resource = local.aurora_master_secret_arn')
  })
})
