/**
 * Some of a member's Cognito users could not be changed. `failed` of `total` sign-ins; the
 * route says so, and repeating the action retries them (every step is idempotent).
 */
export class AdminSignInControlError extends Error {
  constructor(
    code: 'admin_user_cognito_suspend_incomplete' | 'admin_user_cognito_restore_incomplete' | 'admin_user_cognito_delete_incomplete',
    readonly failed: number,
    readonly total: number,
  ) {
    super(code)
    this.name = 'AdminSignInControlError'
  }
}
