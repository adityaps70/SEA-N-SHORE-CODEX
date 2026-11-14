import { createSharedCache } from '@/lib/server/shared-cache'
import { siteSettingsRepository } from './repository'

/** The social handles and partner logos every job share image and layout uses (site settings). */
async function readShareSettings() {
  const [socials, about] = await Promise.all([siteSettingsRepository.get('social_handles'), siteSettingsRepository.get('about_page')])
  return { socials, partners: about.partners.map((partner) => ({ name: partner.name, logoPath: partner.logoPath })) }
}

/**
 * Round CAP (shared cache): the same settings for every share image, kept 30 s per task. Cleared on this task when an
 * admin saves the social handles or the About page (admin-actions.ts); other tasks catch up within 30 s.
 */
export const shareSettingsCache = createSharedCache<Awaited<ReturnType<typeof readShareSettings>>>({ name: 'share_settings', ttlMs: 30_000, maxEntries: 1 })

export function loadShareSettings() {
  return shareSettingsCache.get('all', readShareSettings)
}
