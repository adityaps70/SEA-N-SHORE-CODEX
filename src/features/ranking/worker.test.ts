import { describe, expect, it, vi } from 'vitest'
import { createRankingSweeps } from './worker'

describe('ranking sweeps', () => {
  it('waits for the round G schema, then runs each sweep once per interval and keeps going after a failure', async () => {
    let clock = 0
    let ready = false
    const fast = vi.fn(async () => ({ purged: 1 }))
    const failing = vi.fn(async () => { throw new Error('boom') })
    const sweeps = createRankingSweeps({
      now: () => clock,
      log: () => undefined,
      schemaReady: async () => ready,
      sweeps: [
        { name: 'failing', everyMs: 1000, run: failing },
        { name: 'fast', everyMs: 1000, run: fast },
      ],
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await sweeps.runDue()
    expect(fast).not.toHaveBeenCalled()

    ready = true
    clock += 10 * 60 * 1000
    await sweeps.runDue()
    await sweeps.runDue()
    expect(fast).toHaveBeenCalledTimes(1)
    expect(failing).toHaveBeenCalledTimes(1)

    clock += 1000
    await sweeps.runDue()
    expect(fast).toHaveBeenCalledTimes(2)
  })
})
