import { describe, expect, it } from 'vitest'
import { networkTabSchema, parseNetworkTab, targetProfileSchema } from './schemas'

describe('network schemas', () => {
  it('accepts known tabs only', () => {
    expect(networkTabSchema.safeParse('connections').success).toBe(true)
    expect(networkTabSchema.safeParse('random').success).toBe(false)
  })

  it('defaults invalid tabs to discover', () => {
    expect(parseNetworkTab('random')).toBe('discover')
    expect(parseNetworkTab(undefined)).toBe('discover')
  })

  it('requires UUID profile ids', () => {
    expect(targetProfileSchema.safeParse({ targetId: '11111111-1111-4111-8111-111111111111' }).success).toBe(true)
    expect(targetProfileSchema.safeParse({ targetId: 'member-a' }).success).toBe(false)
  })
})
