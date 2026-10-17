/** Leading honorifics and ranks that are not a first name ("Capt. Arjun Rao" → "Arjun"). */
const TITLES = new Set(['capt', 'cdr', 'cmdr', 'lt', 'dr', 'mr', 'mrs', 'ms', 'miss', 'prof', 'er', 'engr', 'c/e', 'c/o'])

function isTitle(token: string) {
  const bare = token.toLowerCase().replace(/\.+$/, '')
  return TITLES.has(bare)
}

/** The member's first name for short copy, skipping a leading title such as "Capt.". */
export function firstNameOf(fullName: string, fallback: string) {
  const tokens = fullName.trim().split(/\s+/).filter(Boolean)
  const first = tokens.find((token, index) => index === tokens.length - 1 || !isTitle(token))
  return first || fallback
}

/**
 * Round H (H7): smart capitalisation for names typed in ALL CAPS or all lowercase. What the member typed is
 * stored unchanged; pages show displayName(name). A name with mixed case is the member's choice and is kept.
 *
 * Rules, deliberately simple:
 * - each word, and each part after a hyphen or apostrophe, is capitalised ("o'brien" → "O'Brien", "jean-luc" → "Jean-Luc");
 * - particles stay lowercase after the first word: van, von, de, da, di, del, della, der, den, du, la, le, dos, das, do,
 *   bin, binti, bint, ibn, al, el, ter, ten ("ali bin ahmad" → "Ali bin Ahmad"); the prefixes al- and el- likewise
 *   ("al-hassan" → "al-Hassan" after the first word);
 * - initials are capitals with their full stops ("J. R. SMITH" → "J. R. Smith", "j.r." → "J.R.");
 * - roman numerals II to IX stay capitals; Jr and Sr read "Jr", "Sr";
 * - "Mc" names get a second capital ("mcdonald" → "McDonald"). "Mac" names do not (Mack, Macy and Machado would break).
 */
const PARTICLES = new Set(['van', 'von', 'de', 'da', 'di', 'del', 'della', 'der', 'den', 'du', 'la', 'le', 'dos', 'das', 'do', 'bin', 'binti', 'bint', 'ibn', 'al', 'el', 'ter', 'ten'])
const ROMAN = /^(?:ii|iii|iv|vi|vii|viii|ix)$/i

function hasLetters(value: string) {
  return /\p{L}/u.test(value)
}

/** Only ALL CAPS or all-lowercase names are changed. */
export function needsNameCaseFix(name: string) {
  const letters = name.replace(/[^\p{L}]/gu, '')
  if (letters.length < 2) return false
  return letters === letters.toUpperCase() || letters === letters.toLowerCase()
}

function capitalise(part: string) {
  if (!part) return part
  const lower = part.toLocaleLowerCase('en')
  if (/^mc\p{L}{2,}$/u.test(lower)) return `Mc${lower.charAt(2).toLocaleUpperCase('en')}${lower.slice(3)}`
  return lower.charAt(0).toLocaleUpperCase('en') + lower.slice(1)
}

function fixWord(word: string, first: boolean) {
  const lower = word.toLocaleLowerCase('en')
  // Initials: "j." or "j.r." (letters each followed by a full stop), or a single letter.
  if (/^(?:\p{L}\.)+$/u.test(word) || /^\p{L}$/u.test(word)) return word.toLocaleUpperCase('en')
  if (ROMAN.test(lower) && !first) return lower.toUpperCase()
  if (lower === 'jr' || lower === 'jr.' || lower === 'sr' || lower === 'sr.') return capitalise(lower)
  if (!first && PARTICLES.has(lower)) return lower
  const prefix = /^(al|el)-(.+)$/.exec(lower)
  if (prefix) return `${first ? capitalise(prefix[1]!) : prefix[1]}-${capitalise(prefix[2]!)}`
  return lower
    .split(/([-'’])/)
    .map((part) => (part === '-' || part === "'" || part === '’' ? part : capitalise(part)))
    .join('')
}

/** The name as pages show it: Title Case for ALL CAPS or all-lowercase input, otherwise as typed (spaces tidied). */
export function displayName(name: string | null | undefined) {
  const tidy = (name ?? '').replace(/\s+/g, ' ').trim()
  if (!tidy || !hasLetters(tidy) || !needsNameCaseFix(tidy)) return tidy
  return tidy.split(' ').map((word, index) => fixWord(word, index === 0)).join(' ')
}

/** "Did you mean …?" at signup and on the profile form: the fixed name, or null when nothing would change. */
export function nameCaseSuggestion(name: string | null | undefined) {
  const tidy = (name ?? '').replace(/\s+/g, ' ').trim()
  if (!needsNameCaseFix(tidy)) return null
  const fixed = displayName(tidy)
  return fixed && fixed !== tidy ? fixed : null
}
