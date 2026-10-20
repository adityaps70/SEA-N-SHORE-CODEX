'use server'

import { redirect } from 'next/navigation'
import { safeAdminReturnPath } from '@/lib/auth/admin-mfa-paths'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { ADMIN_STEP_UP_MESSAGES, type AdminStepUpMethod } from './admin-step-up'
import { productionAdminStepUp } from './admin-step-up-runtime'

export type AdminStepUpState = { error?: string; field?: 'password' | 'code' }

/**
 * Hotfix P1: Settings › Two-step verification, for a platform administrator signed in with Google. Confirms it is
 * them (password plus authenticator code, or a backup code), then continues to the admin page they asked for.
 */
export async function adminStepUpAction(_state: AdminStepUpState, formData: FormData): Promise<AdminStepUpState> {
  const user = await requireAwsUser()
  const method: AdminStepUpMethod = formData.get('method') === 'backup_code' ? 'backup_code' : 'authenticator'
  let result: Awaited<ReturnType<ReturnType<typeof productionAdminStepUp>>>
  try {
    result = await productionAdminStepUp(user)({
      method,
      password: typeof formData.get('password') === 'string' ? String(formData.get('password')) : '',
      code: typeof formData.get('code') === 'string' ? String(formData.get('code')) : '',
    })
  } catch (error) {
    // Never the password or the code: only the error name.
    console.error('admin_step_up_failed', { name: error instanceof Error ? error.name : null })
    return { error: ADMIN_STEP_UP_MESSAGES.failed }
  }
  if (result.status === 'error') return { error: result.error, ...(result.field ? { field: result.field } : {}) }
  redirect(safeAdminReturnPath(typeof formData.get('next') === 'string' ? String(formData.get('next')) : null) ?? '/admin')
}
