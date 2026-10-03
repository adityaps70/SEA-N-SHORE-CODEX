import { describe, expect, it } from 'vitest'
import { splitDescription } from './description'

describe('splitDescription', () => {
  it('keeps short descriptions whole', () => {
    expect(splitDescription('A short course.')).toEqual(['A short course.', ''])
  })

  it('breaks a long description at the first sentence end after the introduction length', () => {
    const intro = `${'SIRE 2.0 changed tanker vetting. '.repeat(10).trim()}`
    const text = `${intro} The second half is practical. ${'More detail follows here. '.repeat(20)}`
    const [first, rest] = splitDescription(text)
    expect(first.endsWith('.')).toBe(true)
    expect(first.length).toBeLessThanOrEqual(640)
    expect(`${first} ${rest}`).toBe(text.trim())
  })

  it('falls back to a word boundary when there is no sentence end nearby', () => {
    const text = 'word '.repeat(200).trim()
    const [first, rest] = splitDescription(text)
    expect(first.length).toBeLessThanOrEqual(480)
    expect(rest.length).toBeGreaterThan(0)
    expect(`${first} ${rest}`).toBe(text)
  })
})
