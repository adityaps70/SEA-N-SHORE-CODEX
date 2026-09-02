'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { publicEnvironment } from '@/lib/env'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { resetPasswordSchema, signInSchema, signUpSchema } from './schemas'

export type AuthActionState = { error?: string; message?: string }

const existingAccountErrorCodes = new Set(['email_exists', 'user_already_exists', 'identity_already_exists'])
const signupSuccessState = { message: 'Check your email to continue.' }

export async function signUp(_: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check your details.' }

  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${publicEnvironment.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/onboarding`,
    },
  })

  if (!error || existingAccountErrorCodes.has(error.code ?? '')) return signupSuccessState
  return { error: 'We could not create your account. Please try again.' }
}

export async function signIn(_: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: 'Enter a valid email and password.' }

  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data)
  if (error) return { error: 'Email or password is incorrect.' }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('onboarding_completed_at')
    .eq('id', data.user.id)
    .maybeSingle()

  if (profileError) return { error: 'We could not finish signing you in. Please try again.' }
  redirect(profile?.onboarding_completed_at ? '/home' : '/onboarding')
}

export async function signInWithGoogle() {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${publicEnvironment.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/onboarding` },
  })
  if (error || !data.url) redirect('/auth/sign-in?error=oauth')
  redirect(data.url)
}

export async function requestPasswordReset(_: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const parsed = resetPasswordSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: 'Enter a valid email address.' }

  const supabase = await createServerSupabaseClient()
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${publicEnvironment.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/auth/update-password`,
  })
  return { message: 'If the account exists, a reset link is on its way.' }
}

export async function updatePassword(_: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const password = formData.get('password')
  const passwordConfirmation = formData.get('passwordConfirmation')
  const parsed = z.string().min(12).max(72).safeParse(password)
  if (!parsed.success) return { error: 'Use at least 12 characters.' }
  if (password !== passwordConfirmation) return { error: 'Passwords do not match.' }

  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.auth.updateUser({ password: parsed.data })
  if (error) return { error: 'The password could not be updated. Request a new reset link.' }
  redirect('/home')
}

export async function signOut() {
  const supabase = await createServerSupabaseClient()
  await supabase.auth.signOut()
  redirect('/')
}
