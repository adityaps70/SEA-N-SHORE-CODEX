import { describe, expect, it, vi } from 'vitest'
import {
  generateAvailableUsername,
  isValidUsername,
  preferredUsernameBase,
  RESERVED_USERNAMES,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  usernameBaseFromEmail,
  usernameBaseFromName,
  usernameCandidates,
} from './username'
import { createUsernameAvailabilityRepository } from './username-availability'

const fixedRandom = () => 0.5

describe('username normalisation', () => {
  it('accepts a handle typed with a leading @ the same way on client and server', () => {
    expect(isValidUsername('@Capt.Saurabh')).toBe(true)
    expect(isValidUsername('capt..saurabh')).toBe(false)
  })
})

describe('username generation from a name', () => {
  it.each([
    ['Prakhar Pathak', 'prakhar.pathak'],
    ['Capt. Saurabh Sharma', 'saurabh.sharma'],
    ['Captain Saurabh', 'saurabh'],
    ['Dr. Anita Rao', 'anita.rao'],
    ['Mr Rahul Verma Jr.', 'rahul.verma'],
    ['C/E Vikram Singh', 'vikram.singh'],
    ['Chief Officer Anil Kumar', 'anil.kumar'],
    ['  prakhar   PATHAK  ', 'prakhar.pathak'],
  ])('strips titles and punctuation: %s → %s', (name, expected) => {
    expect(usernameBaseFromName(name)).toBe(expected)
  })

  it('keeps the name when the only word looks like a title', () => {
    expect(usernameBaseFromName('Captain')).toBe('captain')
  })

  it('folds accents and non-ASCII Latin letters to plain letters', () => {
    expect(usernameBaseFromName('José Müller')).toBe('jose.muller')
    expect(usernameBaseFromName('Łukasz Øvergård')).toBe('lukasz.overgard')
    expect(usernameBaseFromName('Straße Æsir')).toBe('strasse.aesir')
  })

  it('removes apostrophes, hyphens and dots inside names instead of producing invalid runs', () => {
    expect(usernameBaseFromName("Sean O'Brien-Smith")).toBe('sean.obriensmith')
    expect(usernameBaseFromName('A.K. Menon')).toBe('ak.menon')
  })

  it('returns nothing usable for names in non-Latin scripts, email-like names or the placeholder name', () => {
    expect(usernameBaseFromName('प्रखर पाठक')).toBe('')
    expect(usernameBaseFromName('prakhar@example.com')).toBe('')
    expect(usernameBaseFromName('Sea N Shore Member')).toBe('')
  })

  it('keeps long names within the maximum length using first and last names', () => {
    const base = usernameBaseFromName('Venkataraghavan Subramaniam Ramachandran Iyer')
    expect(base).toBe('venkataraghavan.iyer')
    const single = usernameBaseFromName('Abcdefghijklmnopqrstuvwxyzabcdefghij')
    expect(single.length).toBe(USERNAME_MAX_LENGTH)
    expect(isValidUsername(single)).toBe(true)
  })
})

describe('username generation fallbacks', () => {
  it('uses the email local part without plus tags when the name is unusable', () => {
    expect(usernameBaseFromEmail('Prakhar.Pathak+jobs@example.com')).toBe('prakhar.pathak')
    expect(usernameBaseFromEmail('first..last__@example.com')).toBe('first.last')
    expect(preferredUsernameBase({ fullName: 'प्रखर', email: 'prakhar.p@example.com' })).toBe('prakhar.p')
  })

  it('pads names that are too short and falls back to a neutral handle with no name or email', () => {
    expect(preferredUsernameBase({ fullName: 'Al', email: null })).toBe('al.member')
    expect(preferredUsernameBase({ fullName: 'Al', email: 'albert@example.com' })).toBe('albert')
    expect(preferredUsernameBase({ fullName: '', email: '' })).toBe('member')
  })

  it('never offers a reserved handle as-is', () => {
    const candidates = usernameCandidates({ fullName: 'Admin' }, fixedRandom)
    expect(candidates).not.toContain('admin')
    expect(candidates[0]).toMatch(/^admin\d{2}$/)
    for (const candidate of candidates) expect(RESERVED_USERNAMES.has(candidate)).toBe(false)
  })

  it('produces only rule-valid candidates within the length limits', () => {
    const inputs = [
      { fullName: 'Capt. Saurabh', email: 'capt.saurabh@example.com' },
      { fullName: 'Abcdefghijklmnopqrstuvwxyzabcdefghij', email: null },
      { fullName: '', email: '---@example.com' },
      { fullName: 'Ø', email: null },
    ]
    for (const input of inputs) {
      for (const candidate of usernameCandidates(input)) {
        expect(isValidUsername(candidate)).toBe(true)
        expect(candidate.length).toBeGreaterThanOrEqual(USERNAME_MIN_LENGTH)
        expect(candidate.length).toBeLessThanOrEqual(USERNAME_MAX_LENGTH)
      }
    }
  })
})

describe('available username selection', () => {
  it('uses the clean base when nobody owns it', async () => {
    const findTaken = vi.fn(async () => new Set<string>())
    await expect(generateAvailableUsername({ fullName: 'Prakhar Pathak' }, findTaken, fixedRandom)).resolves.toBe('prakhar.pathak')
    expect(findTaken).toHaveBeenCalledTimes(1)
  })

  it('adds a short numeric suffix when the base is taken', async () => {
    const findTaken = vi.fn(async () => new Set(['prakhar.pathak']))
    const username = await generateAvailableUsername({ fullName: 'Prakhar Pathak' }, findTaken, fixedRandom)
    expect(username).toMatch(/^prakhar\.pathak\d{2}$/)
  })

  it('keeps suffixed long handles within the maximum length', async () => {
    const name = 'Abcdefghijklmnopqrstuvwxyzabcdefghij'
    const base = usernameBaseFromName(name)
    const username = await generateAvailableUsername({ fullName: name }, async () => new Set([base]), fixedRandom)
    expect(username.length).toBeLessThanOrEqual(USERNAME_MAX_LENGTH)
    expect(isValidUsername(username)).toBe(true)
  })

  it('checks every candidate in one database query and treats the member’s own handle as available', async () => {
    const query = vi.fn(async (_text: string, values?: readonly unknown[]) => {
      const candidates = values?.[0] as string[]
      return candidates.slice(0, 3).map((slug) => ({ id: 'someone-else', slug }))
    })
    const repository = createUsernameAvailabilityRepository({ query, random: fixedRandom })

    const username = await repository.suggest('11111111-1111-4111-8111-111111111111', { fullName: 'Capt. Saurabh', email: null })

    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0]?.[0]).toContain('slug = any($1::text[])')
    expect(query.mock.calls[0]?.[0]).toContain('id <> $2')
    const candidates = query.mock.calls[0]?.[1]?.[0] as string[]
    expect(username).toBe(candidates[3])
    expect(username.startsWith('saurabh')).toBe(true)
  })
})
