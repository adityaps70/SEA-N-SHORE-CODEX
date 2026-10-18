/**
 * Round H (H3): "n***@example.com" — the first character of the local part, then ***, then the domain. Used in the
 * notice sent to the old address after an email change, so the notice never spells out the new address.
 */
export function maskEmail(email: string) {
  const value = email.trim().toLowerCase()
  const at = value.lastIndexOf('@')
  if (at < 1 || at === value.length - 1) return '***'
  return `${value[0]}***${value.slice(at)}`
}
