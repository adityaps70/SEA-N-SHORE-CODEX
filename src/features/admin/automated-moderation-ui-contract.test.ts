import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('admin automated moderation UI contract', () => {
  it('labels automatically generated moderation cases clearly', () => {
    const source = readFileSync('src/app/(app)/admin/moderation/page.tsx', 'utf8')
    expect(source).toContain('Automated flag')
    expect(source).toContain('hasAutomatedFlag')
    expect(source).toContain('[AUTOMATED MODERATION]')
  })
})
