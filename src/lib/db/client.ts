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

type CreateDatabaseClientOptions = {
  environment?: DatabaseEnvironment
  poolFactory?: PoolFactory
  credentialProvider?: CredentialProvider
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

function isAuthenticationFailure(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '28P01'
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

  async function queryWithAuthRecovery<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[],
  ) {
    try {
      return await getPool().query<T>(text, values)
    } catch (error) {
      if (!isAuthenticationFailure(error) || !await refreshPoolAfterAuthenticationFailure()) throw error
      return getPool().query<T>(text, values)
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
      const client = await getPool().connect()

      try {
        await client.query('BEGIN')
        const result = await fn(client)
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

const database = createDatabaseClient()

export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: readonly unknown[],
) {
  return database.query<T>(text, values)
}

export function withTransaction<T>(fn: (client: DatabaseQueryClient) => Promise<T>) {
  return database.withTransaction(fn)
}
