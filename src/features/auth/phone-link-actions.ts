'use server'

import { revalidatePath } from 'next/cache'
import { composePhoneNumber, type PhoneLinkState } from './phone-link'
import { runtimePhoneLinkService, signedInPhoneLinkMember } from './phone-link-runtime'

const SIGNED_OUT: PhoneLinkState = {
  status: 'error',
  step: 'request',
  error: 'Your session has expired. Sign in again to change your mobile number.',
}

function field(formData: FormData, name: string) {
  const value = formData.get(name)
  return typeof value === 'string' ? value : null
}

/** Sends a code to the number typed in Settings (country code + number). */
export async function requestPhoneLinkCode(_state: PhoneLinkState, formData: FormData): Promise<PhoneLinkState> {
  const member = await signedInPhoneLinkMember()
  if (!member) return SIGNED_OUT
  const phoneNumber = composePhoneNumber(field(formData, 'countryCode'), field(formData, 'phoneNumber'))
  return (await runtimePhoneLinkService()).requestCode(member, phoneNumber)
}

/** Checks the code; on success the number is verified and linked to this account. */
export async function confirmPhoneLinkCode(_state: PhoneLinkState, formData: FormData): Promise<PhoneLinkState> {
  const member = await signedInPhoneLinkMember()
  if (!member) return SIGNED_OUT
  const result = await (await runtimePhoneLinkService()).confirmCode(member, formData.get('code'))
  if (result.status === 'verified') revalidatePath('/settings')
  return result
}

export async function removeLinkedPhone(_state: PhoneLinkState, formData: FormData): Promise<PhoneLinkState> {
  const member = await signedInPhoneLinkMember()
  if (!member) return SIGNED_OUT
  const result = await (await runtimePhoneLinkService()).removePhone(member, formData.get('identityId'))
  if (result.status === 'removed') revalidatePath('/settings')
  return result
}

export async function cancelPhoneLink(): Promise<PhoneLinkState> {
  const member = await signedInPhoneLinkMember()
  if (!member) return SIGNED_OUT
  return (await runtimePhoneLinkService()).cancel()
}
