import { createNewsletterSender } from './sending'
import { createNewsletterSesSync } from './ses-sync'

/**
 * One bounded pass of newsletter background work, run by the outbox worker
 * (scripts/workers/publish-outbox.ts): retry SES contact sync, pull SES-side
 * opt-outs back into the database, send confirmation emails and campaign batches.
 */
export function createNewsletterWorker(deps: {
  sync?: Pick<ReturnType<typeof createNewsletterSesSync>, 'runSyncSweep' | 'runReconcileSweep'>
  sender?: Pick<ReturnType<typeof createNewsletterSender>, 'runConfirmationSweep' | 'runCampaignSweep'>
} = {}) {
  const sync = deps.sync ?? createNewsletterSesSync()
  const sender = deps.sender ?? createNewsletterSender()

  return {
    async runOnce() {
      const syncResult = await sync.runSyncSweep(50)
      const reconcile = await sync.runReconcileSweep(25)
      const confirmations = await sender.runConfirmationSweep(25)
      const campaigns = await sender.runCampaignSweep(50)
      return { sync: syncResult, reconcile, confirmations, campaigns }
    },
  }
}
