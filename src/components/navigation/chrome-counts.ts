import { cache } from 'react'
import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
import { messagingRepository, UNREAD_MESSAGE_COUNT_SQL } from '@/features/messaging/repository'
import { INCOMING_REQUEST_COUNT_SQL, networkRepository } from '@/features/network/repository'
import { countUnreadNotificationsFromAurora, UNREAD_NOTIFICATION_COUNT_SQL } from '@/features/notifications/repository'

export type ChromeCounts = {
  notificationUnreadCount: number
  messagingUnreadCount: number
  pendingConnectionRequestCount: number
}

type CountsRow = QueryResultRow & { notifications?: number | string; messages?: number | string; requests?: number | string }
type CountsQuery = (text: string, values: readonly unknown[]) => Promise<readonly CountsRow[]>

/**
 * Round DB: the three header badges (Notifications, Messages, Network) in one statement. Each count is the exact SQL
 * its own repository runs (shared constants, so they cannot drift), as a scalar subquery for the same member ($1).
 */
export const CHROME_COUNTS_SQL = `select
  (${UNREAD_NOTIFICATION_COUNT_SQL})::int as notifications,
  (${UNREAD_MESSAGE_COUNT_SQL})::int as messages,
  (${INCOMING_REQUEST_COUNT_SQL})::int as requests`

type SeparateCounts = {
  countUnreadNotifications: (profileId: string) => Promise<number>
  countUnreadMessages: (profileId: string) => Promise<number>
  countIncomingRequests: (profileId: string) => Promise<number>
}

export function createChromeCounts(input: { query?: CountsQuery; separate?: SeparateCounts } = {}) {
  const queryRows: CountsQuery = input.query ?? ((text, values) => databaseQuery<CountsRow>(text, values))
  const separate: SeparateCounts = input.separate ?? {
    countUnreadNotifications: countUnreadNotificationsFromAurora,
    countUnreadMessages: messagingRepository.countUnreadMessages,
    countIncomingRequests: networkRepository.countIncomingRequests,
  }

  return async function loadChromeCounts(profileId: string): Promise<ChromeCounts> {
    try {
      const row = (await queryRows(CHROME_COUNTS_SQL, [profileId]))[0]
      return {
        notificationUnreadCount: Number(row?.notifications ?? 0),
        messagingUnreadCount: Number(row?.messages ?? 0),
        pendingConnectionRequestCount: Number(row?.requests ?? 0),
      }
    } catch {
      // The original three reads, with the original failure rules: the Network badge falls back to 0, and a failed
      // Notifications or Messages count fails the chrome as it did before (callers fall back to plain chrome).
      const [notificationUnreadCount, messagingUnreadCount, pendingConnectionRequestCount] = await Promise.all([
        separate.countUnreadNotifications(profileId),
        separate.countUnreadMessages(profileId),
        separate.countIncomingRequests(profileId).catch(() => 0),
      ])
      return { notificationUnreadCount, messagingUnreadCount, pendingConnectionRequestCount }
    }
  }
}

/**
 * Once per server render for a member: the chrome (app-chrome-data.ts) and the jobs layout's messaging dock share
 * it. React's cache() only shares within one render; actions and route handlers always read fresh.
 */
export const getChromeCountsForRequest = cache(createChromeCounts())
