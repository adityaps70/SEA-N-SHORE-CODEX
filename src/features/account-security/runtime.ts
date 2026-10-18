import { query, withTransaction } from '@/lib/db/client'
import type { AccountQuery, AccountTransaction } from './types'

/** Round H (H3): Aurora through the shared pool, in the shape the account security modules take. */
export const accountQuery: AccountQuery = (text, values) => query(text, values)

export const accountTransaction: AccountTransaction = (work) =>
  withTransaction((client) => work(async (text, values) => (await client.query(text, values)).rows))
