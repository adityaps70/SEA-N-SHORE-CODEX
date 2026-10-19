import { createHash, randomUUID } from 'node:crypto'
import { buildShareContent, type ShareSettings } from './share-content'
import { shareAltText, shareCaption } from './share-caption'
import { layoutShareImage, type ShareLayout } from './share-layout'
import { defaultShareOptions, parseShareOptions, SHARE_FACT_KEYS, type ShareOptions } from './share-options'
import { factValues } from './share-content'
import type { JobShareRepository, ShareJobRecord } from './share-repository'
import type { LoadMedia } from './share-render'

/**
 * Round I (I1): who may share a job, and the share actions.
 *
 * Verified recruiters (their own personal jobs) and verified organizations (their owners, administrators and
 * recruiters, for the organization's jobs) may make the image and post it to the feed; platform administrators (with
 * admin two-step verification) may make the image for any job. Everyone else is refused here, on the server, and
 * never sees the button. Closed, expired, deleted or plan-hidden jobs cannot be shared.
 *
 * Feed share: as the organization for an organization job, as the poster for a personal job. One per job every 7
 * days (a reservation in job_shares, taken back when the post fails), and the normal post rate limit applies.
 */
export const FEED_SHARE_INTERVAL_DAYS = 7
export const JOB_SHARE_POST_CATEGORY = 'career_advice' as const

export type ShareAccess = {
  job: ShareJobRecord
  isPlatformAdmin: boolean
  /** Feed shares of an organization job are posted from the organization page. */
  asOrg: boolean
  /** Personal jobs are posted by their poster only (an administrator cannot post as another member). */
  canPostToFeed: boolean
}

export type JobShareErrorCode = 'job_share_not_found' | 'job_share_forbidden' | 'job_share_closed' | 'job_share_too_soon' | 'job_share_failed'

export class JobShareError extends Error {
  constructor(readonly code: JobShareErrorCode, readonly nextAt: string | null = null) {
    super(code)
    this.name = 'JobShareError'
  }
}

type FeedPostInput = {
  id: string
  category: typeof JOB_SHARE_POST_CATEGORY
  body: string
  audience: 'anyone'
  media: Array<{ storagePath: string; mimeType: 'image/png'; altText: string; position: number; fileName: string; pageCount: null }>
  companyId?: string
  organizationJobShare?: true
}

export function createJobShareService(input: {
  repository: JobShareRepository
  /** A platform administrator with admin two-step verification (canUsePlatformAdminAuthority). */
  isPlatformAdmin: (profileId: string) => Promise<boolean>
  loadSettings: () => Promise<ShareSettings>
  siteUrl: () => string
  render: (input: { content: ReturnType<typeof buildShareContent>; options: ShareOptions; loadMedia: LoadMedia; cacheKey?: string }) => Promise<{ png: Buffer; layout: ShareLayout }>
  loadMedia: LoadMedia
  putMedia: (input: { key: string; body: Buffer; contentType: string }) => Promise<void>
  createPost: (actorId: string, post: FeedPostInput) => Promise<string>
  now?: () => Date
}) {
  const now = input.now ?? (() => new Date())

  async function access(viewerId: string, jobId: string): Promise<ShareAccess | null> {
    const job = await input.repository.getJob(jobId)
    if (!job) return null
    const [grants, isPlatformAdmin] = await Promise.all([
      input.repository.grants(viewerId, jobId),
      input.isPlatformAdmin(viewerId).catch(() => false),
    ])
    const owns = job.companyId ? grants.organizationHiringRole : grants.ownPersonalJob
    if (!owns && !isPlatformAdmin) return null
    return {
      job,
      isPlatformAdmin,
      asOrg: Boolean(job.companyId),
      canPostToFeed: job.companyId ? true : job.createdByUserId === viewerId && grants.ownPersonalJob,
    }
  }

  async function requireAccess(viewerId: string, jobId: string) {
    const granted = await access(viewerId, jobId)
    if (!granted) throw new JobShareError('job_share_forbidden')
    if (!granted.job.live) throw new JobShareError('job_share_closed')
    return granted
  }

  function settingsVersion(settings: ShareSettings) {
    return createHash('sha256').update(JSON.stringify(settings)).digest('hex').slice(0, 16)
  }

  async function renderFor(job: ShareJobRecord, options: ShareOptions) {
    const settings = await input.loadSettings()
    const content = buildShareContent(job, options, settings, input.siteUrl())
    const cacheKey = [job.id, job.updatedAt, options.size, options.look, options.label, options.badge, options.salary, options.qr, options.facts.join('+'), settingsVersion(settings)].join('|')
    const result = await input.render({ content, options, loadMedia: input.loadMedia, cacheKey })
    return { ...result, content, cacheKey }
  }

  return {
    access,

    /** Which of these jobs the viewer may share (a platform administrator: every live one), for the hiring list. */
    async shareableJobIds(viewerId: string, jobs: ReadonlyArray<{ id: string; live: boolean }>) {
      const live = jobs.filter((job) => job.live).map((job) => job.id)
      if (!live.length) return new Set<string>()
      if (await input.isPlatformAdmin(viewerId).catch(() => false)) return new Set(live)
      return input.repository.shareableJobIds(viewerId, live)
    },

    /** Whether the viewer sees "Share job" on the job page. */
    async canShare(viewerId: string, jobId: string) {
      const granted = await access(viewerId, jobId).catch(() => null)
      return Boolean(granted?.job.live)
    },

    /** The panel's PNG for a viewer who may share the job; the options come from the URL (unknown ones fall back). */
    async renderForViewer(viewerId: string, jobId: string, params: URLSearchParams) {
      const granted = await requireAccess(viewerId, jobId)
      return renderFor(granted.job, parseShareOptions(params, granted.job))
    },

    /** The panel's layout summary without drawing (the "Fits" indicator). */
    async layoutForViewer(viewerId: string, jobId: string, params: URLSearchParams) {
      const granted = await requireAccess(viewerId, jobId)
      const options = parseShareOptions(params, granted.job)
      const content = buildShareContent(granted.job, options, await input.loadSettings(), input.siteUrl())
      return layoutShareImage(content, options.size)
    },

    /** The og:image: the default portrait image of a public, open job; null for any other job. */
    async renderOpenGraph(jobId: string) {
      const job = await input.repository.getJob(jobId)
      if (!job?.live) return null
      return renderFor(job, { ...defaultShareOptions(job), size: 'portrait' })
    },

    /** What the share panel shows when it opens. */
    async panelState(viewerId: string, jobId: string) {
      const granted = await requireAccess(viewerId, jobId)
      const { job } = granted
      const defaults = defaultShareOptions(job)
      const applyUrl = `${new URL(input.siteUrl()).origin}/jobs/${job.id}?src=share_image`
      const [last, counts] = await Promise.all([input.repository.lastFeedShare(job.id), input.repository.shareCounts(job.id)])
      const nextAt = last ? new Date(new Date(last.createdAt).getTime() + FEED_SHARE_INTERVAL_DAYS * 86_400_000).toISOString() : null
      const values = factValues(job)
      return {
        jobId: job.id,
        title: job.title,
        defaults,
        availableFacts: SHARE_FACT_KEYS.filter((fact) => values[fact]),
        hasSalary: job.salaryMin !== null || job.salaryMax !== null,
        caption: shareCaption(job, defaults, applyUrl),
        /** The job's caption fields, so the panel rewrites an unedited caption when the label or salary changes. */
        captionJob: {
          id: job.id, title: job.title, companyName: job.companyName, location: job.location, rank: job.rank, domain: job.domain, vesselTypes: job.vesselTypes,
          salaryMin: job.salaryMin, salaryMax: job.salaryMax, salaryCurrency: job.salaryCurrency, salaryPeriod: job.salaryPeriod,
        },
        applyUrl,
        canPostToFeed: granted.canPostToFeed,
        postAs: job.companyId ? job.companyName : 'you',
        lastFeedShareAt: last?.createdAt ?? null,
        nextFeedShareAt: nextAt && new Date(nextAt) > now() ? nextAt : null,
        counts,
      }
    },

    async recordImageShare(viewerId: string, jobId: string) {
      const granted = await requireAccess(viewerId, jobId)
      await input.repository.recordImageShare({ jobId, sharedBy: viewerId, asOrg: granted.asOrg })
    },

    /** Posts the image and caption to the feed, as the organization or as the poster, with the job card attached. */
    async postToFeed(viewerId: string, jobId: string, request: { options: ShareOptions; caption: string }) {
      const granted = await requireAccess(viewerId, jobId)
      if (!granted.canPostToFeed) throw new JobShareError('job_share_forbidden')
      // The caption's link was made for the image (src=share_image); applies from the feed post count as feed_share.
      const caption = request.caption.trim().slice(0, 3000).replaceAll(`/jobs/${jobId}?src=share_image`, `/jobs/${jobId}?src=feed_share`)
      const reservation = await input.repository.reserveFeedShare({ jobId, sharedBy: viewerId, asOrg: granted.asOrg, days: FEED_SHARE_INTERVAL_DAYS })
      if (!reservation.reserved) {
        throw new JobShareError('job_share_too_soon', new Date(new Date(reservation.lastAt).getTime() + FEED_SHARE_INTERVAL_DAYS * 86_400_000).toISOString())
      }
      try {
        const { png } = await renderFor(granted.job, request.options)
        const postId = randomUUID()
        const storagePath = `${viewerId}/${postId}/${randomUUID()}.png`
        await input.putMedia({ key: storagePath, body: png, contentType: 'image/png' })
        await input.createPost(viewerId, {
          id: postId,
          category: JOB_SHARE_POST_CATEGORY,
          body: caption || shareCaption(granted.job, request.options, `${new URL(input.siteUrl()).origin}/jobs/${jobId}?src=feed_share`),
          audience: 'anyone',
          media: [{ storagePath, mimeType: 'image/png', altText: shareAltText(granted.job, request.options), position: 0, fileName: 'job.png', pageCount: null }],
          ...(granted.job.companyId ? { companyId: granted.job.companyId, organizationJobShare: true as const } : {}),
        })
        await input.repository.attachPost(reservation.shareId, postId)
        return { postId }
      } catch (error) {
        await input.repository.cancelReservation(reservation.shareId).catch(() => undefined)
        throw error
      }
    },
  }
}

export type JobShareService = ReturnType<typeof createJobShareService>
