import { describe, expect, it } from 'vitest'
import { config } from 'zod'

describe('instrumentation-client', () => {
  // Without jitless mode Zod probes with Function(''), which the Content Security Policy (no 'unsafe-eval') blocks.
  it('puts Zod in jitless mode before the app runs', async () => {
    await import('./instrumentation-client')
    expect(config().jitless).toBe(true)
  })
})
