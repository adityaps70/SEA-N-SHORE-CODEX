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
  // Request cuts (owner-approved 18 Nov): community lists and pages, job and course detail pages and the learning
  // components linked from them prefetched every link in view; they now prefetch on intent too.
  'src/app/(app)/community/page.tsx',
  'src/app/(app)/community/[slug]/page.tsx',
  'src/features/community/components/group-card.tsx',
  'src/features/community/components/community-discover.tsx',
  'src/features/community/components/category-facet.tsx',
  'src/features/community/components/group-members-list.tsx',
  'src/app/(public)/jobs/[id]/page.tsx',
  'src/app/(public)/learn/courses/[slug]/page.tsx',
  'src/app/(app)/learn/courses/[slug]/learn/page.tsx',
  'src/features/learning/components/my-learning-home.tsx',
  'src/features/learning/components/course-action-bar.tsx',
  'src/features/learning/components/lesson-action-bar.tsx',
  'src/features/learning/components/page-actions-sheet.tsx',
  'src/features/learning/components/course-reviews-section.tsx',
  'src/features/learning/components/course-community-panel.tsx',
  'src/features/learning/components/course-purchase-panel.tsx',
  'src/features/learning/components/enroll-free-control.tsx',
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
