'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { withTransaction } from '@/lib/db/client'
import { requirePlatformAdministratorUser } from '@/features/admin/access'
import { removeSellerFeeOverride, setSellerFeeOverride, updatePlatformFeeSettings } from '@/features/payments/earnings'
import { adminPayoutErrorMessage, payoutOutcomeMessage } from './payout-messages'
import { getSellerIdentity, searchSellers, type SellerSearchResult } from './payout-queries'
import { getPayout, getPayoutSettings, PayoutError, updatePayoutSettings } from './payout-repository'
import { parseRupeesToMinor, parseSellerKey } from './payout-rules'
import { payoutService, readClient } from './payout-runtime'
import type { PayoutOutcome, PayoutSendState } from './payout-service'
import type { Seller } from '@/features/payments/earnings'

export type AdminActionResult = { ok: true; message: string } | { ok: false; error: string; fieldErrors?: Record<string, string> }
export type PayoutActionResult =
  | { ok: true; state: PayoutSendState; message: string; payoutId: string }
  | { ok: false; error: string }

const PAYMENTS_PATHS = ['/admin/payments', '/admin/payments/fees', '/admin/payments/payouts', '/settings/earnings']

function refresh(extra: string[] = []) {
  for (const path of [...PAYMENTS_PATHS, ...extra]) revalidatePath(path)
}

class NotAdminError extends Error {}

async function requireAdmin() {
  try {
    return await requirePlatformAdministratorUser()
  } catch (error) {
    if (error instanceof Error && error.message === 'admin_forbidden') throw new NotAdminError()
    throw error
  }
}

const NOT_ADMIN = 'Only Sea N Shore platform administrators can do this.'

function logUnexpected(event: string, error: unknown) {
  if (error instanceof NotAdminError || error instanceof PayoutError) return
  console.error(event, { name: error instanceof Error ? error.name : null, message: error instanceof Error ? error.message.slice(0, 120) : null })
}

const percentSchema = z.string().trim().regex(/^\d{1,3}(\.\d{1,2})?$/, 'Enter a percentage from 0 to 100 with at most 2 decimals, for example 10 or 12.5.')
  .refine((value) => Number(value) <= 100, 'Enter a percentage from 0 to 100.')

const feeSettingsSchema = z.object({
  defaultPercent: percentSchema,
  holdDays: z.string().trim().regex(/^\d{1,3}$/, 'Enter a whole number of days from 0 to 365.').refine((value) => Number(value) <= 365, 'Enter a whole number of days from 0 to 365.'),
  minPayout: z.string().trim().refine((value) => {
    const minor = parseRupeesToMinor(value)
    return minor !== null && minor >= 100 && minor <= 100_000_000
  }, 'Enter a minimum payout between ₹1.00 and ₹10,00,000.00.'),
})

/** Admin: platform default fee %, hold days and the minimum payout amount. */
export async function updateFeeSettingsAction(input: { defaultPercent: string; holdDays: string; minPayout: string }): Promise<AdminActionResult> {
  const parsed = feeSettingsSchema.safeParse(input)
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message
    return { ok: false, error: 'Check the highlighted fields.', fieldErrors }
  }
  try {
    const admin = await requireAdmin()
    const minPayoutMinor = parseRupeesToMinor(parsed.data.minPayout)!
    const saved = await withTransaction(async (tx) => {
      const fees = await updatePlatformFeeSettings(tx, { defaultPercent: parsed.data.defaultPercent, holdDays: Number(parsed.data.holdDays), actorProfileId: admin.id })
      const payouts = await updatePayoutSettings(tx, { minPayoutMinor, actorProfileId: admin.id })
      return { ...fees, ...payouts }
    })
    refresh()
    return { ok: true, message: `Saved. New sales use a ${Number(saved.defaultPercent)}% platform fee and are held for ${saved.holdDays} day${saved.holdDays === 1 ? '' : 's'}. Past sales keep the fee they were sold with.` }
  } catch (error) {
    if (error instanceof NotAdminError) return { ok: false, error: NOT_ADMIN }
    logUnexpected('fee_settings_update_failed', error)
    return { ok: false, error: "We couldn't save the fee settings. Nothing was changed. Please try again." }
  }
}

const overrideSchema = z.object({
  sellerKey: z.string(),
  percent: percentSchema,
  note: z.string().trim().max(500, 'Keep the note under 500 characters.').optional(),
})

export async function setFeeOverrideAction(input: { sellerKey: string; percent: string; note?: string }): Promise<AdminActionResult> {
  const parsed = overrideSchema.safeParse(input)
  const seller = parseSellerKey(input.sellerKey)
  if (!seller) return { ok: false, error: 'Choose a person or organization first.' }
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message
    return { ok: false, error: 'Check the highlighted fields.', fieldErrors }
  }
  try {
    const admin = await requireAdmin()
    const identity = await getSellerIdentity(readClient, seller)
    if (!identity) return { ok: false, error: "We couldn't find that person or organization. Search again." }
    await withTransaction((tx) => setSellerFeeOverride(tx, { seller, percent: parsed.data.percent, note: parsed.data.note ?? null, actorProfileId: admin.id }))
    refresh()
    return { ok: true, message: `${identity.name} now pays a ${Number(parsed.data.percent)}% platform fee on new sales.` }
  } catch (error) {
    if (error instanceof NotAdminError) return { ok: false, error: NOT_ADMIN }
    logUnexpected('fee_override_set_failed', error)
    return { ok: false, error: "We couldn't save this fee. Nothing was changed. Please try again." }
  }
}

export async function removeFeeOverrideAction(sellerKeyValue: string): Promise<AdminActionResult> {
  const seller = parseSellerKey(sellerKeyValue)
  if (!seller) return { ok: false, error: 'This fee could not be identified. Refresh the page.' }
  try {
    const admin = await requireAdmin()
    const identity = await getSellerIdentity(readClient, seller)
    await withTransaction((tx) => removeSellerFeeOverride(tx, { seller, actorProfileId: admin.id }))
    refresh()
    return { ok: true, message: `${identity?.name ?? 'This seller'} is back on the default platform fee for new sales.` }
  } catch (error) {
    if (error instanceof NotAdminError) return { ok: false, error: NOT_ADMIN }
    logUnexpected('fee_override_remove_failed', error)
    return { ok: false, error: "We couldn't remove this fee. Nothing was changed. Please try again." }
  }
}

export async function searchSellersAction(term: string): Promise<{ ok: true; results: SellerSearchResult[] } | { ok: false; error: string }> {
  if (typeof term !== 'string') return { ok: true, results: [] }
  try {
    await requireAdmin()
    return { ok: true, results: await searchSellers(readClient, term) }
  } catch (error) {
    if (error instanceof NotAdminError) return { ok: false, error: NOT_ADMIN }
    logUnexpected('seller_search_failed', error)
    return { ok: false, error: "Search isn't working right now. Please try again." }
  }
}

async function outcomeResult(outcome: PayoutOutcome, seller: Seller): Promise<PayoutActionResult> {
  const identity = await getSellerIdentity(readClient, seller).catch(() => null)
  refresh([`/admin/payments/payouts/${outcome.payout.id}`])
  return { ok: true, state: outcome.state, payoutId: outcome.payout.id, message: payoutOutcomeMessage(outcome, identity?.name ?? 'the seller') }
}

const sendSchema = z.object({
  sellerKey: z.string(),
  earningIds: z.array(z.string().uuid()).min(1).max(2000),
  expectedTotalMinor: z.number().int().safe(),
})

/** Admin: "Send ₹X via Cashfree" from the review screen. Double-click and retry safe. */
export async function sendPayoutAction(input: { sellerKey: string; earningIds: string[]; expectedTotalMinor: number }): Promise<PayoutActionResult> {
  const parsed = sendSchema.safeParse(input)
  const seller = parseSellerKey(input?.sellerKey)
  if (!parsed.success || !seller) return { ok: false, error: 'This review is out of date. Nothing was sent. Reload the page and review the payout again.' }
  let minPayoutMinor: number | undefined
  try {
    const admin = await requireAdmin()
    minPayoutMinor = (await getPayoutSettings(readClient)).minPayoutMinor
    const outcome = await payoutService.sendPayout({
      actorProfileId: admin.id,
      seller,
      earningIds: parsed.data.earningIds,
      expectedTotalMinor: parsed.data.expectedTotalMinor,
    })
    return await outcomeResult(outcome, seller)
  } catch (error) {
    if (error instanceof NotAdminError) return { ok: false, error: NOT_ADMIN }
    logUnexpected('payout_send_failed', error)
    return { ok: false, error: adminPayoutErrorMessage(error, { minPayoutMinor }) }
  }
}

const payoutIdSchema = z.string().uuid()

async function runPayoutCommand(payoutId: string, command: 'refresh' | 'retry' | 'cancel'): Promise<PayoutActionResult> {
  const id = payoutIdSchema.safeParse(payoutId)
  if (!id.success) return { ok: false, error: "We couldn't find this payout. Refresh the page." }
  try {
    const admin = await requireAdmin()
    const payout = await getPayout(readClient, id.data)
    if (!payout) return { ok: false, error: "We couldn't find this payout. Refresh the page." }
    const input = { actorProfileId: admin.id, payoutId: id.data }
    const outcome = command === 'refresh'
      ? await payoutService.refreshPayoutStatus(input)
      : command === 'retry'
        ? await payoutService.retryPayout(input)
        : await payoutService.cancelPayout(input)
    return await outcomeResult(outcome, payout.seller)
  } catch (error) {
    if (error instanceof NotAdminError) return { ok: false, error: NOT_ADMIN }
    logUnexpected(`payout_${command}_failed`, error)
    return { ok: false, error: adminPayoutErrorMessage(error) }
  }
}

export async function refreshPayoutStatusAction(payoutId: string) {
  return runPayoutCommand(payoutId, 'refresh')
}

export async function retryPayoutAction(payoutId: string) {
  return runPayoutCommand(payoutId, 'retry')
}

export async function cancelPayoutAction(payoutId: string) {
  return runPayoutCommand(payoutId, 'cancel')
}
