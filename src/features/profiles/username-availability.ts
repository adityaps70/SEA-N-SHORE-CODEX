import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
import { generateAvailableUsername, normalizeUsername, usernameSchema } from './username'

type UsernameOwnerRow = QueryResultRow & { id: string; slug?: string | null }
type UsernameQuery = (text: string, values?: readonly unknown[]) => Promise<UsernameOwnerRow[]>

export type UsernameAvailability =
  | { username: string; available: boolean; current: boolean }
  | { username: string; available: false; current: false; valid: false; message: string }

export function createUsernameAvailabilityRepository(input: { query: UsernameQuery; random?: () => number }) {
  async function check(profileId: string, rawUsername: string): Promise<UsernameAvailability> {
    const parsed = usernameSchema.safeParse(rawUsername)
    if (!parsed.success) {
      return {
        username: normalizeUsername(rawUsername),
        available: false,
        current: false,
        valid: false,
        message: parsed.error.issues[0]?.message ?? 'Choose a valid username.',
      }
    }

    const username = parsed.data
    const rows = await input.query(
      `select id
       from public.profiles
       where slug = $1
       limit 1`,
      [username],
    )
    const owner = rows[0]
    const current = owner?.id === profileId

    return {
      username,
      available: !owner || current,
      current,
    }
  }

  /** Candidates owned by someone other than `profileId` (their own handle stays available to them). */
  async function findTaken(profileId: string, candidates: string[]): Promise<ReadonlySet<string>> {
    if (!candidates.length) return new Set()
    const rows = await input.query(
      `select id, slug
       from public.profiles
       where slug = any($1::text[])
         and id <> $2`,
      [candidates, profileId],
    )
    return new Set(rows.flatMap((row) => typeof row.slug === 'string' ? [row.slug] : []))
  }

  /** A rule-valid username nobody else owns, built from the member's name or email. */
  async function suggest(profileId: string, identity: { fullName?: string | null; email?: string | null }) {
    return generateAvailableUsername(
      identity,
      (candidates) => findTaken(profileId, candidates),
      input.random,
    )
  }

  return { check, findTaken, suggest }
}

const usernameAvailabilityRepository = createUsernameAvailabilityRepository({
  query: (text, values) => databaseQuery<UsernameOwnerRow>(text, values),
})

export const checkUsernameAvailabilityFromAurora = usernameAvailabilityRepository.check
export const suggestAvailableUsernameFromAurora = usernameAvailabilityRepository.suggest
