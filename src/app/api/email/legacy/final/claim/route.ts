import { legacyClaimUrl } from '@/features/legacy-invites/email'
import { legacyFinalReminderRepository } from '@/features/legacy-invites/final-reminder-repository'
import { siteOrigin, siteUrlFor } from '@/lib/site-url'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The claim button of the final legacy reminder (our own click tracking; the email has no open pixel). Records the
 * first click and counts every click on that reminder, then redirects to the same claim link as the first invitation.
 * An unknown or malformed token, or any error, goes to the claim page without an invitation and says nothing more.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('t') ?? ''
  let claimToken: string | null = null
  try {
    claimToken = await legacyFinalReminderRepository.recordClick(token)
  } catch (error) {
    console.error('[legacy_final_reminder_click_failed]', { error: error instanceof Error ? error.name : 'unknown' })
  }
  const target = claimToken ? legacyClaimUrl(siteOrigin(), claimToken) : siteUrlFor('/auth/claim-profile').toString()
  return new Response(null, { status: 303, headers: { Location: target, 'Cache-Control': 'private, no-store' } })
}
