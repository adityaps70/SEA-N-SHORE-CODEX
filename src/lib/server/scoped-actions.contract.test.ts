import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Round CAP (server actions, owner-approved 13 Nov): the actions that resolved the member more than once per call
 * (or read the access context twice) run their body inside actionScope(), so auth and access are read once.
 */
const SCOPED = {
  'src/features/feed/actions.ts': ['loadFeedPage', 'loadTopFeedPage', 'loadRecentFeedPage', 'countNewTopPosts', 'loadAllPostComments', 'updatePost', 'addComment', 'updateComment', 'deleteComment'],
  'src/features/notifications/actions.ts': ['loadNotificationChrome', 'loadNotifications'],
  'src/features/feed/organization-post-actions.ts': ['loadPostingOrganizations', 'loadOrganizationPostsTab'],
  'src/features/feed/share-actions.ts': ['searchShareRecipients', 'sendPostToConnection'],
  'src/features/profiles/profile-inline-actions.ts': ['updateProfileIdentitySection', 'updateProfileGoalsSection', 'updateProfileCurrentOrganization', 'updateProfileAboutSection', 'updateProfileProfessionalSection', 'updateProfileRoleSection'],
  'src/features/profiles/profile-portfolio-actions.ts': ['createProfileExperience', 'updateProfileExperience', 'deleteProfileExperience', 'createProfileCredential', 'updateProfileCredential', 'deleteProfileCredential'],
  'src/features/profiles/actions.ts': ['updateProfile'],
} as const

describe('busy Server Actions run in one action scope', () => {
  for (const [file, names] of Object.entries(SCOPED)) {
    it.each(names)(`${file}: %s`, (name) => {
      const source = readFileSync(file, 'utf8')
      expect(source).toMatch(/import \{ actionScope \} from '@\/lib\/server\/action-scope'/)
      // The body (after the signature, which may span lines) opens with the scope.
      const start = source.indexOf(`export async function ${name}(`)
      expect(start).toBeGreaterThanOrEqual(0)
      const next = source.indexOf('\nexport ', start + 1)
      const fn = source.slice(start, next === -1 ? undefined : next)
      expect(fn).toMatch(/\{\n  \/\/ Round CAP: one auth and access read per call\.\n  return actionScope\(async \(\) => \{/)
    })
  }
})
