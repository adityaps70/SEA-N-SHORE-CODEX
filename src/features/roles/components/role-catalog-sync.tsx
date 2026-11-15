'use client'

import { setAddedRoles, type RoleEntry } from '../taxonomy'

let lastSignature: string | null = null

/**
 * P6b: hands the ranks administrators added to the browser's rank list before anything below renders, so pickers,
 * labels and job filters show them. It sits above the page in the root layout and renders nothing.
 */
export function RoleCatalogSync({ entries }: { entries: RoleEntry[] }) {
  const signature = JSON.stringify(entries)
  if (signature !== lastSignature) {
    lastSignature = signature
    setAddedRoles(entries)
  }
  return null
}
