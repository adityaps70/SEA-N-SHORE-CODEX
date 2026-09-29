import { describe, expect, it } from 'vitest'
import { postLoadingPriority } from './post-loading-priority'

describe('postLoadingPriority', () => {
  it('loads the first two posts eagerly, the very first with high priority, the rest lazily', () => {
    expect(postLoadingPriority(0)).toBe('lead')
    expect(postLoadingPriority(1)).toBe('eager')
    expect(postLoadingPriority(2)).toBeUndefined()
    expect(postLoadingPriority(25)).toBeUndefined()
  })
})
