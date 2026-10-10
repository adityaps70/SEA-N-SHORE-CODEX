import { z } from 'zod'
import { csvCell } from '@/features/newsletter/csv'

/**
 * The learner roster of one course (learning round C, C1). Only the course's own trainers (the trainer who owns it,
 * or its organisation's owners, administrators and learning managers) and Sea N Shore administrators see it.
 */

/** Enrolments and invitations one person may add by email: per rolling hour and per rolling day. */
export const ROSTER_ENROL_LIMITS = { perHour: 30, perDay: 200 } as const

export const ROSTER_EMAIL_MESSAGE = 'Enter one email address, for example name@example.com'

export const rosterEmailSchema = z
  .string(ROSTER_EMAIL_MESSAGE)
  .trim()
  .toLowerCase()
  .max(254, ROSTER_EMAIL_MESSAGE)
  .email(ROSTER_EMAIL_MESSAGE)

export type RosterCertificateStatus = 'issued' | 'expired' | 'none'

export type RosterQuizScore = { lessonTitle: string; bestPercentage: number; passed: boolean }

export type RosterLearner = {
  enrollmentId: string
  learnerId: string
  name: string
  slug: string | null
  rank: string | null
  enrolledAt: string
  source: 'free' | 'purchase' | 'admin' | 'trainer'
  status: 'active' | 'completed' | 'revoked'
  accessExpiresAt: string | null
  completedLessons: number
  totalLessons: number
  progressPercent: number
  lastActiveAt: string
  quizScores: RosterQuizScore[]
  certificate: RosterCertificateStatus
  /** Round D: the learner's batch on a batch course (null when self-paced or not in a batch). */
  batchId: string | null
  batchTitle: string | null
}

export type RosterInvitation = {
  id: string
  email: string
  createdAt: string
  expiresAt: string
  emailStatus: 'pending' | 'sent' | 'failed'
}

export type RosterEnrolOutcome =
  | { kind: 'enrolled'; name: string }
  | { kind: 'already_enrolled'; name: string }
  | { kind: 'invited' }
  | { kind: 'already_invited' }

export function rosterSourceLabel(source: RosterLearner['source']) {
  if (source === 'purchase') return 'Bought'
  if (source === 'trainer') return 'Enrolled by trainer'
  if (source === 'admin') return 'Course team'
  return 'Free'
}

export function rosterCertificateLabel(status: RosterCertificateStatus) {
  if (status === 'issued') return 'Issued'
  if (status === 'expired') return 'Expired'
  return 'Not yet'
}

export function rosterStatusLabel(learner: Pick<RosterLearner, 'status' | 'accessExpiresAt'>, now = new Date()) {
  if (learner.status === 'revoked') return 'Access removed'
  if (learner.accessExpiresAt && Date.parse(learner.accessExpiresAt) <= now.getTime()) return 'Access ended'
  if (learner.status === 'completed') return 'Completed'
  return 'Learning'
}

export function rosterQuizLabel(scores: readonly RosterQuizScore[]) {
  return scores.map((score) => `${score.lessonTitle}: ${score.bestPercentage}%${score.passed ? ' (passed)' : ''}`).join('; ')
}

function isoDate(value: string | null) {
  return value ? value.slice(0, 10) : ''
}

const COLUMNS: ReadonlyArray<readonly [string, (learner: RosterLearner) => string]> = [
  ['Name', (learner) => learner.name],
  ['Rank', (learner) => learner.rank ?? ''],
  ['Enrolled', (learner) => isoDate(learner.enrolledAt)],
  ['How', (learner) => rosterSourceLabel(learner.source)],
  ['Status', (learner) => rosterStatusLabel(learner)],
  ['Progress %', (learner) => String(learner.progressPercent)],
  ['Lessons completed', (learner) => `${learner.completedLessons} of ${learner.totalLessons}`],
  ['Last active', (learner) => isoDate(learner.lastActiveAt)],
  ['Quiz best scores', (learner) => rosterQuizLabel(learner.quizScores)],
  ['Certificate', (learner) => rosterCertificateLabel(learner.certificate)],
  ['Access until', (learner) => isoDate(learner.accessExpiresAt) || 'Lifetime'],
]

/**
 * The roster as CSV (UTF-8 with BOM for spreadsheet apps; formula-looking cells are neutralised by csvCell). A batch
 * course (round D) adds a Batch column after Rank; a self-paced course's export is unchanged.
 */
export function rosterToCsv(learners: readonly RosterLearner[], options: { includeBatch?: boolean } = {}) {
  const columns = options.includeBatch
    ? [COLUMNS[0]!, COLUMNS[1]!, ['Batch', (learner: RosterLearner) => learner.batchTitle ?? ''] as const, ...COLUMNS.slice(2)]
    : COLUMNS
  const header = columns.map(([name]) => name).join(',')
  const lines = learners.map((learner) => columns.map(([, read]) => csvCell(read(learner))).join(','))
  return `﻿${[header, ...lines].join('\r\n')}\r\n`
}
