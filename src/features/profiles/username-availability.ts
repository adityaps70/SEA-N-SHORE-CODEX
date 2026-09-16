import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
import { normalizeUsername, usernameSchema } from './username'

type UsernameOwnerRow = QueryResultRow & { id: string }
type UsernameQuery = (text: string, values?: readonly unknown[]) => Promise<UsernameOwnerRow[]>

export type UsernameAvailability =
  | { username: string; available: boolean; current: boolean }
  | { username: string; available: false; current: false; valid: false; message: string }

export function createUsernameAvailabilityRepository(input: { query: UsernameQuery }) {
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

  return { check }
}

const usernameAvailabilityRepository = createUsernameAvailabilityRepository({
  query: (text, values) => databaseQuery<UsernameOwnerRow>(text, values),
})

export const checkUsernameAvailabilityFromAurora = usernameAvailabilityRepository.check
