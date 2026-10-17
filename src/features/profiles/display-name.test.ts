import { describe, expect, it } from 'vitest'
import { displayName, firstNameOf, nameCaseSuggestion } from './display-name'

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

describe('displayName (Round H, H7)', () => {
  it('title-cases ALL CAPS and all-lowercase names', () => {
    expect(displayName('PLACEHOLDER MEMBER')).toBe('Placeholder Member')
    expect(displayName('placeholder member')).toBe('Placeholder Member')
  })

  it('keeps a mixed-case name as the member typed it', () => {
    expect(displayName('Placeholder deMember')).toBe('Placeholder deMember')
    expect(displayName('  Placeholder   Member ')).toBe('Placeholder Member')
  })

  it('keeps initials sensible', () => {
    expect(displayName('J. R. SMITH')).toBe('J. R. Smith')
    expect(displayName('j.r. smith')).toBe('J.R. Smith')
    expect(displayName('a kumar')).toBe('A Kumar')
  })

  it('keeps particles lowercase after the first word', () => {
    expect(displayName('LUDWIG VAN BEETHOVEN')).toBe('Ludwig van Beethoven')
    expect(displayName('maria da silva')).toBe('Maria da Silva')
    expect(displayName('ali bin ahmad')).toBe('Ali bin Ahmad')
    expect(displayName('omar al-hassan')).toBe('Omar al-Hassan')
    expect(displayName('AL-HASSAN OMAR')).toBe('Al-Hassan Omar')
    expect(displayName('de souza')).toBe('De Souza')
  })

  it('handles hyphens, apostrophes, Mc names and suffixes', () => {
    expect(displayName("sean o'brien")).toBe("Sean O'Brien")
    expect(displayName('JEAN-LUC PICARD')).toBe('Jean-Luc Picard')
    expect(displayName('ronald mcdonald')).toBe('Ronald McDonald')
    expect(displayName('john mack')).toBe('John Mack')
    expect(displayName('henry ford ii')).toBe('Henry Ford II')
    expect(displayName('SAMUEL JACKSON JR.')).toBe('Samuel Jackson Jr.')
  })

  it('leaves names without letters or too short alone', () => {
    expect(displayName('')).toBe('')
    expect(displayName(null)).toBe('')
    expect(displayName('X')).toBe('X')
    expect(displayName('123')).toBe('123')
  })

  it('suggests a fix only for ALL CAPS or all-lowercase names that change', () => {
    expect(nameCaseSuggestion('PLACEHOLDER MEMBER')).toBe('Placeholder Member')
    expect(nameCaseSuggestion('placeholder member')).toBe('Placeholder Member')
    expect(nameCaseSuggestion('Placeholder Member')).toBeNull()
    expect(nameCaseSuggestion('Placeholder mEMBER')).toBeNull()
    expect(nameCaseSuggestion('j')).toBeNull()
    expect(nameCaseSuggestion('')).toBeNull()
  })
})
