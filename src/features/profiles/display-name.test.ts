import { describe, expect, it } from 'vitest'
import { firstNameOf } from './display-name'

describe('firstNameOf', () => {
  it('returns the first name', () => {
    expect(firstNameOf('Asha Singh', 'this member')).toBe('Asha')
  })

  it('skips leading titles and ranks, with or without a full stop', () => {
    expect(firstNameOf('Capt. Arjun Rao', 'this member')).toBe('Arjun')
    expect(firstNameOf('Capt Arjun Rao', 'this member')).toBe('Arjun')
    expect(firstNameOf('Dr. Mrs. Nisha Menon', 'this member')).toBe('Nisha')
  })

  it('keeps a lone title rather than returning nothing, and falls back for a blank name', () => {
    expect(firstNameOf('Capt.', 'this member')).toBe('Capt.')
    expect(firstNameOf('   ', 'this member')).toBe('this member')
  })
})
