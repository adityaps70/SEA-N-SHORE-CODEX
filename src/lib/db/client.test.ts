import type { PoolConfig, QueryResultRow } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import type { DatabaseQueryClient } from './client'
import type { DatabaseEnvironment } from './config'

const environment: DatabaseEnvironment = {
  host: 'sea-n-shore.cluster-example.ap-south-1.rds.amazonaws.com',
  port: 5432,
  database: 'sea_n_shore',
  user: 'postgres',
  password: 'example-secret-password',
  ssl: true,
}

function createFakePool() {
  const transactionQuery = vi.fn(async <T extends QueryResultRow = QueryResultRow>(
    text: string,
  ): Promise<{ rows: T[] }> => {
    if (text === 'select profile_id from identity_accounts') {
      return { rows: [{ profile_id: 'profile-1' }] as unknown as T[] }
    }
    return { rows: [] }
  })

  const release = vi.fn()
  const transactionClient = {
    query: transactionQuery as unknown as DatabaseQueryClient['query'],
    release,
  }
  const connect = vi.fn(async () => transactionClient)
  const query = vi.fn(async <T extends QueryResultRow = QueryResultRow>(): Promise<{ rows: T[] }> => ({
    rows: [{ id: 'row-1' }] as unknown as T[],
  }))

  const pool = {
    query: query as unknown as DatabaseQueryClient['query'],
    connect,
  }

  return { pool, query, connect, transactionQuery, release }
}

describe('Aurora database client', () => {
  it('forwards parameterized queries and returns rows', async () => {
    const fake = createFakePool()
    const poolFactory = vi.fn(() => fake.pool)
    const { createDatabaseClient } = await import('./client')
    const database = createDatabaseClient({ environment, poolFactory })

    await expect(database.query<{ id: string }>('select id from profiles where id = $1', ['profile-1']))
      .resolves.toEqual([{ id: 'row-1' }])

    expect(poolFactory).toHaveBeenCalledTimes(1)
    expect(fake.query).toHaveBeenCalledWith('select id from profiles where id = $1', ['profile-1'])
  })

  it('allows Aurora Serverless v2 enough time to resume while keeping TLS enabled', async () => {
    const fake = createFakePool()
    const poolFactory = vi.fn(() => fake.pool)
    const { createDatabaseClient } = await import('./client')
    const database = createDatabaseClient({ environment, poolFactory })

    await database.query('select 1')

    expect(poolFactory).toHaveBeenCalledWith(expect.objectContaining({
      ssl: true,
      connectionTimeoutMillis: 30_000,
    }))
  })

  it('creates the pool only once for repeated queries', async () => {
    const fake = createFakePool()
    const poolFactory = vi.fn(() => fake.pool)
    const { createDatabaseClient } = await import('./client')
    const database = createDatabaseClient({ environment, poolFactory })

    await database.query('select 1')
    await database.query('select 2')

    expect(poolFactory).toHaveBeenCalledTimes(1)
    expect(fake.query).toHaveBeenCalledTimes(2)
  })

  it('refreshes rotated credentials and rebuilds the pool after PostgreSQL authentication failure', async () => {
    const staleError = Object.assign(new Error('password authentication failed'), { code: '28P01' })
    const staleEnd = vi.fn(async () => undefined)
    const stalePool = {
      query: vi.fn(async () => { throw staleError }),
      connect: vi.fn(),
      end: staleEnd,
    }
    const freshPool = {
      query: vi.fn(async <T extends QueryResultRow = QueryResultRow>(): Promise<{ rows: T[] }> => ({
        rows: [{ id: 'row-after-rotation' }] as unknown as T[],
      })),
      connect: vi.fn(),
      end: vi.fn(async () => undefined),
    }
    const configs: PoolConfig[] = []
    const poolFactory = vi.fn((config: PoolConfig) => {
      configs.push(config)
      return configs.length === 1 ? stalePool : freshPool
    })
    const credentialProvider = vi.fn(async () => ({ user: 'postgres', password: 'rotated-secret-password' }))
    const { createDatabaseClient } = await import('./client')
    type ClientOptions = Parameters<typeof createDatabaseClient>[0]
    const database = createDatabaseClient({
      environment,
      poolFactory,
      credentialProvider,
    } as unknown as ClientOptions)

    await expect(database.query<{ id: string }>('select id from profiles'))
      .resolves.toEqual([{ id: 'row-after-rotation' }])

    expect(credentialProvider).toHaveBeenCalledTimes(1)
    expect(staleEnd).toHaveBeenCalledTimes(1)
    expect(poolFactory).toHaveBeenCalledTimes(2)
    expect(configs[0]?.password).toBe('example-secret-password')
    expect(configs[1]?.password).toBe('rotated-secret-password')
  })

  it('commits successful transactions and releases the client', async () => {
    const fake = createFakePool()
    const poolFactory = vi.fn(() => fake.pool)
    const { createDatabaseClient } = await import('./client')
    const database = createDatabaseClient({ environment, poolFactory })

    const result = await database.withTransaction(async (client) => {
      const response = await client.query<{ profile_id: string }>(
        'select profile_id from identity_accounts',
      )
      return response.rows[0]?.profile_id
    })

    expect(result).toBe('profile-1')
    expect(fake.transactionQuery.mock.calls.map(([text]) => text)).toEqual([
      'BEGIN',
      'select profile_id from identity_accounts',
      'COMMIT',
    ])
    expect(fake.release).toHaveBeenCalledTimes(1)
  })

  it('rolls back failed transactions and releases the client', async () => {
    const fake = createFakePool()
    const poolFactory = vi.fn(() => fake.pool)
    const { createDatabaseClient } = await import('./client')
    const database = createDatabaseClient({ environment, poolFactory })

    await expect(database.withTransaction(async () => {
      throw new Error('boom')
    })).rejects.toThrow('boom')

    expect(fake.transactionQuery.mock.calls.map(([text]) => text)).toEqual(['BEGIN', 'ROLLBACK'])
    expect(fake.release).toHaveBeenCalledTimes(1)
  })
})
