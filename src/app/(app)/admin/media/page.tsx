import type { Metadata } from 'next'
import { AdminPageHeader, AdminPanel } from '@/features/admin/components/admin-ui'
import { VideoPosterBackfill } from '@/features/feed/components/video-poster-backfill'
import { feedRepository } from '@/features/feed/repository'
import { pluralize } from '@/lib/format'

export const metadata: Metadata = { title: 'Video posters · Admin' }
export const dynamic = 'force-dynamic'

/**
 * Round H (H1): makes posters for videos posted before posters existed. The frames are captured in
 * this browser (canvas), the same way the composer does it for new uploads: no transcoding service.
 * The admin layout already requires a platform administrator.
 */
export default async function AdminVideoPostersPage() {
  const videos = await feedRepository.listPostedVideoStoragePaths().catch(() => [] as string[])
  const feedUrls = videos.map((path) => `/api/feed-media/${path.split('/').map(encodeURIComponent).join('/')}`)

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Video posters"
        description="Videos posted before posters existed show as black boxes until they have one. This page makes the missing posters from a frame of each video, in your browser."
        meta={pluralize(videos.length, 'video')}
      />
      <AdminPanel className="p-4 sm:p-5">
        <VideoPosterBackfill videoUrls={feedUrls} />
      </AdminPanel>
    </div>
  )
}
