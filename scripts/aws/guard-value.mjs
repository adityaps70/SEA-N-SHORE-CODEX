// Guard files read "plan" or "discover" (read-only), or "<action> <40-hex SHA of the commit it arms>" for any run
// that changes AWS (enforced by scripts/aws/arm-commit-guard.sh). Returns the action, or null for anything else.
export function guardAction(text) {
  const readOnly = /^(plan|discover)\n*$/.exec(text)
  if (readOnly) return readOnly[1]
  const armed = /^([a-z][a-z0-9:-]*) ([0-9a-f]{40})\n*$/.exec(text)
  return armed && armed[1] !== 'plan' && armed[1] !== 'discover' ? armed[1] : null
}
