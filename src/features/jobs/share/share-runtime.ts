import { canUsePlatformAdminAuthority } from '@/features/admin/mfa-gate'
import { createStandardPostWithAurora } from '@/features/feed/service'
import { siteSettingsRepository } from '@/features/site-settings/repository'
import { getMediaObject, putMediaObject } from '@/lib/aws/storage'
import { publicEnvironment } from '@/lib/env'
import { renderShareImage } from './share-render'
import { jobShareRepository } from './share-repository'
import { createJobShareService } from './share-service'

/** Round I (I1): the production job share service. */
export const jobShareService = createJobShareService({
  repository: jobShareRepository,
  isPlatformAdmin: canUsePlatformAdminAuthority,
  loadSettings: async () => {
    const [socials, about] = await Promise.all([siteSettingsRepository.get('social_handles'), siteSettingsRepository.get('about_page')])
    return { socials, partners: about.partners.map((partner) => ({ name: partner.name, logoPath: partner.logoPath })) }
  },
  siteUrl: () => publicEnvironment.NEXT_PUBLIC_SITE_URL,
  render: renderShareImage,
  loadMedia: async (key) => (await getMediaObject({ key, maxBytes: 8 * 1024 * 1024 })).body,
  putMedia: putMediaObject,
  createPost: createStandardPostWithAurora,
})
