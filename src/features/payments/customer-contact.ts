import type { QueryResultRow } from 'pg'
import { query } from '@/lib/db/client'
import type { CheckoutCustomer } from './types'

/**
 * The buyer's mobile number for gateways that require one (Cashfree needs
 * customer_phone on every order). Order of preference:
 *   1. the number typed at checkout (saved for next time)
 *   2. the number saved at an earlier checkout
 *   3. the number on the member's phone sign-in (identity_accounts, verified first)
 * Numbers are never invented: with none of these, checkout asks the buyer.
 */

export { PHONE_INVALID_MESSAGE, PHONE_REJECTED_MESSAGE, PHONE_REQUIRED_MESSAGE } from './checkout-types'

/**
 * Normalizes what a buyer typed to E.164. Accepts Indian 10-digit mobiles (with or
 * without 0 / 91 / +91) and international numbers written with a leading +.
 * Returns null when it is not a usable mobile number.
 */
export function normalizeCheckoutPhone(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed || trimmed.length > 30) return null
  if (/[^0-9+\s().-]/.test(trimmed)) return null
  const international = trimmed.startsWith('+') || trimmed.startsWith('00')
  const digits = trimmed.replace(/\D/g, '').replace(/^00/, '')
  if (!international) {
    const local = digits.replace(/^0/, '').replace(/^91(?=\d{10}$)/, '')
    return /^[6-9]\d{9}$/.test(local) ? `+91${local}` : null
  }
  if (digits.startsWith('91')) return /^91[6-9]\d{9}$/.test(digits) ? `+${digits}` : null
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null
}

/** A saved number the way a buyer would type it (Indian numbers without +91). */
export function checkoutPhoneForInput(e164: string | null) {
  if (!e164) return ''
  return e164.startsWith('+91') ? e164.slice(3) : e164
}

export async function getCheckoutPhone(profileId: string): Promise<string | null> {
  const rows = await query<QueryResultRow & { phone: string | null }>(`
    select phone from (
      select c.phone, 0 as rank from public.payment_customer_contacts c where c.profile_id = $1::uuid
      union all
      select ia.phone_number as phone, case when ia.phone_number_verified then 1 else 2 end as rank
      from public.identity_accounts ia
      where ia.profile_id = $1::uuid and ia.phone_number is not null
    ) candidates
    order by rank
    limit 1
  `, [profileId])
  return rows[0]?.phone ?? null
}

export async function saveCheckoutPhone(profileId: string, phoneE164: string) {
  await query(`
    insert into public.payment_customer_contacts (profile_id, phone, updated_at)
    values ($1::uuid, $2::text, now())
    on conflict (profile_id) do update set phone = excluded.phone, updated_at = now()
  `, [profileId, phoneE164])
}

/**
 * Everything the gateway needs about the signed-in buyer. `invalidPhone` = they typed
 * a number we cannot use (show PHONE_INVALID_MESSAGE). Use it from any checkout action.
 */
export async function loadCheckoutCustomer(
  user: { id: string; email: string | null },
  typedPhone?: string | null,
): Promise<{ customer: CheckoutCustomer; invalidPhone: boolean }> {
  const [{ phone, invalid }, nameRows] = await Promise.all([
    resolveCheckoutPhone(user.id, typedPhone),
    query<QueryResultRow & { full_name: string | null }>('select full_name from public.profiles where id = $1::uuid', [user.id]),
  ])
  return {
    customer: { id: user.id, email: user.email, phone, name: nameRows[0]?.full_name ?? null },
    invalidPhone: invalid,
  }
}

/**
 * The phone to send to the gateway: what the buyer just typed (validated and saved),
 * else what we already know. `invalid` = they typed something unusable.
 */
export async function resolveCheckoutPhone(profileId: string, typed: string | null | undefined): Promise<{ phone: string | null; invalid: boolean }> {
  if (typeof typed === 'string' && typed.trim()) {
    const phone = normalizeCheckoutPhone(typed)
    if (!phone) return { phone: null, invalid: true }
    await saveCheckoutPhone(profileId, phone)
    return { phone, invalid: false }
  }
  return { phone: await getCheckoutPhone(profileId), invalid: false }
}
