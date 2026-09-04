import { describe, expect, it, vi } from 'vitest'
import type { DatabaseEnvironment } from './config'

const environment: DatabaseEnvironment = {
  host: 'sea-n-shore.cluster-example.ap-south-1.rds.amazonaws.com',
  port: 5432,
  database: 'sea_n_shore',
  user: 'postgres',
  password: 'example-secret-password',
  ssl: true,
}

type FakeQueryResult = { rows: Array<Record<string, unknown>> }

function createFakePool() {
  const transactionQuery = vi.fn(async (text: string): Promise<FakeQueryResult> => {
    if (text === 'select profile_id from identity_accounts') {
      return { rows: [{ profile_id: 'profile-1' }] }
    }
    return { rows: [] }
  })

  const release = vi.fn()
  const connect = vi.fn(async () => ({ query: transactionQuery, release }))
  const query = vi.fn(async () => ({ rows: [{ id: 'row-1' }] }))

  return { pool: { query, connect }, query, connect, transactionQuery, release }
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

  it('commits successful transactions and releases the client', async () => {
    const fake = createFakePool()
    const poolFactory = vi.fn(() => fake.pool)
    const { createDatabaseClient } = await import('./client')
    const database = createDatabaseClient({ environment, poolFactory })

    const result = await database.withTransaction(async (client) => {
      const response = await client.query('select profile_id from identity_accounts')
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
