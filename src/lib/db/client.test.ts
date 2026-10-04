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

  it('logs a safe SQL fingerprint without parameter values when a query fails', async () => {
    const failure = Object.assign(new Error('operator does not exist: uuid = text'), { code: '42883' })
    const pool = {
      query: vi.fn(async () => { throw failure }),
      connect: vi.fn(),
    }
    const poolFactory = vi.fn(() => pool)
    const onQueryError = vi.fn()
    const { createDatabaseClient } = await import('./client')
    type ClientOptions = Parameters<typeof createDatabaseClient>[0]
    const database = createDatabaseClient({
      environment,
      poolFactory,
      onQueryError,
    } as unknown as ClientOptions)

    await expect(database.query(
      'select id from public.profiles where id = $1 and full_name = $2',
      ['11111111-1111-4111-8111-111111111111', 'Sensitive Name'],
    )).rejects.toThrow('operator does not exist: uuid = text')

    expect(onQueryError).toHaveBeenCalledWith({
      code: '42883',
      query: 'select id from public.profiles where id = $1 and full_name = $2',
    })
    expect(JSON.stringify(onQueryError.mock.calls)).not.toContain('Sensitive Name')
    expect(JSON.stringify(onQueryError.mock.calls)).not.toContain('11111111-1111-4111-8111-111111111111')
  })

  it('logs safe query context for failed statements inside transactions', async () => {
    const failure = Object.assign(new Error('operator does not exist: uuid = text'), { code: '42883' })
    const release = vi.fn()
    const transactionClient = {
      query: vi.fn(async (text: string) => {
        if (text === 'select id from public.profiles where id = $1') throw failure
        return { rows: [] }
      }),
      release,
    }
    const pool = {
      query: vi.fn(),
      connect: vi.fn(async () => transactionClient),
    }
    const onQueryError = vi.fn()
    const { createDatabaseClient } = await import('./client')
    type ClientOptions = Parameters<typeof createDatabaseClient>[0]
    const database = createDatabaseClient({
      environment,
      poolFactory: vi.fn(() => pool),
      onQueryError,
    } as unknown as ClientOptions)

    await expect(database.withTransaction(async (client) => {
      await client.query('select id from public.profiles where id = $1', ['secret-profile-id'])
    })).rejects.toThrow('operator does not exist: uuid = text')

    expect(onQueryError).toHaveBeenCalledWith({
      code: '42883',
      query: 'select id from public.profiles where id = $1',
    })
    expect(JSON.stringify(onQueryError.mock.calls)).not.toContain('secret-profile-id')
    expect(release).toHaveBeenCalledTimes(1)
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
