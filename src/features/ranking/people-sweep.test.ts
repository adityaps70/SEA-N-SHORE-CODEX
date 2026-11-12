import { describe, expect, it, vi } from 'vitest'
import { createPeopleSweep, PEOPLE_SWEEP_BATCH, PEOPLE_SWEEP_PASS_MS } from './people-sweep'
import { createRankingSweeps } from './worker'

/**
 * Round DB (PYMK fix 1, owner-approved 12 Nov): the nightly rebuild refreshes the same members in the same
 * order as before, but 10 at a time, once every 30 seconds, instead of 25 on every worker loop pass.
 */
describe('the nightly People you may know rebuild, paced', () => {
  it('refreshes 10 members per pass, one pass every 30 seconds, covering every member once in order', async () => {
    expect(PEOPLE_SWEEP_BATCH).toBe(10)
    expect(PEOPLE_SWEEP_PASS_MS).toBe(30_000)
    const members = Array.from({ length: 23 }, (_, n) => `member-${String(n).padStart(2, '0')}`)
    const listViewersToRefresh = vi.fn(async (after: string | null, limit: number) => members.filter((id) => after === null || id > after).slice(0, limit))
    const refreshed: string[] = []
    let clock = Date.parse('2026-11-12T20:29:31Z')
    const sweep = createPeopleSweep({
      candidates: { listViewersToRefresh } as never,
      service: { refreshQuietly: async (id: string) => { refreshed.push(id) } } as never,
      query: async () => [{ filled: true }],
      now: () => clock,
    })
    expect(sweep.everyMs).toBe(PEOPLE_SWEEP_PASS_MS)

    // Driven by the worker loop, which calls far more often than every 30 seconds.
    const sweeps = createRankingSweeps({ sweeps: [sweep], now: () => clock, log: () => {}, schemaReady: async () => true })
    const passes: number[] = []
    const start = clock
    for (let second = 0; second < 300; second += 1) {
      clock = start + second * 1000
      const before = refreshed.length
      await sweeps.runDue()
      if (refreshed.length > before) passes.push((clock - start) / 1000)
    }
    // Before 20:30 nothing; from then 10, 10 and 3 members on three passes 30 seconds apart.
    expect(refreshed).toEqual(members)
    expect(passes).toEqual([30, 60, 90])
    expect(listViewersToRefresh.mock.calls.map(([, limit]) => limit)).toEqual([10, 10, 10])
  })
})
