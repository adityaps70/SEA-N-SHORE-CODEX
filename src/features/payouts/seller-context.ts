import type { DatabaseQueryClient } from '@/lib/db/client'
import type { Seller } from '@/features/payments/earnings'
import { listManagedOrganizations } from './payout-repository'
import { parseSellerKey, sellerKey } from './payout-rules'

export type SellerOption = { key: string; seller: Seller; name: string; kind: 'profile' | 'organization' }

/**
 * The sellers a member may look after: themselves, plus every organization where they
 * are an approved owner or administrator. `requested` (a "for" query value) picks one;
 * anything they cannot manage falls back to their own account.
 */
export async function loadSellerOptions(client: DatabaseQueryClient, userId: string, requested: string | null | undefined) {
  const organizations = await listManagedOrganizations(client, userId)
  const options: SellerOption[] = [
    { key: sellerKey({ profileId: userId }), seller: { profileId: userId }, name: 'You', kind: 'profile' },
    ...organizations.map((organization) => ({
      key: sellerKey({ companyId: organization.id }),
      seller: { companyId: organization.id },
      name: organization.name,
      kind: 'organization' as const,
    })),
  ]
  const wanted = parseSellerKey(requested)
  const active = (wanted && options.find((option) => option.key === sellerKey(wanted))) || options[0]
  return { options, active }
}

export function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}
