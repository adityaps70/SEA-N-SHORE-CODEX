import { afterEach, describe, expect, it } from 'vitest'

const ENV_KEYS = [
  'AURORA_HOST',
  'AURORA_PORT',
  'AURORA_DATABASE',
  'AURORA_USER',
  'AURORA_PASSWORD',
  'AURORA_SSL',
] as const

const originalEnvironment = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof ENV_KEYS)[number], string | undefined>

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = originalEnvironment[key]
    if (original === undefined) delete process.env[key]
    else process.env[key] = original
  }
})

async function loadConfig() {
  const configModule = await import('./config')
  return configModule.getDatabaseEnvironment()
}

describe('getDatabaseEnvironment', () => {
  it('reads a complete Aurora runtime environment lazily', async () => {
    process.env.AURORA_HOST = 'sea-n-shore.cluster-example.ap-south-1.rds.amazonaws.com'
    process.env.AURORA_PORT = '5432'
    process.env.AURORA_DATABASE = 'sea_n_shore'
    process.env.AURORA_USER = 'postgres'
    process.env.AURORA_PASSWORD = 'example-secret-password'
    process.env.AURORA_SSL = 'true'

    await expect(loadConfig()).resolves.toEqual({
      host: 'sea-n-shore.cluster-example.ap-south-1.rds.amazonaws.com',
      port: 5432,
      database: 'sea_n_shore',
      user: 'postgres',
      password: 'example-secret-password',
      ssl: true,
    })
  })

  it('defaults SSL on when AURORA_SSL is omitted', async () => {
    process.env.AURORA_HOST = 'sea-n-shore.cluster-example.ap-south-1.rds.amazonaws.com'
    process.env.AURORA_PORT = '5432'
    process.env.AURORA_DATABASE = 'sea_n_shore'
    process.env.AURORA_USER = 'postgres'
    process.env.AURORA_PASSWORD = 'example-secret-password'
    delete process.env.AURORA_SSL

    const config = await loadConfig()
    expect(config.ssl).toBe(true)
  })

  it('rejects a non-numeric database port', async () => {
    process.env.AURORA_HOST = 'sea-n-shore.cluster-example.ap-south-1.rds.amazonaws.com'
    process.env.AURORA_PORT = 'not-a-port'
    process.env.AURORA_DATABASE = 'sea_n_shore'
    process.env.AURORA_USER = 'postgres'
    process.env.AURORA_PASSWORD = 'example-secret-password'

    await expect(loadConfig()).rejects.toThrow()
  })

  it.each(['AURORA_HOST', 'AURORA_DATABASE', 'AURORA_USER', 'AURORA_PASSWORD'] as const)(
    'rejects when %s is missing',
    async (missingKey) => {
      process.env.AURORA_HOST = 'sea-n-shore.cluster-example.ap-south-1.rds.amazonaws.com'
      process.env.AURORA_PORT = '5432'
      process.env.AURORA_DATABASE = 'sea_n_shore'
      process.env.AURORA_USER = 'postgres'
      process.env.AURORA_PASSWORD = 'example-secret-password'
      delete process.env[missingKey]

      await expect(loadConfig()).rejects.toThrow()
    },
  )
})
