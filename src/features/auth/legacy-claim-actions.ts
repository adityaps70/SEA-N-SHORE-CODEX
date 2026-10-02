'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { cognitoCookieOptions } from '@/lib/auth/cognito-cookies'
import { getCognitoEnvironment, publicEnvironment } from '@/lib/env'
import { LEGACY_CLAIM_EMAIL_COOKIE } from './legacy-claim'

const LEGACY_CLAIM_MAX_AGE_SECONDS = 20 * 60
const emailSchema = z.string().trim().toLowerCase().email().max(254)

export async function prepareLegacyProfileClaim(formData: FormData): Promise<void> {
  const parsed = emailSchema.safeParse(formData.get('email'))
  if (!parsed.success) {
    redirect('/auth/claim-profile?error=email')
  }

  const environment = getCognitoEnvironment()
  const cookieStore = await cookies()
  cookieStore.set(LEGACY_CLAIM_EMAIL_COOKIE, parsed.data, {
    ...cognitoCookieOptions(publicEnvironment.NEXT_PUBLIC_SITE_URL, {
      allowInsecureHttp: environment.AWS_COGNITO_ALLOW_INSECURE_HTTP_COOKIES,
    }),
    maxAge: LEGACY_CLAIM_MAX_AGE_SECONDS,
  })

  redirect('/auth/sign-up?legacy=1')
}
