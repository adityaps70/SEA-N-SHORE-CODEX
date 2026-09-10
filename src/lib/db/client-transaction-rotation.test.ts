import type { PoolConfig, QueryResultRow } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import type { DatabaseQueryClient } from './client'
import type { DatabaseEnvironment } from './config'

const environment: DatabaseEnvironment = {
  host: 'sea-n-shore.cluster-example.ap-south-1.rds.amazonaws.com',
  port: 5432,
  database: 'sea_n_shore',
  user: 'sns_cluster_admin',
  password: 'stale-password',
  ssl: true,
}

describe('Aurora transaction credential rotation', () => {
  it('refreshes credentials and retries transaction connection once after PostgreSQL authentication failure', async () => {
    const authError = Object.assign(new Error('password authentication failed'), { code: '28P01' })
    const staleEnd = vi.fn(async () => undefined)
    const stalePool = {
      query: vi.fn(),
      connect: vi.fn(async () => { throw authError }),
      end: staleEnd,
    }
    const transactionQuery = vi.fn(async <T extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: readonly unknown[],
    ): Promise<{ rows: T[] }> => {
      void text
      void values
      return { rows: [] }
    })
    const transactionClient = {
      query: transactionQuery as unknown as DatabaseQueryClient['query'],
      release: vi.fn(),
    }
    const freshPool = {
      query: vi.fn(),
      connect: vi.fn(async () => transactionClient),
      end: vi.fn(async () => undefined),
    }
    const configs: PoolConfig[] = []
    const poolFactory = vi.fn((config: PoolConfig) => {
      configs.push(config)
      return configs.length === 1 ? stalePool : freshPool
    })
    const credentialProvider = vi.fn(async () => ({
      user: 'sns_cluster_admin',
      password: 'rotated-password',
    }))
    const { createDatabaseClient } = await import('./client')
    const database = createDatabaseClient({ environment, poolFactory, credentialProvider })

    await expect(database.withTransaction(async () => 'transaction-ok')).resolves.toBe('transaction-ok')

    expect(credentialProvider).toHaveBeenCalledTimes(1)
    expect(staleEnd).toHaveBeenCalledTimes(1)
    expect(freshPool.connect).toHaveBeenCalledTimes(1)
    expect(configs[1]?.password).toBe('rotated-password')
    expect(transactionQuery.mock.calls.map(([text]) => text)).toEqual(['BEGIN', 'COMMIT'])
    expect(transactionClient.release).toHaveBeenCalledTimes(1)
  })
})
