import { canUsePlatformAdminAuthority } from '@/features/admin/mfa-gate'
import { createStandardPostWithAurora } from '@/features/feed/service'
import { loadShareSettings } from '@/features/site-settings/share-settings'
import { getMediaObject, putMediaObject } from '@/lib/aws/storage'
import { publicEnvironment } from '@/lib/env'
import { renderShareImage } from './share-render'
import { jobShareRepository } from './share-repository'
import { createJobShareService } from './share-service'

/** Round I (I1): the production job share service. */
export const jobShareService = createJobShareService({
  repository: jobShareRepository,
  isPlatformAdmin: canUsePlatformAdminAuthority,
  // Round CAP (shared cache): the same settings for every share image and layout, kept 30 s (site-settings/share-settings.ts).
  loadSettings: loadShareSettings,
  siteUrl: () => publicEnvironment.NEXT_PUBLIC_SITE_URL,
  render: renderShareImage,
  loadMedia: async (key) => (await getMediaObject({ key, maxBytes: 8 * 1024 * 1024 })).body,
  putMedia: putMediaObject,
  createPost: createStandardPostWithAurora,
})
