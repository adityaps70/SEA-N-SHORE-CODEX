export const MODERATION_TARGET_TYPES = ['post', 'comment', 'job', 'event', 'profile'] as const
export type ModerationTargetType = (typeof MODERATION_TARGET_TYPES)[number]

export const MODERATION_REPORT_STATUSES = ['open', 'reviewing', 'resolved', 'dismissed'] as const
export type ModerationReportStatus = (typeof MODERATION_REPORT_STATUSES)[number]

export const GENERAL_REPORT_REASONS = [
  'spam',
  'scam',
  'misinformation',
  'harassment',
  'hate_or_abuse',
  'unsafe_or_illegal',
  'inappropriate_content',
  'copyright_infringement',
  'other',
] as const

export const JOB_REPORT_REASONS = [
  'recruitment_fee',
  'fake_company',
  'misleading_salary',
  'false_vacancy',
  'suspicious_communication',
  'inappropriate_content',
  'scam',
  'copyright_infringement',
  'other',
] as const

export const PROFILE_REPORT_REASONS = [
  'impersonation',
  'harassment',
  'spam_or_scam',
  'inappropriate_content',
  'fake_profile',
  'other',
] as const

export type ModerationReportReason =
  | (typeof GENERAL_REPORT_REASONS)[number]
  | (typeof JOB_REPORT_REASONS)[number]
  | (typeof PROFILE_REPORT_REASONS)[number]

export const REPORT_REASON_LABELS: Record<ModerationReportReason, string> = {
  spam: 'Spam or unwanted promotion',
  scam: 'Scam or fraud',
  misinformation: 'False or misleading information',
  harassment: 'Harassment or bullying',
  hate_or_abuse: 'Hate or abusive content',
  unsafe_or_illegal: 'Unsafe or illegal activity',
  recruitment_fee: 'Recruitment fee requested',
  fake_company: 'Fake company or recruiter',
  misleading_salary: 'Misleading salary',
  false_vacancy: 'False or expired vacancy',
  suspicious_communication: 'Suspicious communication',
  inappropriate_content: 'Inappropriate content',
  copyright_infringement: 'Copyright or intellectual property infringement',
  impersonation: 'Impersonation',
  spam_or_scam: 'Spam or scam',
  fake_profile: 'Fake profile',
  other: 'Other',
}

export function allowedReportReasons(targetType: ModerationTargetType): readonly ModerationReportReason[] {
  if (targetType === 'job') return JOB_REPORT_REASONS
  if (targetType === 'profile') return PROFILE_REPORT_REASONS
  return GENERAL_REPORT_REASONS
}

export type ModerationAction =
  | 'reviewing'
  | 'dismiss'
  | 'resolve'
  | 'remove'
  | 'restore'
