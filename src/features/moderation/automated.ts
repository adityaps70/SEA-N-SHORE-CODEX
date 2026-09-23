import type { ModerationReportReason } from './types'

export type AutomatedModerationCategory =
  | 'abusive_content'
  | 'threats_harassment'
  | 'hate_unsafe'
  | 'spam_scams'
  | 'platform_rule_violation'

export type AutomatedModerationDecision = 'allow' | 'review' | 'block'

export type AutomatedModerationAssessment = {
  decision: AutomatedModerationDecision
  category: AutomatedModerationCategory | null
  reason: ModerationReportReason | null
  ruleIds: string[]
}

type Rule = {
  id: string
  decision: Exclude<AutomatedModerationDecision, 'allow'>
  category: AutomatedModerationCategory
  reason: ModerationReportReason
  test: (text: string) => boolean
}

const DIRECT_THREAT = /\b(?:i|we)\s+(?:will|shall|am going to|are going to|gonna)\s+(?:kill|hurt|attack|beat|shoot|stab)\s+(?:you|him|her|them|your|their)\b/i
const VIOLENT_IMPERATIVE = /\b(?:kill|shoot|stab|attack|beat up)\s+(?:you|him|her|them|all of them)\b/i
const HATE_TARGET = /\b(?:muslims?|hindus?|christians?|jews?|sikhs?|buddhists?|women|men|gay people|lesbians?|trans(?:gender)? people|black people|white people|asians?)\b/i
const HATE_ACTION = /\b(?:should|must|need to|deserve to)\s+(?:die|be killed|be attacked|be beaten|be exterminated|be driven out)\b/i
const ABUSIVE_ADDRESS = /\b(?:you are|you're|ur)\s+(?:an?\s+)?(?:idiot|moron|stupid|useless|worthless|loser|trash)\b/i
const CREDENTIAL_THEFT = /\b(?:send|share|give|tell)\b.{0,45}\b(?:otp|one[- ]time password|password|pin|cvv)\b/i
const RECRUITMENT_FEE = /\b(?:pay|send|deposit|transfer)\b.{0,50}\b(?:registration|processing|placement|recruitment|joining|security)\s+fee\b/i
const GUARANTEED_JOB = /\bguaranteed\s+(?:job|placement|joining|selection)\b/i
const FAST_CONTACT = /\b(?:whatsapp|telegram)\b/i
const CREDENTIAL_FRAUD = /\b(?:buy|get|arrange|provide)\b.{0,45}\b(?:coc|certificate|stcw|sea service|license|licence)\b.{0,45}\b(?:without\s+(?:exam|training|verification)|fake|forged?)\b/i
const CREDENTIAL_FRAUD_REVERSED = /\b(?:fake|forged?)\b.{0,30}\b(?:sea service|certificate|coc|license|licence|document)\b/i
const DOXXING = /\b(?:post|share|publish|leak|expose)\b.{0,45}\b(?:home address|private address|personal phone number|private phone number)\b/i
const UNSAFE_INSTRUCTION = /\b(?:how to|steps to|instructions to)\b.{0,60}\b(?:disable safety|bypass safety|sabotage|poison|make a bomb)\b/i
const URL_PATTERN = /https?:\/\/[^\s]+/gi

const rules: Rule[] = [
  {
    id: 'direct_violence_threat',
    decision: 'block',
    category: 'threats_harassment',
    reason: 'harassment',
    test: (text) => DIRECT_THREAT.test(text) || VIOLENT_IMPERATIVE.test(text),
  },
  {
    id: 'hate_violence_incitation',
    decision: 'block',
    category: 'hate_unsafe',
    reason: 'hate_or_abuse',
    test: (text) => HATE_TARGET.test(text) && HATE_ACTION.test(text),
  },
  {
    id: 'credential_theft',
    decision: 'block',
    category: 'spam_scams',
    reason: 'scam',
    test: (text) => CREDENTIAL_THEFT.test(text),
  },
  {
    id: 'unsafe_instruction',
    decision: 'block',
    category: 'hate_unsafe',
    reason: 'unsafe_or_illegal',
    test: (text) => UNSAFE_INSTRUCTION.test(text),
  },
  {
    id: 'abusive_harassment',
    decision: 'review',
    category: 'abusive_content',
    reason: 'harassment',
    test: (text) => ABUSIVE_ADDRESS.test(text),
  },
  {
    id: 'recruitment_fee_scam',
    decision: 'review',
    category: 'spam_scams',
    reason: 'scam',
    test: (text) => RECRUITMENT_FEE.test(text) || (GUARANTEED_JOB.test(text) && FAST_CONTACT.test(text) && /\b(?:pay|fee|deposit|transfer)\b/i.test(text)),
  },
  {
    id: 'credential_fraud',
    decision: 'review',
    category: 'platform_rule_violation',
    reason: 'other',
    test: (text) => CREDENTIAL_FRAUD.test(text) || CREDENTIAL_FRAUD_REVERSED.test(text),
  },
  {
    id: 'doxxing',
    decision: 'review',
    category: 'platform_rule_violation',
    reason: 'unsafe_or_illegal',
    test: (text) => DOXXING.test(text),
  },
  {
    id: 'repeated_links',
    decision: 'review',
    category: 'spam_scams',
    reason: 'spam',
    test: (text) => (text.match(URL_PATTERN) ?? []).length >= 3,
  },
]

function normalizeText(parts: readonly (string | null | undefined)[]) {
  return parts
    .filter((value): value is string => typeof value === 'string')
    .join('\n')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function decisionRank(decision: AutomatedModerationDecision) {
  if (decision === 'block') return 2
  if (decision === 'review') return 1
  return 0
}

export function assessPlatformText(parts: readonly (string | null | undefined)[]): AutomatedModerationAssessment {
  const text = normalizeText(parts)
  if (!text) return { decision: 'allow', category: null, reason: null, ruleIds: [] }

  const matches = rules.filter((rule) => rule.test(text))
  if (!matches.length) return { decision: 'allow', category: null, reason: null, ruleIds: [] }

  const strongest = [...matches].sort((a, b) => decisionRank(b.decision) - decisionRank(a.decision))[0]
  return {
    decision: strongest.decision,
    category: strongest.category,
    reason: strongest.reason,
    ruleIds: matches.map((rule) => rule.id),
  }
}

export function moderationBlockMessage() {
  return 'This content could not be published because it appears to violate Sea N Shore community safety rules. Please revise it and try again.'
}

export function automatedModerationDetails(assessment: AutomatedModerationAssessment) {
  if (assessment.decision === 'allow' || !assessment.category || !assessment.reason) return null
  const category = assessment.category.replaceAll('_', ' ')
  return [
    '[AUTOMATED MODERATION]',
    `Category: ${category}`,
    `Decision: ${assessment.decision}`,
    `Signals: ${assessment.ruleIds.join(', ')}`,
    'Generated by automated safety rules. Review context before taking moderation action.',
  ].join('\n')
}
