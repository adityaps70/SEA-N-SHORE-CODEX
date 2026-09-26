import { describe, expect, it } from 'vitest'
import { CAPABILITIES } from './policy'
import { capabilityLabel } from './capability-labels'

describe('capabilityLabel', () => {
  it('has a plain-language label for every capability', () => {
    for (const capability of CAPABILITIES) {
      expect(capabilityLabel(capability)).toMatch(/^Can /)
    }
  })

  it('falls back to a readable form for unknown keys', () => {
    expect(capabilityLabel('future.some_power')).toBe('future · some power')
  })
})
