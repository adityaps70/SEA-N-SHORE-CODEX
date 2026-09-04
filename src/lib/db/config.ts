import { z } from 'zod'

const databaseEnvironmentSchema = z.object({
  AURORA_HOST: z.string().min(1),
  AURORA_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  AURORA_DATABASE: z.string().min(1),
  AURORA_USER: z.string().min(1),
  AURORA_PASSWORD: z.string().min(1),
  AURORA_SSL: z.enum(['true', 'false']).default('true'),
})

export type DatabaseEnvironment = {
  host: string
  port: number
  database: string
  user: string
  password: string
  ssl: boolean
}

export function getDatabaseEnvironment(): DatabaseEnvironment {
  const environment = databaseEnvironmentSchema.parse({
    AURORA_HOST: process.env.AURORA_HOST,
    AURORA_PORT: process.env.AURORA_PORT,
    AURORA_DATABASE: process.env.AURORA_DATABASE,
    AURORA_USER: process.env.AURORA_USER,
    AURORA_PASSWORD: process.env.AURORA_PASSWORD,
    AURORA_SSL: process.env.AURORA_SSL,
  })

  return {
    host: environment.AURORA_HOST,
    port: environment.AURORA_PORT,
    database: environment.AURORA_DATABASE,
    user: environment.AURORA_USER,
    password: environment.AURORA_PASSWORD,
    ssl: environment.AURORA_SSL === 'true',
  }
}
