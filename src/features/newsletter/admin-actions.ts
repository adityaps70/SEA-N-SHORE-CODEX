'use server'

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { z } from 'zod'
import { requirePlatformAdministratorUser } from '@/features/admin/access'
import { userFacingError } from '@/lib/errors/user-messages'
import { newsletterRepository } from './repository'
import { newsletterCampaignSchema } from './schemas'
import { createNewsletterSender } from './sending'
import { createNewsletterSesSync } from './ses-sync'

export type AdminNewsletterState = {
  status: 'idle' | 'success' | 'error'
  message?: string
  fieldErrors?: Partial<Record<'topic' | 'subject' | 'bodyText', string>>
}

async function requireAdmin(): Promise<{ ok: true; adminId: string } | { ok: false; state: AdminNewsletterState }> {
  try {
    const admin = await requirePlatformAdministratorUser()
    return { ok: true, adminId: admin.id }
  } catch (error) {
    const message = error instanceof Error && error.message === 'admin_forbidden'
      ? 'Only Sea N Shore administrators can manage the newsletter.'
      : userFacingError(error, 'We could not check your access. Please try again.')
    return { ok: false, state: { status: 'error', message } }
  }
}

export async function adminUnsubscribeSubscriber(_previous: AdminNewsletterState, formData: FormData): Promise<AdminNewsletterState> {
  const admin = await requireAdmin()
  if (!admin.ok) return admin.state

  const id = z.string().uuid().safeParse(formData.get('subscriberId'))
  if (!id.success) return { status: 'error', message: 'This subscriber could not be found. Reload the page and try again.' }

  try {
    const result = await newsletterRepository.unsubscribe(id.data, { source: 'admin', actorProfileId: admin.adminId })
    if (!result.subscriber) return { status: 'error', message: 'This subscriber no longer exists.' }
    if (result.outcome === 'unsubscribed') {
      after(async () => {
        try {
          await createNewsletterSesSync().syncById(id.data)
        } catch (error) {
          console.error('[newsletter_admin_sync_failed]', { subscriberId: id.data, error: error instanceof Error ? error.name : 'unknown' })
        }
      })
    }
    revalidatePath('/admin/newsletter')
    return {
      status: 'success',
      message: result.outcome === 'unsubscribed'
        ? `${result.subscriber.email} is unsubscribed. The change is recorded in their consent history.`
        : `${result.subscriber.email} was already unsubscribed.`,
    }
  } catch (error) {
    console.error('[newsletter_admin_unsubscribe_failed]', { error: error instanceof Error ? error.name : 'unknown' })
    return { status: 'error', message: 'The unsubscribe could not be saved, and nothing was changed. Please try again.' }
  }
}

export async function queueNewsletterCampaign(_previous: AdminNewsletterState, formData: FormData): Promise<AdminNewsletterState> {
  const admin = await requireAdmin()
  if (!admin.ok) return admin.state

  const sender = createNewsletterSender()
  const sending = sender.sendingStatus()
  if (!sending.enabled) {
    return { status: 'error', message: 'Campaign sending is turned off until Amazon SES production access and the sender are configured.' }
  }

  const parsed = newsletterCampaignSchema.safeParse({
    topic: formData.get('topic'),
    subject: formData.get('subject') ?? '',
    bodyText: formData.get('bodyText') ?? '',
  })
  if (!parsed.success) {
    const fieldErrors: AdminNewsletterState['fieldErrors'] = {}
    for (const issue of parsed.error.issues) {
      const field = issue.path[0]
      if ((field === 'topic' || field === 'subject' || field === 'bodyText') && !fieldErrors[field]) fieldErrors[field] = issue.message
    }
    return { status: 'error', message: 'Please fix the highlighted fields.', fieldErrors }
  }

  try {
    const campaign = await sender.queueCampaign({ adminId: admin.adminId, ...parsed.data })
    revalidatePath('/admin/newsletter')
    return {
      status: 'success',
      message: campaign.recipientCount
        ? `Campaign queued for ${campaign.recipientCount} subscriber${campaign.recipientCount === 1 ? '' : 's'}. Sending starts within a minute and runs in batches.`
        : 'Campaign saved, but no subscribers currently receive this topic, so nothing will be sent.',
    }
  } catch (error) {
    console.error('[newsletter_campaign_queue_failed]', { error: error instanceof Error ? error.name : 'unknown' })
    return { status: 'error', message: userFacingError(error, 'The campaign could not be queued, and nothing was sent. Please try again.') }
  }
}
