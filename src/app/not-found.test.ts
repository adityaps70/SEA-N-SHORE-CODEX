import { describe, expect, it } from 'vitest'
import { metadata as rootNotFound } from './not-found'
import { metadata as appNotFound } from './(app)/not-found'
import { metadata as marketingNotFound } from './(marketing)/not-found'
import { metadata as publicNotFound } from './(public)/not-found'
import { metadata as postNotFound } from './(public)/posts/[id]/not-found'

describe('not-found pages (Round H, H5)', () => {
  it.each([
    ['root', rootNotFound],
    ['(app)', appNotFound],
    ['(marketing)', marketingNotFound],
    ['(public)', publicNotFound],
    ['(public)/posts/[id]', postNotFound],
  ])('%s is titled "Page not found · Sea N Shore" (without the root template) and is not indexed', (_segment, metadata) => {
    // Next reads metadata from not-found files; the deepest one wins, so each file sets it.
    expect(metadata.title).toEqual({ absolute: 'Page not found · Sea N Shore' })
    expect(metadata.robots).toEqual({ index: false })
  })
})
