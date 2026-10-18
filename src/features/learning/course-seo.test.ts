import { describe, expect, it } from 'vitest'
import { courseMetaDescription } from './course-seo'

describe('course meta descriptions', () => {
  it('prefers the subtitle and falls back to the description', () => {
    expect(courseMetaDescription({ subtitle: 'Practical inspection readiness', description: 'A longer description.' })).toBe('Practical inspection readiness')
    expect(courseMetaDescription({ subtitle: '   ', description: 'A practical\nmaritime course.' })).toBe('A practical maritime course.')
    expect(courseMetaDescription({ subtitle: null, description: 'A practical maritime course.' })).toBe('A practical maritime course.')
  })

  it('cuts a long description at a word, within 160 characters', () => {
    const description = courseMetaDescription({ subtitle: null, description: 'Evidence-led SIRE 2.0 preparation for officers and superintendents, with onboard drills. '.repeat(4) })
    expect(description.length).toBeLessThanOrEqual(160)
    expect(description.length).toBeGreaterThanOrEqual(120)
    expect(description.endsWith('…')).toBe(true)
  })

  it('strips Markdown markers and emoji (Round H, H5)', () => {
    const description = courseMetaDescription({
      subtitle: null,
      description: '## SIRE 2.0 🚢\n\n**Get ready** for your _next_ inspection ✅\n\n- Human factors\n- [Photo evidence](https://example.com)',
    })
    expect(description).toBe('SIRE 2.0 Get ready for your next inspection Human factors Photo evidence')
    // A subtitle with nothing left once emoji are removed falls back to the description.
    expect(courseMetaDescription({ subtitle: '🚢⚓', description: 'A practical maritime course.' })).toBe('A practical maritime course.')
  })
})
