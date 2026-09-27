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
