import { describe, expect, it } from 'vitest'
import { emfLine, emitMetric } from './emf'
import { recordServerError, serverErrorArea } from './server-errors'

describe('Embedded Metric Format lines', () => {
  it('writes one CloudWatch metric line with dimensions and an all-up rollup', () => {
    const line = JSON.parse(emfLine({ dimensions: { Area: 'feed' }, metrics: { ServerErrors: { value: 1 } }, rollups: [[]], timestamp: 1000 }))
    expect(line).toEqual({
      _aws: { Timestamp: 1000, CloudWatchMetrics: [{ Namespace: 'SeaNShore/App', Dimensions: [['Area'], []], Metrics: [{ Name: 'ServerErrors', Unit: 'Count' }] }] },
      Area: 'feed',
      ServerErrors: 1,
    })
  })

  it('never throws into the caller', () => {
    expect(() => emitMetric({ metrics: { X: { value: 1 } } }, () => { throw new Error('stdout closed') })).not.toThrow()
  })
})

describe('server error areas', () => {
  it('groups paths into the key API areas without keeping the path itself', () => {
    expect(serverErrorArea('/api/feed/impressions')).toBe('impressions')
    expect(serverErrorArea('/api/feed-media/a/b/c.mp4?x=1')).toBe('feed')
    expect(serverErrorArea('/home')).toBe('feed')
    expect(serverErrorArea('/api/realtime/ticket')).toBe('messaging')
    expect(serverErrorArea('/messages/123')).toBe('messaging')
    expect(serverErrorArea('/api/jobs/applications/1/cv')).toBe('jobs')
    expect(serverErrorArea('/learn/courses/sire')).toBe('learning')
    expect(serverErrorArea('/api/payments/cashfree/webhook')).toBe('payments-webhooks')
    expect(serverErrorArea('/settings')).toBe('other')
  })

  it('records only the area, never the path or query', () => {
    const lines: string[] = []
    recordServerError('/api/jobs/123?email=someone@example.com', (line) => lines.push(line))
    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toContain('example.com')
    expect(lines[0]).not.toContain('123')
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ Area: 'jobs', ServerErrors: 1 })
  })
})
