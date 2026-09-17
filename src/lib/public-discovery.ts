const syntheticDiscoveryPatterns = [
  /\be2e(?:[-_\s]|$)/i,
  /\bsynthetic(?:[-_\s]|$)/i,
  /\bfixture(?:[-_\s]|$)/i,
  /\bseed(?:ed)?(?:[-_\s]|$)/i,
  /\btest(?:[-_\s]+)(?:user|account|profile|course|mentor)\b/i,
  /@[^\s]+\.test\b/i,
  /@example\.(?:test|invalid)\b/i,
]

/**
 * Returns true only for text carrying an explicit synthetic/test-data marker.
 * The patterns are intentionally narrow so legitimate maritime profiles or
 * courses containing everyday words such as "demo" or "test" are not hidden.
 */
export function isSyntheticDiscoveryText(value: string | null | undefined): boolean {
  const text = value?.trim()
  if (!text) return false

  return syntheticDiscoveryPatterns.some((pattern) => pattern.test(text))
}
