import type { NewsletterSubscriber } from './repository'

const COLUMNS: Array<[string, (row: NewsletterSubscriber) => string | null]> = [
  ['email', (row) => row.email],
  ['status', (row) => row.status],
  ['topics', (row) => row.topics.join(';')],
  ['source', (row) => row.source],
  ['consent_text_version', (row) => row.consentTextVersion],
  ['consented_at', (row) => row.consentedAt],
  ['confirmed_at', (row) => row.confirmedAt],
  ['unsubscribed_at', (row) => row.unsubscribedAt],
  ['ses_sync_status', (row) => row.sesSyncStatus],
  ['ses_synced_at', (row) => row.sesSyncedAt],
  ['linked_member', (row) => (row.profileId ? 'yes' : 'no')],
  ['created_at', (row) => row.createdAt],
  ['updated_at', (row) => row.updatedAt],
]

/** Quotes a CSV cell and neutralises spreadsheet formula injection. */
export function csvCell(value: string | null | undefined) {
  let text = value ?? ''
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) || text !== text.trim() ? `"${text.replaceAll('"', '""')}"` : text
}

export function subscribersToCsv(rows: NewsletterSubscriber[]) {
  const header = COLUMNS.map(([name]) => name).join(',')
  const lines = rows.map((row) => COLUMNS.map(([, read]) => csvCell(read(row))).join(','))
  return `﻿${[header, ...lines].join('\r\n')}\r\n`
}
