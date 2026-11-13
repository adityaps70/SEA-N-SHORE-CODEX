import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Round CAP (finding 3, owner-approved 13 Nov): in the week to 13 Nov, viewport prefetch of these lists was the largest
 * source of signed-in page-data requests (conversation list 1,924, admin users 1,148, job pages 1,146, plus
 * notifications and search). Their links prefetch only on hover, focus or touch, like the feed, header and network.
 */
const BUSY_LINK_FILES = [
  'src/features/messaging/components/conversation-list.tsx',
  'src/features/messaging/components/message-shell.tsx',
  'src/features/messaging/components/message-thread.tsx',
  'src/features/messaging/components/messaging-dock.tsx',
  'src/features/messaging/components/new-message-dialog.tsx',
  'src/features/notifications/components/notification-list.tsx',
  'src/features/notifications/components/notification-visuals.tsx',
  'src/features/notifications/components/notification-bell.tsx',
  'src/app/(app)/search/page.tsx',
  'src/app/(app)/search/search-v2.tsx',
  'src/app/(app)/admin/users/[profileId]/page.tsx',
  'src/app/(app)/admin/users/page.tsx',
  'src/app/(app)/jobs/applications/page.tsx',
  'src/features/jobs/share/components/job-share-panel.tsx',
  'src/features/feed/components/shared-job-card.tsx',
]

describe('busy signed-in lists prefetch on intent only', () => {
  it.each(BUSY_LINK_FILES)('%s links through the intent-only link', (file) => {
    const source = readFileSync(file, 'utf8')
    expect(source).not.toMatch(/from ['"]next\/link['"]/)
    expect(source).toMatch(/import Link from '@\/components\/navigation\/intent-link'/)
    // An explicit prefetch would opt a link back into the viewport prefetch.
    expect(source).not.toMatch(/<Link\b[^>]*\bprefetch=/)
  })
})
