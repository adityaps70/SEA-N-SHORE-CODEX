import { createResendEmailClient, loadResendAdminApiKey, ResendApiError, type ResendEmailClient } from '@/lib/email/resend'
import { normalizeEmail } from '@/lib/email/suppression'
import { backfillEvent } from './events'
import { emailDeliveryRepository } from './repository'

type Reader = Pick<ResendEmailClient, 'getEmail' | 'listSuppressions'>

/** Spacing between status lookups: about 4 a second, well inside Resend's 10 a second per team shared with sending. */
export const BACKFILL_SPACING_MS = 250
const SUPPRESSION_PAGE_LIMIT = 100
const SUPPRESSION_MAX_PAGES = 100

function forbidden(error: unknown) {
  return error instanceof ResendApiError && (error.status === 401 || error.status === 403)
}

/**
 * Delivery status backfill for legacy invitations sent before the webhook existed (the 4,547 sent on 3 October),
 * and a sync of Resend's suppression list into the do-not-email list. Both only read from Resend. The outbox worker
 * runs them on a timer; each invitation is fetched once and the work stops by itself when nothing is left.
 *
 * Reading email status and the suppression list needs a full-access key, so this uses the admin key
 * ("sea-n-shore/resend-admin"), never the sending key. Its client only reads: this module never sends.
 */
export function createDeliveryBackfillWorker(input: {
  repository?: typeof emailDeliveryRepository
  resend?: Reader | null
  loadApiKey?: () => Promise<string | null>
  sleep?: (ms: number) => Promise<void>
  spacingMs?: number
  log?: (message: string, details?: Record<string, unknown>) => void
} = {}) {
  const repository = input.repository ?? emailDeliveryRepository
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const spacing = input.spacingMs ?? BACKFILL_SPACING_MS
  const log = input.log ?? ((message: string, details?: Record<string, unknown>) => console.error(message, details ?? {}))
  let client: Reader | null | undefined = input.resend
  // If the admin key is refused (revoked, or swapped for a sending-only key), stop asking until the next restart.
  let statusReadsRefused = false
  let suppressionReadsRefused = false

  async function resolveClient() {
    if (client !== undefined) return client
    const key = await (input.loadApiKey ?? loadResendAdminApiKey)()
    client = key ? createResendEmailClient({ apiKey: key }) : null
    return client
  }

  return {
    async runStatusSweep(limit = 20) {
      const reader = await resolveClient()
      if (!reader || statusReadsRefused) return { checked: 0, recorded: 0, suppressed: 0, stopped: null as string | null, disabled: true }
      const rows = await repository.invitesToBackfill(limit)
      let checked = 0
      let recorded = 0
      let suppressed = 0
      let stopped: string | null = null

      for (const [index, row] of rows.entries()) {
        if (index > 0) await sleep(spacing)
        try {
          const status = await reader.getEmail(row.resend_message_id)
          const event = backfillEvent({
            resendEmailId: row.resend_message_id,
            lastEvent: status.lastEvent,
            recipients: status.to.length ? status.to : [row.email],
          })
          if (event) {
            const result = await repository.recordEvent(event)
            if (result.status === 'recorded') recorded += 1
            suppressed += result.suppressed
          }
        } catch (error) {
          if (forbidden(error)) {
            statusReadsRefused = true
            log('resend_status_backfill_forbidden', { status: (error as ResendApiError).status })
            stopped = 'forbidden'
            break
          }
          // Rate limited or Resend unavailable: stop this sweep and try the same email again next time.
          if (error instanceof ResendApiError && error.retryable) {
            stopped = error.status === 429 ? 'rate_limited' : 'resend_unavailable'
            break
          }
          // Not found or malformed: Resend has no status for it, so it is checked and not fetched again.
          if (!(error instanceof ResendApiError)) throw error
        }
        await repository.markBackfillChecked(row.id)
        checked += 1
      }
      return { checked, recorded, suppressed, stopped, disabled: false }
    },

    async runSuppressionSync() {
      const reader = await resolveClient()
      if (!reader || suppressionReadsRefused) return { seen: 0, added: 0, disabled: true }
      let after: string | undefined
      let seen = 0
      let added = 0
      try {
        for (let page = 0; page < SUPPRESSION_MAX_PAGES; page += 1) {
          if (page > 0) await sleep(spacing)
          const result = await reader.listSuppressions({ after, limit: SUPPRESSION_PAGE_LIMIT })
          for (const entry of result.data) {
            const email = normalizeEmail(entry.email)
            if (!email) continue
            seen += 1
            if (await repository.addProviderSuppression({ email, origin: entry.origin, sourceId: entry.sourceId })) added += 1
          }
          if (!result.hasMore || !result.data.length) break
          after = result.data.at(-1)!.id
        }
      } catch (error) {
        if (forbidden(error)) {
          suppressionReadsRefused = true
          log('resend_suppression_sync_forbidden', { status: (error as ResendApiError).status })
          return { seen, added, disabled: true }
        }
        throw error
      }
      return { seen, added, disabled: false }
    },
  }
}
