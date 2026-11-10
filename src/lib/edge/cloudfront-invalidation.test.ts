import { CreateInvalidationCommand } from '@aws-sdk/client-cloudfront'
import { describe, expect, it, vi } from 'vitest'
import {
  createOrganizationPageInvalidator,
  ORGANIZATION_PAGE_INVALIDATION_WINDOW_MS,
  organizationPageInvalidationPath,
} from './cloudfront-invalidation'

function setup(input: { distributionId?: string | null; fail?: boolean } = {}) {
  let clock = 1_000_000
  const send = vi.fn(async () => {
    if (input.fail) throw Object.assign(new Error('Access denied for arn:aws:cloudfront::123:distribution/X'), { name: 'AccessDenied' })
    return {}
  })
  const metric = vi.fn()
  const log = vi.fn()
  const invalidate = createOrganizationPageInvalidator({
    distributionId: () => ('distributionId' in input ? input.distributionId : 'E2EXAMPLE'),
    sender: () => ({ send }),
    now: () => clock,
    metric,
    log,
  })
  const counted = (name: string) => metric.mock.calls.filter(([line]) => name in line.metrics).length
  return { invalidate, send, metric, log, counted, advance: (ms: number) => { clock += ms } }
}

describe('CloudFront invalidation of organization pages (Round ARCH, Phase 2)', () => {
  it('sends one wildcard path for the page and its ?tab= variants, and counts it', async () => {
    const { invalidate, send, metric, counted } = setup()
    await expect(invalidate('harbour-minds')).resolves.toBe('sent')
    expect(send).toHaveBeenCalledTimes(1)
    const command = (send.mock.calls[0] as unknown as [CreateInvalidationCommand])[0]
    expect(command).toBeInstanceOf(CreateInvalidationCommand)
    expect(command.input).toEqual({
      DistributionId: 'E2EXAMPLE',
      InvalidationBatch: { CallerReference: 'org-page-harbour-minds-1000000', Paths: { Quantity: 1, Items: ['/organizations/harbour-minds*'] } },
    })
    expect(organizationPageInvalidationPath('harbour-minds')).toBe('/organizations/harbour-minds*')
    expect(counted('OrgPageInvalidations')).toBe(1)
    expect(metric).toHaveBeenCalledWith({ dimensions: { Area: 'organizations' }, metrics: { OrgPageInvalidations: { value: 1 } } })
  })

  it('sends at most one per organization per minute', async () => {
    const { invalidate, send, advance, counted } = setup()
    await invalidate('harbour-minds')
    advance(10_000)
    await expect(invalidate('harbour-minds')).resolves.toBe('deduped')
    advance(ORGANIZATION_PAGE_INVALIDATION_WINDOW_MS - 10_001)
    await expect(invalidate('harbour-minds')).resolves.toBe('deduped')
    // Another organization is not held back.
    await expect(invalidate('oceanic-ship-management')).resolves.toBe('sent')
    advance(1)
    await expect(invalidate('harbour-minds')).resolves.toBe('sent')
    expect(send).toHaveBeenCalledTimes(3)
    expect(counted('OrgPageInvalidations')).toBe(3)
    expect(counted('OrgPageInvalidationsDeduped')).toBe(2)
  })

  it('an immediate clear (suspension, rejection, removal) skips the minute\'s wait', async () => {
    const { invalidate, send, advance } = setup()
    await invalidate('harbour-minds')
    advance(1_000)
    await expect(invalidate('harbour-minds', { immediate: true })).resolves.toBe('sent')
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('does nothing without a distribution id (development and tests)', async () => {
    for (const distributionId of [undefined, null, '', '   ']) {
      const { invalidate, send, metric } = setup({ distributionId })
      await expect(invalidate('harbour-minds')).resolves.toBe('disabled')
      expect(send).not.toHaveBeenCalled()
      expect(metric).not.toHaveBeenCalled()
    }
  })

  it('never sends a path built from an unexpected slug', async () => {
    const { invalidate, send } = setup()
    for (const slug of ['', '*', 'a/b', '../admin', 'Harbour', 'harbour minds', '-x']) {
      await expect(invalidate(slug)).resolves.toBe('invalid')
    }
    expect(send).not.toHaveBeenCalled()
  })

  it('a failure never throws, is counted, logs only the error type, and lets the next edit retry', async () => {
    const { invalidate, send, log, counted } = setup({ fail: true })
    await expect(invalidate('harbour-minds')).resolves.toBe('failed')
    expect(counted('OrgPageInvalidationFailures')).toBe(1)
    expect(counted('OrgPageInvalidations')).toBe(0)
    expect(log).toHaveBeenCalledWith(JSON.stringify({ event: 'org_page_invalidation_failed', reason: 'AccessDenied' }))
    expect(String(log.mock.calls[0]?.[0])).not.toContain('arn:')
    await expect(invalidate('harbour-minds')).resolves.toBe('failed')
    expect(send).toHaveBeenCalledTimes(2)
  })
})
