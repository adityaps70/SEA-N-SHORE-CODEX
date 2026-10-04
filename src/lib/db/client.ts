import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { Pool, type PoolConfig, type QueryResultRow } from 'pg'
import { getDatabaseEnvironment, type DatabaseEnvironment } from './config'

export type DatabaseQueryClient = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[] }>
}

type ReleasableDatabaseClient = DatabaseQueryClient & {
  release(): void
}

type DatabasePool = DatabaseQueryClient & {
  connect(): Promise<ReleasableDatabaseClient>
  end?(): Promise<void>
}

type PoolFactory = (config: PoolConfig) => DatabasePool
export type DatabaseCredentials = Pick<DatabaseEnvironment, 'user' | 'password'>
type CredentialProvider = () => Promise<DatabaseCredentials>

type DatabaseQueryErrorContext = {
  code: string | null
  query: string
}

type CreateDatabaseClientOptions = {
  environment?: DatabaseEnvironment
  poolFactory?: PoolFactory
  credentialProvider?: CredentialProvider
  onQueryError?: (context: DatabaseQueryErrorContext) => void
}

function poolConfig(environment: DatabaseEnvironment): PoolConfig {
  return {
    host: environment.host,
    port: environment.port,
    database: environment.database,
    user: environment.user,
    password: environment.password,
    ssl: environment.ssl,
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 30_000,
    allowExitOnIdle: true,
  }
}

function defaultPoolFactory(config: PoolConfig): DatabasePool {
  return new Pool(config) as unknown as DatabasePool
}

function databaseErrorCode(error: unknown) {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && typeof error.code === 'string'
    ? error.code
    : null
}

function isAuthenticationFailure(error: unknown) {
  return databaseErrorCode(error) === '28P01'
}

function normalizeQueryForLogging(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 2000)
}

export function createDatabaseClient(options: CreateDatabaseClientOptions = {}) {
  let pool: DatabasePool | null = null
  let environment: DatabaseEnvironment | null = options.environment ?? null

  function getEnvironment() {
    environment ??= getDatabaseEnvironment()
    return environment
  }

  function getPool() {
    if (!pool) {
      pool = (options.poolFactory ?? defaultPoolFactory)(poolConfig(getEnvironment()))
    }
    return pool
  }

  async function refreshPoolAfterAuthenticationFailure() {
    if (!options.credentialProvider) return false

    const stalePool = pool
    const credentials = await options.credentialProvider()
    environment = { ...getEnvironment(), ...credentials }
    pool = (options.poolFactory ?? defaultPoolFactory)(poolConfig(environment))
    await stalePool?.end?.()
    return true
  }

  function reportQueryFailure(text: string, error: unknown) {
    const context: DatabaseQueryErrorContext = {
      code: databaseErrorCode(error),
      query: normalizeQueryForLogging(text),
    }
    if (options.onQueryError) {
      options.onQueryError(context)
      return
    }
    console.error('[database_query_failed]', context)
  }

  async function queryWithAuthRecovery<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[],
  ) {
    try {
      return await getPool().query<T>(text, values)
    } catch (error) {
      if (isAuthenticationFailure(error) && await refreshPoolAfterAuthenticationFailure()) {
        try {
          return await getPool().query<T>(text, values)
        } catch (retryError) {
          reportQueryFailure(text, retryError)
          throw retryError
        }
      }
      reportQueryFailure(text, error)
      throw error
    }
  }

  async function connectWithAuthRecovery() {
    try {
      return await getPool().connect()
    } catch (error) {
      if (!isAuthenticationFailure(error) || !await refreshPoolAfterAuthenticationFailure()) throw error
      return getPool().connect()
    }
  }

  return {
    async query<T extends QueryResultRow = QueryResultRow>(
      text: string,
      values: readonly unknown[] = [],
    ): Promise<T[]> {
      const result = await queryWithAuthRecovery<T>(text, values)
      return result.rows
    },

    async withTransaction<T>(fn: (client: DatabaseQueryClient) => Promise<T>): Promise<T> {
      const client = await connectWithAuthRecovery()
      const diagnosticClient: DatabaseQueryClient = {
        async query<R extends QueryResultRow = QueryResultRow>(
          text: string,
          values: readonly unknown[] = [],
        ) {
          try {
            return await client.query<R>(text, values)
          } catch (error) {
            reportQueryFailure(text, error)
            throw error
          }
        },
      }

      try {
        await client.query('BEGIN')
        const result = await fn(diagnosticClient)
        await client.query('COMMIT')
        return result
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    },
  }
}

let runtimeSecretsManager: SecretsManagerClient | null = null
const runtimeCredentialProvider: CredentialProvider | undefined = process.env.AURORA_SECRET_ARN?.trim()
  ? async () => {
      const secretArn = process.env.AURORA_SECRET_ARN?.trim()
      if (!secretArn) throw new Error('aurora_secret_arn_missing')

      runtimeSecretsManager ??= new SecretsManagerClient({})
      const response = await runtimeSecretsManager.send(new GetSecretValueCommand({ SecretId: secretArn }))
      if (!response.SecretString) throw new Error('aurora_secret_string_missing')

      const secret = JSON.parse(response.SecretString) as { username?: unknown; password?: unknown }
      if (typeof secret.username !== 'string' || typeof secret.password !== 'string') {
        throw new Error('aurora_secret_credentials_invalid')
      }

      return { user: secret.username, password: secret.password }
    }
  : undefined

const database = createDatabaseClient({ credentialProvider: runtimeCredentialProvider })

export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: readonly unknown[],
) {
  return database.query<T>(text, values)
}

export function withTransaction<T>(fn: (client: DatabaseQueryClient) => Promise<T>) {
  return database.withTransaction(fn)
}
