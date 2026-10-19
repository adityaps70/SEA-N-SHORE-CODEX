'use server'

import { cookies } from 'next/headers'
import { APP_HANDOFF_CONFIRM_COOKIE, normalizePairCode, parseHandoffCookie } from './app-handoff'
import { appHandoffService } from './app-handoff-runtime'

/** Round I (I3): the Safari side of the Home Screen app's Google sign-in (see app-handoff). */
export type AppHandoffConfirmState =
  | { status: 'idle' }
  | { status: 'ready' }
  | { status: 'error'; error: string }
  | { status: 'closed'; error: string }

const MESSAGES = {
  invalid: 'Enter the 6-digit code shown in the Sea N Shore app.',
  wrong: 'That code does not match the one in the app. Check the app and try again.',
  refused: 'Too many wrong codes, so this sign-in was stopped. Open the Sea N Shore app and start again, or sign in there with your email.',
  expired: 'This sign-in has expired. Open the Sea N Shore app and start again, or sign in there with your email.',
  unavailable: 'We could not finish this sign-in. Open the Sea N Shore app and try again, or sign in there with your email.',
} as const

export async function confirmAppHandoff(_previous: AppHandoffConfirmState, formData: FormData): Promise<AppHandoffConfirmState> {
  const code = normalizePairCode(formData.get('code'))
  if (!code) return { status: 'error', error: MESSAGES.invalid }

  const store = await cookies()
  const confirm = parseHandoffCookie(store.get(APP_HANDOFF_CONFIRM_COOKIE)?.value)
  if (!confirm) return { status: 'closed', error: MESSAGES.expired }

  let result: Awaited<ReturnType<ReturnType<typeof appHandoffService>['confirm']>>
  try {
    result = await appHandoffService().confirm({ id: confirm.id, confirmSecret: confirm.secret, code })
  } catch {
    return { status: 'error', error: MESSAGES.unavailable }
  }
  if (result === 'ready') {
    store.delete(APP_HANDOFF_CONFIRM_COOKIE)
    return { status: 'ready' }
  }
  if (result === 'wrong') return { status: 'error', error: MESSAGES.wrong }
  store.delete(APP_HANDOFF_CONFIRM_COOKIE)
  return { status: 'closed', error: result === 'refused' ? MESSAGES.refused : MESSAGES.expired }
}
