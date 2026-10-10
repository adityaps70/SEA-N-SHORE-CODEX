'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { plainFieldErrors, type PlainFieldErrors } from '@/lib/validation/plain-messages'
import { promoCodeRepository } from './promo-code-repository'
import { PROMO_CODE_FIELD_LABELS, promoCodeInputSchema, type PromoCodeInput } from './promo-codes'

type Result = { ok: true } | { ok: false; error: string; fieldErrors?: PlainFieldErrors }

function refresh() {
  revalidatePath('/learn/studio/promo-codes')
}

function mutationError(error: unknown) {
  if (error instanceof Error) {
    if (error.message === 'promo_course_forbidden') return 'You can make codes for courses you manage, or for all of your own courses once you are an approved trainer.'
    if (error.message === 'promo_code_taken') return 'You already have a code with this name. Choose another.'
    if (error.message === 'promo_code_not_found') return 'We could not find this code. Reload the page and try again.'
  }
  return 'We could not save the code. Please try again.'
}

/** Creates a promo code for one course the actor manages, or for all of their own courses (round C, C2). */
export async function createPromoCode(input: PromoCodeInput): Promise<Result> {
  const parsed = promoCodeInputSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: 'Please correct the highlighted fields.', fieldErrors: plainFieldErrors(parsed.error, PROMO_CODE_FIELD_LABELS) }
  }
  try {
    const user = await requireAwsUser()
    await promoCodeRepository.create(user.id, parsed.data)
    refresh()
    return { ok: true }
  } catch (error) {
    return { ok: false, error: mutationError(error) }
  }
}

/** Stops (or restarts) a code. Uses already redeemed are kept. */
export async function setPromoCodeDisabled(codeId: string, disabled: boolean): Promise<Result> {
  const parsed = z.string().uuid().safeParse(codeId)
  if (!parsed.success) return { ok: false, error: 'We could not find this code. Reload the page and try again.' }
  try {
    const user = await requireAwsUser()
    await promoCodeRepository.setDisabled(user.id, parsed.data, disabled === true)
    refresh()
    return { ok: true }
  } catch (error) {
    return { ok: false, error: mutationError(error) }
  }
}
