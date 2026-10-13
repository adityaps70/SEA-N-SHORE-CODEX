// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Round 15: every server action that acts with platform-administrator authority is gated on the
 * same admin MFA rule as the admin pages (Round 14, 2.11). A gate is one of:
 * - `adminActionMfaMissing(...)` before the repository call (role checked in the repository),
 * - `requirePlatformAdministratorUser()` (role + `enforcePlatformAdminMfa`), directly or through a
 *   local wrapper,
 * - `canUsePlatformAdminAuthority(...)` where admin authority is one branch of a member action.
 */

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')

const GATE = /\b(adminActionMfaMissing|requirePlatformAdministratorUser|canUsePlatformAdminAuthority)\s*\(/

/** Server action modules with platform-admin actions, and the exports that must be gated. */
const ADMIN_ACTION_MODULES: Array<[path: string, exports: string[]]> = [
  ['src/features/admin/actions.ts', ['reviewCompanyAccessRequest', 'reviewOrganizationApplication', 'moderateContent']],
  ['src/features/admin/membership-actions.ts', ['grantAdminEntitlement', 'revokeAdminEntitlement']],
  ['src/features/learning/admin-actions.ts', ['reviewMentorApplication', 'reviewCourse']],
  ['src/features/verifications/actions.ts', ['reviewCreatorVerificationApplication']],
  ['src/features/organizations/access-request-actions.ts', ['decideOrganizationAccessRequest']],
  ['src/features/billing/admin-actions.ts', ['updatePlanPriceAction', 'adminCancelSubscriptionAction', 'adminExtendTrialAction', 'adminEndTrialAction']],
  ['src/features/community/admin-actions.ts', ['createGroupAsAdmin', 'updateGroupAsAdmin', 'setGroupOwnerAsAdmin', 'archiveGroupAsAdmin', 'unarchiveGroupAsAdmin']],
  ['src/features/legacy-invites/admin-actions.ts', ['prepareLegacyInviteBatch', 'startPreparedLegacyInvites', 'cancelPreparedLegacyInvites', 'stopUnsentLegacyInvites', 'prepareLegacyReminderBatch', 'startPreparedLegacyReminders', 'cancelPreparedLegacyReminders', 'stopUnsentLegacyReminders', 'sendLegacyReminderTest']],
  ['src/features/newsletter/admin-actions.ts', ['adminUnsubscribeSubscriber', 'queueNewsletterCampaign']],
  ['src/features/payouts/admin-actions.ts', ['updateFeeSettingsAction', 'setFeeOverrideAction', 'removeFeeOverrideAction', 'searchSellersAction', 'sendPayoutAction', 'refreshPayoutStatusAction', 'retryPayoutAction', 'cancelPayoutAction']],
  // C4: admin review of course sellers' monthly invoices.
  ['src/features/payouts/seller-invoice-admin-actions.ts', ['approveSellerInvoiceAction', 'rejectSellerInvoiceAction']],
  ['src/features/learning/course-payment-actions.ts', ['refundCoursePaymentAction']],
  ['src/features/payments/event-payment-actions.ts', ['refundEventPaymentAction']],
  ['src/features/learning/enrollment-actions.ts', ['openCourseAsTeamMember']],
  // Learning round B: an administrator may open a trainer's question bank (admin authority is one branch).
  ['src/features/learning/question-bank-actions.ts', ['saveBankQuestion', 'deleteBankQuestion', 'importBankQuestionsCsv', 'listBankQuestionsForQuiz']],
  // C4: GST LUT and TDS settings (admin only).
  ['src/features/tax/admin-actions.ts', ['updateTdsSettingsAction', 'saveLutAction']],
  // Learning round C (C1): an administrator may manage any course's roster (admin authority is one branch).
  ['src/features/learning/course-roster-actions.ts', ['enrolLearnerByEmail', 'cancelCourseInvitation']],
  // Learning round D (D1): an administrator may run any course's batches (admin authority is one branch).
  ['src/features/learning/batches/batch-actions.ts', ['saveBatchSettingsAction', 'createBatchAction', 'updateBatchAction', 'setBatchManagerAction', 'addBatchInstructorAction', 'removeBatchInstructorAction', 'moveLearnerToBatchAction']],
  // Learning round D (D2): an administrator may run any batch's sessions, attendance and recordings.
  ['src/features/learning/sessions/session-actions.ts', ['createSessionAction', 'createSessionSeriesAction', 'updateSessionAction', 'cancelSessionAction', 'markAttendanceAction', 'attachRecordingLinkAction', 'startRecordingUploadAction', 'saveUploadedRecordingAction', 'removeRecordingAction']],
  // Algorithms round G: Admin › Ranking switches.
  ['src/features/ranking/admin-actions.ts', ['setRankingModeAction', 'sendTestJobAlertAction', 'sendTestDigestAction']],
]

/** Bodies of the top-level functions in a module, by name. */
function functionBodies(source: string) {
  const bodies = new Map<string, string>()
  const starts = [...source.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/gm)]
  starts.forEach((match, index) => {
    const end = index + 1 < starts.length ? starts[index + 1]!.index : source.length
    bodies.set(match[1]!, source.slice(match.index, end))
  })
  return bodies
}

/** True when the function gates directly, or calls a local function that does. */
function gates(name: string, bodies: Map<string, string>, seen = new Set<string>()): boolean {
  const body = bodies.get(name)
  if (!body || seen.has(name)) return false
  seen.add(name)
  if (GATE.test(body)) return true
  const inner = body.slice(body.indexOf('{'))
  return [...bodies.keys()].some((other) => other !== name && new RegExp(`\\b${other}\\s*\\(`).test(inner) && gates(other, bodies, seen))
}

function serverActionFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return serverActionFiles(path)
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) return []
    return /^['"]use server['"]/m.test(readFileSync(path, 'utf8')) ? [relative(root, path)] : []
  })
}

describe('platform-admin server actions are MFA-gated (Round 15)', () => {
  it.each(ADMIN_ACTION_MODULES.flatMap(([path, names]) => names.map((name) => [path, name] as const)))(
    '%s › %s calls the admin MFA gate',
    (path, name) => {
      const source = read(path)
      expect(source).toMatch(new RegExp(`export async function ${name}\\(`))
      expect(gates(name, functionBodies(source))).toBe(true)
    },
  )

  it('lists every exported action of the admin-only modules', () => {
    const adminOnly = ADMIN_ACTION_MODULES.filter(([path]) => /(^src\/features\/admin\/|admin-actions\.ts$)/.test(path))
    expect(adminOnly.length).toBe(11)
    for (const [path, names] of adminOnly) {
      const exported = [...read(path).matchAll(/^export async function (\w+)\(/gm)].map((match) => match[1])
      expect(exported.sort(), path).toEqual([...names].sort())
    }
  })

  it('gates community image changes made with platform-admin authority', () => {
    const source = read('src/features/community/media-actions.ts')
    expect(source).toMatch(/canUsePlatformAdminAuthority\(userId\)/)
    expect(source).not.toMatch(/canAccessPlatformAdmin/)
    expect(read('src/features/community/service.ts')).toMatch(/import \{ canUsePlatformAdminAuthority as canAccessPlatformAdminDefault \} from '@\/features\/admin\/mfa-gate'/)
  })

  it('finds no other server action that uses platform-admin authority without being listed here', () => {
    const listed = new Set(ADMIN_ACTION_MODULES.map(([path]) => path))
    const adminAuthority = /\b(adminRepository|adminMembershipRepository|learningAdminRepository|canAccessPlatformAdmin|requirePlatformAdministratorUser|canUsePlatformAdminAuthority)\b/
    // course-payment-actions also reads canAccessPlatformAdmin to tell team members not to buy (no authority).
    const unlisted = serverActionFiles(join(root, 'src'))
      .filter((path) => !listed.has(path))
      .filter((path) => adminAuthority.test(read(path)))
      // media-actions is covered above; mfa-actions is where administrators set the app up.
      .filter((path) => path !== 'src/features/community/media-actions.ts' && path !== 'src/features/auth/mfa-actions.ts')
    expect(unlisted).toEqual([])
  })
})
