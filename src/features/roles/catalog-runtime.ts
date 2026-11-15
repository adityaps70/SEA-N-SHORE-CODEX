import { query } from '@/lib/db/client'
import { createRoleCatalogLoader, ROLE_CATALOG_REFRESH_MS } from './catalog-server'
import { addedRoleEntries } from './taxonomy'

/** P6b: the production loader of the added ranks (one per server process). Server only. */
const loader = createRoleCatalogLoader({ query: (text, values) => query(text, values) as Promise<Array<Record<string, unknown>>> })
let timer: ReturnType<typeof setInterval> | null = null

/** The added ranks, loaded within the last 30 seconds (and kept fresh every 30 seconds from the first call). */
export async function ensureRoleCatalog() {
  if (!timer) {
    timer = setInterval(() => { void loader.ensure() }, ROLE_CATALOG_REFRESH_MS)
    timer.unref?.()
  }
  await loader.ensure()
}

/** After an administrator adds, hides or shows a rank on this server. */
export async function reloadRoleCatalog() {
  await loader.reload()
}

/** What a page passes to the browser (RoleCatalogSync): every added rank, hidden ones included. */
export async function addedRolesForPage() {
  await ensureRoleCatalog()
  return [...addedRoleEntries()]
}
