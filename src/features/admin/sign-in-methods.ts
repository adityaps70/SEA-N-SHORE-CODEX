import type { AdminSignInKind, AdminUserSummary } from './repository'

const KIND_LABELS: Record<AdminSignInKind, string> = {
  email: 'Email',
  google: 'Google',
  phone: 'Mobile',
}

/**
 * "3 sign-in methods: Email, Google" for a member with more than one Cognito user, so the one
 * row they have in Admin → Users says how many ways they can sign in. Null for a single sign-in.
 */
export function signInMethodsLabel(user: Pick<AdminUserSummary, 'loginMethods' | 'loginKinds'>): string | null {
  if (!user.loginMethods || user.loginMethods < 2) return null
  const kinds = user.loginKinds.map((kind) => KIND_LABELS[kind]).join(', ')
  return `${user.loginMethods} sign-in methods${kinds ? `: ${kinds}` : ''}`
}
