import { legacyFinalReminderTestEmail } from './final-reminder-email'
import { legacyLiveCounts, NO_LIVE_COUNTS, type LegacyLiveCounts } from './live-counts'
import { createLegacyReminderTestSender, type LegacyTestVariant } from './reminder-test'

/** Resend tag on final-reminder test sends. The webhook never puts their recipient on the do-not-email list. */
export const LEGACY_FINAL_REMINDER_TEST_CATEGORY = 'legacy_profile_final_reminder_test'

export const LEGACY_FINAL_REMINDER_TEST_AUDIT = {
  requested: 'legacy_final_reminder.test_requested',
  sent: 'legacy_final_reminder.test_sent',
  failed: 'legacy_final_reminder.test_failed',
  refused: 'legacy_final_reminder.test_refused',
} as const

export function legacyFinalReminderTestVariant(counts: { read(): Promise<LegacyLiveCounts> } = legacyLiveCounts): LegacyTestVariant {
  return {
    audit: LEGACY_FINAL_REMINDER_TEST_AUDIT,
    category: LEGACY_FINAL_REMINDER_TEST_CATEGORY,
    targetType: 'legacy_final_reminder_test',
    keyPrefix: 'legacy-profile-final-reminder-test',
    lockPrefix: 'legacy-final-reminder-test',
    render: async (siteUrl) => legacyFinalReminderTestEmail({ siteUrl, counts: await counts.read().catch(() => NO_LIVE_COUNTS) }),
  }
}

/**
 * "Send test to me" for the final reminder: the exact final reminder (live counts, sample person, "[TEST] " subject,
 * links that change nothing) to the signed-in admin's own verified sign-in email only, at most 5 an hour, every
 * request audited. It never touches the reminder tables, so it changes no one's eligibility, the queue or the rates.
 */
export const legacyFinalReminderTestSender = createLegacyReminderTestSender({ variant: legacyFinalReminderTestVariant() })
