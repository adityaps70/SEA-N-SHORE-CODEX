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
}

type PoolFactory = (config: PoolConfig) => DatabasePool

type CreateDatabaseClientOptions = {
  environment?: DatabaseEnvironment
  poolFactory?: PoolFactory
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
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: true,
  }
}

function defaultPoolFactory(config: PoolConfig): DatabasePool {
  return new Pool(config) as unknown as DatabasePool
}

export function createDatabaseClient(options: CreateDatabaseClientOptions = {}) {
  let pool: DatabasePool | null = null

  function getPool() {
    if (!pool) {
      const environment = options.environment ?? getDatabaseEnvironment()
      pool = (options.poolFactory ?? defaultPoolFactory)(poolConfig(environment))
    }
    return pool
  }

  return {
    async query<T extends QueryResultRow = QueryResultRow>(
      text: string,
      values: readonly unknown[] = [],
    ): Promise<T[]> {
      const result = await getPool().query<T>(text, values)
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
