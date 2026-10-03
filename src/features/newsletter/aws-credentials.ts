import type { AwsCredentials } from './sigv4'

export type AwsCredentialProvider = () => Promise<AwsCredentials>

type SdkCredentialIdentity = { accessKeyId: string; secretAccessKey: string; sessionToken?: string }

let sdkProvider: (() => Promise<SdkCredentialIdentity>) | null = null

/**
 * Resolves AWS credentials the same way the rest of the app does:
 * static environment variables first (local development), otherwise the AWS SDK
 * default provider chain (ECS task role, instance profile, SSO) borrowed from the
 * Secrets Manager client that the database layer already depends on.
 */
export function createAwsCredentialProvider(env: Record<string, string | undefined> = process.env): AwsCredentialProvider {
  return async () => {
    const accessKeyId = env.AWS_ACCESS_KEY_ID?.trim()
    const secretAccessKey = env.AWS_SECRET_ACCESS_KEY?.trim()
    if (accessKeyId && secretAccessKey) {
      return { accessKeyId, secretAccessKey, sessionToken: env.AWS_SESSION_TOKEN?.trim() || null }
    }

    if (!sdkProvider) {
      const { SecretsManagerClient } = await import('@aws-sdk/client-secrets-manager')
      const client = new SecretsManagerClient({})
      sdkProvider = client.config.credentials as () => Promise<SdkCredentialIdentity>
    }
    const identity = await sdkProvider()
    if (!identity?.accessKeyId || !identity.secretAccessKey) throw new Error('aws_credentials_unavailable')
    return {
      accessKeyId: identity.accessKeyId,
      secretAccessKey: identity.secretAccessKey,
      sessionToken: identity.sessionToken ?? null,
    }
  }
}
