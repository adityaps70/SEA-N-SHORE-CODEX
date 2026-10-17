import type { Metadata } from 'next'
import { describe, expect, it, vi } from 'vitest'

// Only the metadata objects are read: nothing renders, so the data sources are stubbed out.
vi.mock('@/features/auth/queries', () => ({ getVerifiedUser: vi.fn() }))
vi.mock('@/features/billing/public-prices', () => ({ loadPublicPlanPrices: vi.fn() }))
vi.mock('@/features/newsletter/queries', () => ({ getViewerNewsletterState: vi.fn() }))
vi.mock('next/cache', () => ({ unstable_cache: <T>(fn: T) => fn, revalidateTag: vi.fn() }))

const INDEXABLE: Array<[path: string, load: () => Promise<{ metadata: Metadata }>]> = [
  ['/about', () => import('./about/page')],
  ['/accessibility', () => import('./accessibility/page')],
  ['/contact', () => import('./contact/page')],
  ['/copyright', () => import('./copyright/page')],
  ['/help', () => import('./help/page')],
  ['/newsletter', () => import('./newsletter/page')],
  ['/pricing', () => import('./pricing/page')],
  ['/privacy', () => import('./privacy/page')],
  ['/refunds', () => import('./refunds/page')],
  ['/shipping', () => import('./shipping/page')],
  ['/terms', () => import('./terms/page')],
]

const NOINDEX: Array<[path: string, load: () => Promise<{ metadata: Metadata }>]> = [
  ['/email/unsubscribe', () => import('./email/unsubscribe/page')],
  ['/email/learning/unsubscribe', () => import('./email/learning/unsubscribe/page')],
  ['/email/legacy/unsubscribe', () => import('./email/legacy/unsubscribe/page')],
  ['/newsletter/confirm', () => import('./newsletter/confirm/page')],
  ['/newsletter/unsubscribe', () => import('./newsletter/unsubscribe/page')],
]

describe('marketing page metadata (Round H, H5)', () => {
  it.each(INDEXABLE)('%s has its clean path as canonical and a plain search description', async (path, load) => {
    const { metadata } = await load()
    expect(metadata.alternates?.canonical).toBe(path)
    const description = metadata.description ?? ''
    expect(description.length).toBeGreaterThan(40)
    expect(description.length).toBeLessThanOrEqual(160)
    expect(description).not.toMatch(/[\n\r]|\p{Extended_Pictographic}/u)
    expect(metadata.robots).toBeUndefined()
  })

  it.each(NOINDEX)('%s stays noindex, without a canonical', async (_path, load) => {
    const { metadata } = await load()
    expect(metadata.robots).toEqual({ index: false })
    expect(metadata.alternates).toBeUndefined()
  })
})
