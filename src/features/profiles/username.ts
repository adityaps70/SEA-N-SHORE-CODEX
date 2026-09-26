import { z } from 'zod'

/**
 * Single source of truth for Sea N Shore username rules. The onboarding form,
 * the profile editor, the live availability check, the server actions and the
 * automatic username generator all use these values, so a handle that one
 * surface accepts is never rejected by another.
 *
 * The database constraint (migration 0023) is intentionally looser
 * (1–80 characters, same character set) so older handles stay valid.
 */
export const USERNAME_MIN_LENGTH = 3
export const USERNAME_MAX_LENGTH = 30
export const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/
const REPEATED_SEPARATOR_PATTERN = /[._-]{2}/

export const USERNAME_RULES_HINT = `${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} characters. Use letters, numbers, dots, underscores, or hyphens.`

export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  'admin', 'administrator', 'api', 'app', 'auth', 'contact', 'events', 'help',
  'home', 'jobs', 'learn', 'login', 'messages', 'network', 'notifications',
  'privacy', 'profile', 'register', 'search', 'settings', 'signin', 'signup',
  'support', 'terms', 'verification', 'seanshore', 'sea-n-shore',
])

/** Trims, lowercases and drops a leading "@" people often type out of habit. */
export function normalizeUsername(value: string) {
  return value.trim().replace(/^@+/, '').trim().toLocaleLowerCase('en')
}

export function isReservedUsername(value: string) {
  return RESERVED_USERNAMES.has(normalizeUsername(value))
}

export const usernameSchema = z.preprocess(
  (value) => typeof value === 'string' ? normalizeUsername(value) : value,
  z
    .string()
    .min(USERNAME_MIN_LENGTH, `Choose a username with at least ${USERNAME_MIN_LENGTH} characters.`)
    .max(USERNAME_MAX_LENGTH, `Keep your username to ${USERNAME_MAX_LENGTH} characters or fewer.`)
    .regex(USERNAME_PATTERN, 'Use letters, numbers, dots, underscores, or hyphens; start and end with a letter or number.')
    .refine((value) => !REPEATED_SEPARATOR_PATTERN.test(value), 'Do not use consecutive dots, underscores, or hyphens.')
    .refine((value) => !RESERVED_USERNAMES.has(value), 'That username is reserved.'),
)

export function isValidUsername(value: string) {
  return usernameSchema.safeParse(value).success
}

// ---------------------------------------------------------------------------
// Automatic username generation
// ---------------------------------------------------------------------------

/** Honorifics, ranks and titles removed from the start of a name. */
const LEADING_TITLES = new Set([
  'capt', 'captain', 'cpt', 'dr', 'doctor', 'mr', 'mrs', 'ms', 'miss', 'mx', 'mstr',
  'prof', 'professor', 'sir', 'madam', 'dame', 'lady', 'lord', 'rev', 'fr', 'hon',
  'engr', 'eng', 'er', 'ch', 'chief', 'master', 'cdr', 'cmdr', 'commander', 'cmde',
  'commodore', 'lt', 'lieut', 'lieutenant', 'col', 'major', 'maj', 'gen', 'adm', 'admiral',
  'shri', 'sri', 'shrimati', 'smt', 'kumari', 'km', 'kum', 'ssgt', 'sgt',
  'officer', 'engineer', 'mate', 'cadet', 'c/e', 'c/o', '2/e', '2/o', '3/e', '3/o',
])

/** Suffixes and post-nominals removed from the end of a name. */
const TRAILING_SUFFIXES = new Set([
  'jr', 'jnr', 'sr', 'snr', 'ii', 'iii', 'iv', 'phd', 'md', 'mba', 'bsc', 'msc', 'esq',
  'mnm', 'mni', 'fics', 'rn', 'imo',
])

/** Letters that Unicode decomposition does not reduce to plain ASCII. */
const LETTER_REPLACEMENTS: Record<string, string> = {
  'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'đ': 'd', 'ð': 'd', 'ł': 'l', 'þ': 'th',
  'ı': 'i', 'ħ': 'h', 'ŧ': 't', 'ŋ': 'n', 'ſ': 's', 'ĸ': 'k',
}

const FALLBACK_USERNAME_BASE = 'member'

/** Lowercases, strips accents and maps non-ASCII Latin letters to ASCII. */
export function asciiFold(value: string) {
  return value
    .toLocaleLowerCase('en')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[ßæœøđðłþıħŧŋſĸ]/g, (letter) => LETTER_REPLACEMENTS[letter] ?? '')
}

function cleanSeparators(value: string) {
  return value
    .replace(/[._-]{2,}/g, (run) => run[0] ?? '.')
    .replace(/^[._-]+|[._-]+$/g, '')
}

/** Cuts a candidate to `maximum` characters without leaving a trailing separator. */
function fitLength(value: string, maximum: number) {
  return cleanSeparators(value.slice(0, maximum))
}

function nameTokens(fullName: string) {
  const raw = fullName
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
  const tokenKey = (token: string) => asciiFold(token).replace(/[.,]/g, '')

  let start = 0
  // Strip titles (and rank abbreviations like "C/E") only while a real name remains.
  while (start < raw.length - 1 && LEADING_TITLES.has(tokenKey(raw[start] ?? ''))) start += 1
  let end = raw.length
  while (end - 1 > start && TRAILING_SUFFIXES.has(tokenKey(raw[end - 1] ?? ''))) end -= 1

  return raw
    .slice(start, end)
    .map((token) => asciiFold(token).replace(/[^a-z0-9]+/g, ''))
    .filter(Boolean)
}

/** "Capt. Prakhar Pathak" → "prakhar.pathak". Returns '' when nothing usable remains. */
export function usernameBaseFromName(fullName: string) {
  // A name that is really an email address (Cognito falls back to it) is handled by the email rule.
  if (fullName.includes('@')) return ''
  // The placeholder name given to accounts created without a name is not a real name.
  if (asciiFold(fullName).replace(/\s+/g, ' ').trim() === 'sea n shore member') return ''
  const tokens = nameTokens(fullName)
  if (!tokens.length) return ''

  const joined = tokens.join('.')
  if (joined.length <= USERNAME_MAX_LENGTH) return joined

  const first = tokens[0] ?? ''
  const last = tokens[tokens.length - 1] ?? ''
  const firstAndLast = tokens.length > 1 ? `${first}.${last}` : first
  return fitLength(firstAndLast, USERNAME_MAX_LENGTH)
}

/** "Prakhar.Pathak+jobs@example.com" → "prakhar.pathak". */
export function usernameBaseFromEmail(email: string | null | undefined) {
  if (!email) return ''
  const localPart = email.trim().split('@')[0]?.split('+')[0] ?? ''
  const folded = asciiFold(localPart).replace(/[^a-z0-9._-]+/g, '.')
  return fitLength(cleanSeparators(folded), USERNAME_MAX_LENGTH)
}

/**
 * The preferred (not yet availability-checked) handle for a new member:
 * their name first, then their email, then a neutral fallback. The result
 * always satisfies `usernameSchema` except for being reserved, which the
 * suffix step in `usernameCandidates` resolves.
 */
export function preferredUsernameBase(input: { fullName?: string | null; email?: string | null }) {
  const fromName = usernameBaseFromName(input.fullName ?? '')
  if (fromName.length >= USERNAME_MIN_LENGTH) return fromName

  const fromEmail = usernameBaseFromEmail(input.email)
  if (fromEmail.length >= USERNAME_MIN_LENGTH) return fromEmail

  const shortest = fromName || fromEmail
  return shortest ? `${shortest}.${FALLBACK_USERNAME_BASE}` : FALLBACK_USERNAME_BASE
}

function withSuffix(base: string, suffix: string) {
  return `${fitLength(base, USERNAME_MAX_LENGTH - suffix.length)}${suffix}`
}

/**
 * Ordered handles to try: the clean base first (unless reserved), then the
 * base with short numeric suffixes. Every candidate is rule-valid.
 */
export function usernameCandidates(
  input: { fullName?: string | null; email?: string | null },
  random: () => number = Math.random,
) {
  const base = preferredUsernameBase(input)
  const seen = new Set<string>()
  const candidates: string[] = []
  const add = (candidate: string) => {
    if (seen.has(candidate) || !isValidUsername(candidate)) return
    seen.add(candidate)
    candidates.push(candidate)
  }

  add(base)
  for (const digits of [2, 2, 2, 3, 3, 3, 4, 4, 4, 4]) {
    const low = 10 ** (digits - 1)
    const value = low + Math.floor(random() * (9 * low))
    add(withSuffix(base, String(value)))
  }
  // Guaranteed-valid last resort, even if every name-based candidate is taken.
  add(withSuffix(FALLBACK_USERNAME_BASE, String(10_000_000 + Math.floor(random() * 89_999_999))))
  return candidates
}

export type TakenUsernameLookup = (candidates: string[]) => Promise<ReadonlySet<string>>

/**
 * Returns the first candidate that nobody else owns. `findTaken` receives the
 * whole candidate list at once so production needs a single database query.
 */
export async function generateAvailableUsername(
  input: { fullName?: string | null; email?: string | null },
  findTaken: TakenUsernameLookup,
  random: () => number = Math.random,
): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidates = usernameCandidates(input, random)
    const taken = await findTaken(candidates)
    const available = candidates.find((candidate) => !taken.has(candidate))
    if (available) return available
  }
  throw new Error('username_generation_exhausted')
}
