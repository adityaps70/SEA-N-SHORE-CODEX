import { requireUser } from '@/features/auth/queries'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { mapPublicProfile } from './mappers'
import type { ContactVisibility, OwnProfile, OwnProfileRow, ProfileType, PublicProfile, PublicProfileRow } from './types'

const PUBLIC_PROFILE_SELECT = `
  id,
  slug,
  profile_type,
  full_name,
  avatar_path,
  location,
  headline,
  summary,
  maritime_profiles (
    rank,
    current_company,
    current_vessel,
    sailing_experience_years,
    vessel_types,
    trading_areas,
    shore_career_preference,
    availability
  ),
  profile_skills (skill)
` as const

const OWN_PROFILE_SELECT = `${PUBLIC_PROFILE_SELECT}, contact_visibility, onboarding_completed_at` as const

function isProfileType(value: unknown): value is ProfileType {
  return [
    'seafarer',
    'maritime_professional',
    'company',
    'trainer',
    'mentor',
    'recruiter',
    'service_provider',
  ].includes(String(value))
}

function isContactVisibility(value: unknown): value is ContactVisibility {
  return value === 'private' || value === 'members' || value === 'public'
}

function normalizeProfileRow(row: {
  id: string
  slug: string | null
  profile_type: string | null
  full_name: string
  avatar_path: string | null
  location: string | null
  headline: string | null
  summary: string | null
  maritime_profiles: PublicProfileRow['maritime_profiles'] | PublicProfileRow['maritime_profiles'][]
  profile_skills: Array<{ skill: string }>
}): PublicProfileRow | null {
  if (!row.slug || !isProfileType(row.profile_type)) return null
  const maritime = Array.isArray(row.maritime_profiles) ? row.maritime_profiles[0] ?? null : row.maritime_profiles

  return {
    id: row.id,
    slug: row.slug,
    profile_type: row.profile_type,
    full_name: row.full_name,
    avatar_path: row.avatar_path,
    location: row.location,
    headline: row.headline,
    summary: row.summary,
    maritime_profiles: maritime,
    profile_skills: row.profile_skills ?? [],
  }
}

function mapProfileRows(rows: unknown[]): PublicProfile[] {
  return rows.flatMap((row) => {
    const normalized = normalizeProfileRow(row as Parameters<typeof normalizeProfileRow>[0])
    return normalized ? [mapPublicProfile(normalized)] : []
  })
}

export async function getPublicProfileBySlug(slug: string): Promise<PublicProfile | null> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('profiles')
    .select(PUBLIC_PROFILE_SELECT)
    .eq('slug', slug)
    .eq('account_status', 'active')
    .not('onboarding_completed_at', 'is', null)
    .maybeSingle()

  if (error) throw new Error('Unable to load this professional profile.')
  if (!data) return null

  const normalized = normalizeProfileRow(data)
  return normalized ? mapPublicProfile(normalized) : null
}

export async function getOwnProfile(): Promise<OwnProfile | null> {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('profiles')
    .select(OWN_PROFILE_SELECT)
    .eq('id', user.id)
    .maybeSingle()

  if (error || !data) throw new Error('Unable to load your professional profile.')
  if (!data.onboarding_completed_at || !isContactVisibility(data.contact_visibility)) return null

  const normalized = normalizeProfileRow(data)
  if (!normalized) return null

  const ownRow: OwnProfileRow = {
    ...normalized,
    contact_visibility: data.contact_visibility,
    onboarding_completed_at: data.onboarding_completed_at,
  }

  return {
    ...mapPublicProfile(ownRow),
    contactVisibility: ownRow.contact_visibility,
    onboardingCompletedAt: ownRow.onboarding_completed_at as string,
  }
}

export async function getNetworkProfiles(limit = 18): Promise<PublicProfile[]> {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('profiles')
    .select(PUBLIC_PROFILE_SELECT)
    .eq('account_status', 'active')
    .not('onboarding_completed_at', 'is', null)
    .neq('id', user.id)
    .order('updated_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(Math.min(Math.max(limit, 1), 60))

  if (error) throw new Error('Unable to load the professional network.')
  return mapProfileRows(data ?? [])
}

export async function getPublicProfilesByIds(ids: string[]): Promise<PublicProfile[]> {
  if (!ids.length) return []

  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('profiles')
    .select(PUBLIC_PROFILE_SELECT)
    .in('id', [...new Set(ids)])
    .eq('account_status', 'active')
    .not('onboarding_completed_at', 'is', null)

  if (error) throw new Error('Unable to load these professional profiles.')

  const profiles = mapProfileRows(data ?? [])
  const byId = new Map(profiles.map((profile) => [profile.id, profile]))
  return ids.flatMap((id) => {
    const profile = byId.get(id)
    return profile ? [profile] : []
  })
}
