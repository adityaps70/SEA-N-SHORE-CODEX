import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite, type Transaction } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import type { QueryResultRow } from 'pg'

/**
 * Test-only: a real Postgres (PGlite, in-process) with every Aurora migration applied, for
 * tests that must exercise the actual SQL (constraints, unique indexes, joins) rather than a
 * hand-written stand-in. Never imported by application code.
 */

export type TestQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
export type TestTransaction = <T>(work: (query: TestQuery) => Promise<T>) => Promise<T>

export type TestDatabase = {
  query: TestQuery
  transaction: TestTransaction
  /** A `pg`-shaped client, for helpers that take a DatabaseQueryClient. */
  client: { query<T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<{ rows: T[] }> }
  close(): Promise<void>
}

const MIGRATIONS_DIRECTORY = join(process.cwd(), 'infra/aws/database/migrations')

/** Statements that only make sense on the Aurora cluster (its database name and admin role). */
function isClusterOnlyStatement(statement: string) {
  return /grant connect on database sea_n_shore/i.test(statement)
}

function asQuery(runner: PGlite | Transaction): TestQuery {
  return async (text, values) => {
    const result = await runner.query<QueryResultRow>(text, values ? [...values] : undefined)
    return result.rows
  }
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const db = await PGlite.create({ extensions: { pg_trgm, pgcrypto } })
  await db.exec(`
    create role sns_cluster_admin;
    create table public.sea_n_shore_applied_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    );
  `)

  const files = readdirSync(MIGRATIONS_DIRECTORY).filter((file) => file.endsWith('.sql')).sort()
  for (const file of files) {
    const statements = readFileSync(join(MIGRATIONS_DIRECTORY, file), 'utf8').split('-- statement-breakpoint')
    for (const statement of statements) {
      if (!statement.trim() || isClusterOnlyStatement(statement)) continue
      try {
        await db.exec(statement)
      } catch (error) {
        throw new Error(`Migration ${file} failed in the test database: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  const query = asQuery(db)
  return {
    query,
    transaction: (work) => db.transaction((tx) => work(asQuery(tx))),
    client: {
      async query<T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) {
        return { rows: await query(text, values) as T[] }
      },
    },
    close: () => db.close(),
  }
}
