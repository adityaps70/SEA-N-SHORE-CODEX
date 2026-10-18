import type { QueryResultRow } from 'pg'
import { getAwsVerifiedUser } from '@/features/auth/aws-queries'
import { isPhoneLoginEmail } from '@/features/auth/phone-login-email'
import { query as databaseQuery } from '@/lib/db/client'

/**
 * Round H (H7): the signed-in member sending a Contact page message, or null for a visitor. Their
 * profile name and verified account email prefill the form (they can change both), and the ticket is
 * linked to their profile. Mobile sign-in accounts carry a made-up address, which is never used.
 */
export type SupportViewer = { profileId: string; name: string; email: string }

type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

export async function loadSupportViewer(
  profileId: string,
  principalEmail: string | null,
  query: Query = (text, values) => databaseQuery<QueryResultRow>(text, values),
): Promise<SupportViewer> {
  const rows = await query(
    `select p.full_name,
            (select lower(a.email) from public.identity_accounts a
             where a.profile_id = p.id and a.email_verified = true and a.email is not null
             order by a.created_at asc, a.id asc limit 1) as verified_email
     from public.profiles p
     where p.id = $1`,
    [profileId],
  )
  const row = rows[0]
  const candidates = [row?.verified_email, principalEmail].map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
  const email = candidates.find((value) => value && !isPhoneLoginEmail(value)) ?? ''
  return { profileId, name: typeof row?.full_name === 'string' ? row.full_name.trim() : '', email }
}

export async function getSupportViewer(): Promise<SupportViewer | null> {
  const user = await getAwsVerifiedUser().catch(() => null)
  if (!user) return null
  try {
    return await loadSupportViewer(user.id, user.email)
  } catch {
    return { profileId: user.id, name: '', email: user.email && !isPhoneLoginEmail(user.email) ? user.email.toLowerCase() : '' }
  }
}
