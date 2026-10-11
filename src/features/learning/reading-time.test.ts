import { describe, expect, it } from 'vitest'
import { articleWordCount, readingMinutes } from './reading-time'

describe('reading time (learning round E, E5)', () => {
  it('counts words in plain text and in HTML without the markup', () => {
    expect(articleWordCount('WHY THIS MODULE MATTERS\n\n- one two', 'plain')).toBe(6)
    expect(articleWordCount('<h2>Why it matters</h2><p>One <strong>two</strong>&nbsp;three</p><script>x y z</script>', 'html')).toBe(6)
  })

  it('rounds to whole minutes at 220 words a minute, at least one', () => {
    expect(readingMinutes('word '.repeat(10), 'plain')).toBe(1)
    expect(readingMinutes('word '.repeat(2640), 'plain')).toBe(12)
    expect(readingMinutes(null, 'plain')).toBe(0)
  })
})
