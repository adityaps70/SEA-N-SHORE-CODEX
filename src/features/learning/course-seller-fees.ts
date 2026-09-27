import type { QueryResultRow } from 'pg'
import { query, type DatabaseQueryClient } from '@/lib/db/client'
import { getPlatformFeeSettings, resolveFeePercent, type Seller } from '@/features/payments/earnings'
import type { SellerFeeTerms } from './course-pricing'

/** Read-only client over the shared pool, for the fee lookups below. */
const readClient: DatabaseQueryClient = {
  async query<T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) {
    return { rows: await query<T>(text, values) }
  },
}

/**
 * What a course seller keeps per sale: Sea N Shore's fee percent for this seller (their
 * override, else the platform default) and how many days after the sale it is paid out.
 * Read-only. Returns null when the settings cannot be read (the form then says so).
 */
export async function loadSellerFeeTerms(seller: Seller): Promise<SellerFeeTerms | null> {
  try {
    const [settings, percent] = await Promise.all([getPlatformFeeSettings(), resolveFeePercent(readClient, seller)])
    return { percent, holdDays: settings.holdDays }
  } catch (error) {
    console.error('course_seller_fee_load_failed', { message: error instanceof Error ? error.message : null })
    return null
  }
}
