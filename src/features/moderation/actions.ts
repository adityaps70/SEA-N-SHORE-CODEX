'use server'

import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { moderationRepository } from './repository'
import {
  MODERATION_TARGET_TYPES,
  allowedReportReasons,
  type ModerationReportReason,
  type ModerationTargetType,
} from './types'

export type ModerationReportResult = { ok: true } | { ok: false; error: string }

const COPYRIGHT_DETAILS_ERROR = 'Please identify the copyrighted work, explain your rights or authority, and describe where the infringing material appears.'

const reportSchema = z.object({
  targetType: z.enum(MODERATION_TARGET_TYPES),
  targetId: z.string().uuid(),
  reason: z.string().trim().min(1).max(80),
  details: z.string().trim().max(4000).optional().default(''),
}).superRefine((value, context) => {
  const allowed = allowedReportReasons(value.targetType)
  if (!allowed.includes(value.reason as ModerationReportReason)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reason'],
      message: 'Please choose a valid report reason.',
    })
    return
  }

  if (value.reason === 'copyright_infringement' && value.details.length < 50) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['details'],
      message: COPYRIGHT_DETAILS_ERROR,
    })
  }
})

export async function reportContent(input: {
  targetType: ModerationTargetType
  targetId: string
  reason: string
  details?: string
}): Promise<ModerationReportResult> {
  const parsed = reportSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Please check this report and try again.',
    }
  }

  const user = await requireAwsUser()
  try {
    await moderationRepository.reportContent({
      reporterId: user.id,
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId,
      reason: parsed.data.reason as ModerationReportReason,
      details: parsed.data.details || null,
    })
    return { ok: true }
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'moderation_self_report_forbidden') {
      return { ok: false, error: 'You cannot report your own content.' }
    }
    if (code === 'moderation_target_unavailable') {
      return { ok: false, error: 'This content is no longer available to report.' }
    }
    return { ok: false, error: 'We could not submit this report. Please try again.' }
  }
}
