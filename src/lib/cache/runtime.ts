import * as database from '@/lib/db/client'
import { createCacheClearHub, type CacheClearTransport } from './cache-clear'

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
}

const disabledTransport: CacheClearTransport = {
  // Never connects, so the hub never becomes healthy and nothing is cached.
  listen: () => new Promise(() => undefined),
  notify: async () => undefined,
}

export const cacheClearHub = createCacheClearHub({ transport: enabled ? databaseTransport : disabledTransport })

if (enabled) database.setDatabaseWriteHook(() => cacheClearHub.writeBarrier())
