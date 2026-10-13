import { describe, expect, it } from 'vitest'
import { highlightParts } from './highlight'

describe('highlightParts', () => {
  it('marks the matched start of each word', () => {
    expect(highlightParts('Sachin Placeholder', 'sach pla')).toEqual([
      { text: 'Sach', match: true }, { text: 'in', match: false }, { text: ' ', match: false },
      { text: 'Pla', match: true }, { text: 'ceholder', match: false },
    ])
  })

  it('leaves text alone when nothing matches', () => {
    expect(highlightParts('Chief Officer', 'xyz')).toEqual([{ text: 'Chief', match: false }, { text: ' ', match: false }, { text: 'Officer', match: false }])
  })
})
