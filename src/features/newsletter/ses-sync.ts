import { getNewsletterConfig, type NewsletterConfig } from './config'
import { newsletterRepository, type NewsletterRepository, type NewsletterSubscriber } from './repository'
import { createSesV2Client, SesApiError, type SesContact, type SesTopicPreference, type SesV2Client } from './ses-client'
import { NEWSLETTER_TOPIC_IDS, type NewsletterTopic } from './topics'

export type SyncResult = 'synced' | 'skipped' | 'failed' | 'stale'

type Deps = {
  repository?: Pick<
    NewsletterRepository,
    'getById' | 'claimDueForSync' | 'markSynced' | 'markSyncFailed' | 'claimForReconcile' | 'unsubscribe' | 'updateTopics'
  >
  ses?: Pick<SesV2Client, 'upsertContact' | 'getContact'> | null
  config?: NewsletterConfig
}

export function sesTopicPreferences(config: NewsletterConfig, subscriber: Pick<NewsletterSubscriber, 'status' | 'topics'>): SesTopicPreference[] {
  return NEWSLETTER_TOPIC_IDS.map((topic) => ({
    TopicName: config.sesTopicNames[topic],
    SubscriptionStatus: subscriber.status === 'subscribed' && subscriber.topics.includes(topic) ? 'OPT_IN' : 'OPT_OUT',
  }))
}

function syncErrorMessage(error: unknown) {
  if (error instanceof SesApiError) return `${error.code}: ${error.message}`.slice(0, 500)
  if (error instanceof Error) return error.message.slice(0, 500)
  return 'unknown_error'
}

/** Topics the member still receives according to SES (opt-outs made through SES subscription management). */
export function topicsStillOptedIn(config: NewsletterConfig, subscriber: NewsletterSubscriber, contact: SesContact): NewsletterTopic[] {
  if (contact.UnsubscribeAll) return []
  const optedOut = new Set(
    (contact.TopicPreferences ?? []).filter((entry) => entry.SubscriptionStatus === 'OPT_OUT').map((entry) => entry.TopicName),
  )
  return subscriber.topics.filter((topic) => !optedOut.has(config.sesTopicNames[topic]))
}

/**
 * Keeps the SES contact list in step with the database (the source of truth).
 * A failed call never loses a signup: the row stays in the database with
 * ses_sync_status = failed and is retried with backoff by the outbox worker.
 */
export function createNewsletterSesSync(deps: Deps = {}) {
  const config = deps.config ?? getNewsletterConfig()
  const repository = deps.repository ?? newsletterRepository
  const ses = deps.ses === undefined ? createSesV2Client({ region: config.region }) : deps.ses

  async function syncSubscriber(subscriber: NewsletterSubscriber): Promise<SyncResult> {
    if (!config.contactListName || !ses) return 'skipped'
    try {
      if (subscriber.status !== 'pending') {
        await ses.upsertContact(config.contactListName, {
          email: subscriber.email,
          topics: sesTopicPreferences(config, subscriber),
          unsubscribeAll: subscriber.status === 'unsubscribed',
        })
      }
      return (await repository.markSynced(subscriber.id, subscriber.updatedAt)) ? 'synced' : 'stale'
    } catch (error) {
      console.error('[newsletter_ses_sync_failed]', {
        subscriberId: subscriber.id,
        code: error instanceof SesApiError ? error.code : 'error',
      })
      await repository.markSyncFailed(subscriber.id, subscriber.updatedAt, syncErrorMessage(error))
      return 'failed'
    }
  }

  return {
    syncSubscriber,

    async syncById(id: string): Promise<SyncResult> {
      const subscriber = await repository.getById(id)
      if (!subscriber || subscriber.sesSyncStatus === 'synced' || subscriber.sesSyncStatus === 'not_required') return 'skipped'
      return syncSubscriber(subscriber)
    },

    async runSyncSweep(limit = 50) {
      if (!config.contactListName || !ses) return { claimed: 0, synced: 0, failed: 0, skipped: true }
      const due = await repository.claimDueForSync(limit)
      let synced = 0
      let failed = 0
      for (const subscriber of due) {
        const result = await syncSubscriber(subscriber)
        if (result === 'synced') synced += 1
        if (result === 'failed') failed += 1
      }
      return { claimed: due.length, synced, failed, skipped: false }
    },

    /** Pulls opt-outs made through SES subscription management back into the database. */
    async runReconcileSweep(limit = 25) {
      if (!config.contactListName || !ses) return { checked: 0, updated: 0 }
      const subscribers = await repository.claimForReconcile(limit)
      let updated = 0
      for (const subscriber of subscribers) {
        try {
          const contact = await ses.getContact(config.contactListName, subscriber.email)
          if (!contact) continue
          const remaining = topicsStillOptedIn(config, subscriber, contact)
          if (remaining.length === subscriber.topics.length) continue
          if (remaining.length === 0) {
            await repository.unsubscribe(subscriber.id, { source: 'ses_subscription_management' })
          } else {
            await repository.updateTopics(subscriber.id, remaining, { source: 'ses_subscription_management' })
          }
          updated += 1
        } catch (error) {
          console.error('[newsletter_ses_reconcile_failed]', {
            subscriberId: subscriber.id,
            code: error instanceof SesApiError ? error.code : 'error',
          })
        }
      }
      return { checked: subscribers.length, updated }
    },
  }
}
