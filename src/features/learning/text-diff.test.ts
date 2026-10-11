import { describe, expect, it } from 'vitest'
import { articleText, diffWords, sameWordsIgnoringCase } from './text-diff'

describe('articleText', () => {
  it('reads HTML as text, one block per line, with list bullets and entities decoded', () => {
    expect(articleText('<h2>Inspection Day</h2><p>Check the &amp; mooring&nbsp;lines.</p><ul><li>One</li><li>Two</li></ul>', 'html'))
      .toBe('Inspection Day\nCheck the & mooring lines.\n• One\n• Two')
  })

  it('keeps plain text lines and collapses spaces', () => {
    expect(articleText('INSPECTION DAY\n\n  Check   the lines.  ', 'plain')).toBe('INSPECTION DAY\nCheck the lines.')
    expect(articleText(null, 'plain')).toBe('')
  })
})

describe('diffWords', () => {
  it('marks only the words that changed', () => {
    expect(diffWords('check the mooring lines today', 'check the new mooring ropes today')).toEqual([
      { kind: 'same', text: 'check the' },
      { kind: 'added', text: 'new' },
      { kind: 'same', text: 'mooring' },
      { kind: 'removed', text: 'lines' },
      { kind: 'added', text: 'ropes' },
      { kind: 'same', text: 'today' },
    ])
  })

  it('reports identical text as one unchanged segment', () => {
    expect(diffWords('a b c', 'a b c')).toEqual([{ kind: 'same', text: 'a b c' }])
  })

  it('falls back to a whole replace for very large inputs', () => {
    expect(diffWords('a b c', 'x y z', 4)).toEqual([
      { kind: 'removed', text: 'a b c' },
      { kind: 'added', text: 'x y z' },
    ])
  })
})

describe('sameWordsIgnoringCase', () => {
  it('treats a heading made Title Case, and new line breaks, as the same words', () => {
    expect(sameWordsIgnoringCase('INSPECTION DAY\nCheck the lines.', 'Inspection Day Check the lines.')).toBe(true)
    expect(sameWordsIgnoringCase('Check the lines.', 'Check the ropes.')).toBe(false)
  })
})
