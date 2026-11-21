import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { Client, Pool, type PoolConfig, type QueryResultRow } from 'pg'
import { getDatabaseEnvironment, type DatabaseEnvironment } from './config'

export type DatabaseQueryClient = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
    /** A prepared-statement name: the plan is kept on that pooled connection (round G search). */
    name?: string,
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
    // Round 14 (3.3): 12 connections per task, and fail fast (5 s) instead of queueing for 30 s;
    // Aurora keeps a 0.5 ACU floor with no auto-pause, so there is no resume to wait for.
    max: 12,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
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

/**
 * Owner (18 Nov): writes to the tables behind the web servers' caches (migration 0111's triggers). After one of these
 * commits, the write hook (the cache hub's barrier) waits until this server's own clears have arrived.
 */
const CACHED_TABLE_WRITE = /\b(?:insert\s+into|update|delete\s+from)\s+(?:public\.)?(?:profiles|maritime_profiles|profile_skills|companies|identity_accounts|notifications|messages|conversation_participants|connections|auth_sessions)\b/i

export function writesCachedTable(text: string) {
  return CACHED_TABLE_WRITE.test(text)
}

let writeHook: (() => Promise<void>) | null = null

/** Set once by the cache hub (src/lib/cache/runtime.ts). */
export function setDatabaseWriteHook(hook: (() => Promise<void>) | null) {
  writeHook = hook
}

async function afterCachedWrite() {
  if (!writeHook) return
  try {
    await writeHook()
  } catch {
    // The hook itself turns caching off when it cannot confirm the clears; a write never fails because of it.
  }
}

const LISTEN_CHANNEL = /^[a-z_]{1,63}$/

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

  /** One dedicated connection that LISTENs on a channel (the cache hub's listener); never from the pool. */
  async function listen(channel: string, onMessage: (payload: string) => void, onLost: (reason: string) => void) {
    if (!LISTEN_CHANNEL.test(channel)) throw new Error('listen_channel_invalid')
    let closed = false
    let reported = false
    const report = (reason: string) => {
      if (closed || reported) return
      reported = true
      onLost(reason)
    }
    async function open(env: DatabaseEnvironment) {
      const client = new Client({
        host: env.host, port: env.port, database: env.database, user: env.user, password: env.password, ssl: env.ssl,
        keepAlive: true, connectionTimeoutMillis: 5_000,
      })
      client.on('notification', (message) => {
        if (message.channel === channel && typeof message.payload === 'string') onMessage(message.payload)
      })
      client.on('error', (error) => report(`error:${databaseErrorCode(error) ?? 'unknown'}`))
      client.on('end', () => report('ended'))
      try {
        await client.connect()
        await client.query(`listen ${channel}`)
      } catch (error) {
        closed = true
        await client.end().catch(() => undefined)
        closed = false
        throw error
      }
      return client
    }
    let client: InstanceType<typeof Client>
    try {
      client = await open(getEnvironment())
    } catch (error) {
      if (!isAuthenticationFailure(error) || !options.credentialProvider) throw error
      await refreshPoolAfterAuthenticationFailure()
      client = await open(getEnvironment())
    }
    return {
      async close() {
        closed = true
        await client.end().catch(() => undefined)
      },
    }
  }

  return {
    async query<T extends QueryResultRow = QueryResultRow>(
      text: string,
      values: readonly unknown[] = [],
    ): Promise<T[]> {
      const result = await queryWithAuthRecovery<T>(text, values)
      if (writesCachedTable(text)) await afterCachedWrite()
      return result.rows
    },

    listen,

    async withTransaction<T>(fn: (client: DatabaseQueryClient) => Promise<T>): Promise<T> {
      const client = await connectWithAuthRecovery()
      let cachedWrite = false
      const diagnosticClient: DatabaseQueryClient = {
        async query<R extends QueryResultRow = QueryResultRow>(
          text: string,
          values: readonly unknown[] = [],
          name?: string,
        ) {
          if (!cachedWrite && writesCachedTable(text)) cachedWrite = true
          try {
            if (name) {
              // pg's client takes a query config object for named (prepared) statements.
              const named = client as unknown as { query(config: { name: string; text: string; values: unknown[] }): Promise<{ rows: R[] }> }
              return await named.query({ name, text, values: [...values] })
            }
            return await client.query<R>(text, values)
          } catch (error) {
            reportQueryFailure(text, error)
            throw error
          }
        },
      }

      let released = false
      try {
        await client.query('BEGIN')
        const result = await fn(diagnosticClient)
        await client.query('COMMIT')
        client.release()
        released = true
        if (cachedWrite) await afterCachedWrite()
        return result
      } catch (error) {
        if (!released) await client.query('ROLLBACK')
        throw error
      } finally {
        if (!released) client.release()
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

/** The cache hub's listener connection (src/lib/cache/runtime.ts). */
export function listenForNotifications(channel: string, onMessage: (payload: string) => void, onLost: (reason: string) => void) {
  return database.listen(channel, onMessage, onLost)
}
