import * as database from '@/lib/db/client'
import { createCacheClearHub, type CacheClearTransport } from './cache-clear'

/** Migration 0111's triggers. All must exist and be enabled before anything is cached. */
export const CACHE_CLEAR_TRIGGERS = [
  'profiles_cache_clear', 'maritime_profiles_cache_clear', 'profile_skills_cache_clear', 'companies_cache_clear',
  'identity_accounts_cache_clear', 'notifications_cache_clear', 'conversation_participants_cache_clear',
  'messages_cache_clear', 'connections_cache_clear', 'auth_sessions_cache_clear',
]

/**
 * The one cache-clear hub of this server process. It listens only in the Node.js server runtime of a running app (not
 * during the build, in tests, or when CACHE_CLEAR=off); anywhere else it never becomes healthy, so every cache below
 * simply loads each time, exactly as before this change.
 */
const enabled = process.env.NEXT_RUNTIME === 'nodejs'
  && process.env.NEXT_PHASE !== 'phase-production-build'
  && !process.env.VITEST
  && process.env.CACHE_CLEAR !== 'off'

const databaseTransport: CacheClearTransport = {
  // Read from the module only when used, so tests that mock the database client never touch these.
  listen: (channel, onMessage, onLost) => database.listenForNotifications(channel, onMessage, onLost),
  notify: async (channel, payload) => { await database.query('select pg_notify($1, $2)', [channel, payload]) },
  clearsInstalled: async () => {
    const rows = await database.query<{ n: number }>(
      `select count(*)::int as n from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace ns on ns.oid = c.relnamespace
       where ns.nspname = 'public' and not t.tgisinternal and t.tgenabled <> 'D' and t.tgname = any($1::text[])`,
      [CACHE_CLEAR_TRIGGERS],
    )
    return Number(rows[0]?.n ?? 0) === CACHE_CLEAR_TRIGGERS.length
  },
}

const disabledTransport: CacheClearTransport = {
  // Never connects, so the hub never becomes healthy and nothing is cached.
  listen: () => new Promise(() => undefined),
  notify: async () => undefined,
  clearsInstalled: async () => false,
}

export const cacheClearHub = createCacheClearHub({ transport: enabled ? databaseTransport : disabledTransport })

if (enabled) database.setDatabaseWriteHook(() => cacheClearHub.writeBarrier())
