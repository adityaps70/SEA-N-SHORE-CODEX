/**
 * The sign-up password rules, the same as the Cognito user pool's password policy
 * (infra/aws/app/auth.tf: 12+ characters, a lowercase and an uppercase letter, a number;
 * no symbol required). Shared by the live checklist under the field and the server action.
 */
export type PasswordRuleId = 'length' | 'lowercase' | 'uppercase' | 'number'

export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 72

export const PASSWORD_RULES: ReadonlyArray<{ id: PasswordRuleId; label: string; test: (password: string) => boolean }> = [
  { id: 'length', label: `At least ${PASSWORD_MIN_LENGTH} characters`, test: (password) => password.length >= PASSWORD_MIN_LENGTH },
  { id: 'lowercase', label: 'A lowercase letter', test: (password) => /[a-z]/.test(password) },
  { id: 'uppercase', label: 'An uppercase letter', test: (password) => /[A-Z]/.test(password) },
  { id: 'number', label: 'A number', test: (password) => /[0-9]/.test(password) },
]

export function failedPasswordRules(password: string): PasswordRuleId[] {
  return PASSWORD_RULES.filter((rule) => !rule.test(password)).map((rule) => rule.id)
}

const NEEDS: Record<PasswordRuleId | 'symbol', string> = {
  length: `at least ${PASSWORD_MIN_LENGTH} characters`,
  lowercase: 'a lowercase letter',
  uppercase: 'an uppercase letter',
  number: 'a number',
  symbol: 'a symbol',
}

function joined(parts: string[]) {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** "Your password needs an uppercase letter and a number." — names exactly the rules that failed. */
export function passwordRulesMessage(failed: ReadonlyArray<PasswordRuleId | 'symbol'>): string {
  if (failed.length === 0) return `Choose a different password: at least ${PASSWORD_MIN_LENGTH} characters with a lowercase letter, an uppercase letter and a number.`
  return `Your password needs ${joined(failed.map((id) => NEEDS[id]))}.`
}

/** Cognito's InvalidPasswordException reason (see cognito-api passwordRuleReason) as a rule, or null. */
export function cognitoPasswordRule(reason: string | null): PasswordRuleId | 'symbol' | null {
  return reason && reason in NEEDS ? (reason as PasswordRuleId | 'symbol') : null
}
