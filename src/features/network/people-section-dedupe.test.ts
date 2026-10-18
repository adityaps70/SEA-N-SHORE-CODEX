import { describe, expect, it } from 'vitest'
import { dedupePeopleSections } from './people-section-dedupe'

const person = (id: string) => ({ id })

describe('dedupePeopleSections (round H, H7)', () => {
  it('keeps each person in the first section that lists them and out of More people you may know', () => {
    const result = dedupePeopleSections(
      [
        { key: 'mutual', profiles: [person('a'), person('b')] },
        { key: 'similar', profiles: [person('b'), person('c')] },
      ],
      [person('a'), person('c'), person('d')],
    )

    expect(result.sections).toEqual([
      { key: 'mutual', profiles: [person('a'), person('b')] },
      { key: 'similar', profiles: [person('c')] },
    ])
    expect(result.more).toEqual([person('d')])
  })

  it('drops a section that becomes empty and removes repeats within one list', () => {
    const result = dedupePeopleSections(
      [
        { key: 'mutual', profiles: [person('a'), person('a')] },
        { key: 'company', profiles: [person('a')] },
      ],
      [person('a')],
    )

    expect(result.sections).toEqual([{ key: 'mutual', profiles: [person('a')] }])
    expect(result.more).toEqual([])
  })

  it('leaves More people you may know untouched when there are no sections', () => {
    expect(dedupePeopleSections([], [person('a'), person('b')])).toEqual({ sections: [], more: [person('a'), person('b')] })
  })
})
