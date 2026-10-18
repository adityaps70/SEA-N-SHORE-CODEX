import type { z } from 'zod'
import { pluralize } from '@/lib/format'

/**
 * Plain validation messages (learning round C, C0.1). A schema rule without its own message makes zod report
 * developer wording ("Too small: expected array to have >=1 items", "Invalid input: expected number, received NaN").
 * These helpers keep every message a schema wrote and turn zod's defaults into plain sentences, named after the
 * field when the caller gives its label. Use them wherever a validation error can reach a member.
 */

export type FieldLabels = Record<string, string>
export type PlainFieldErrors = Record<string, string[]>

type Issue = z.core.$ZodIssue

/** zod's own wording ("Too small: …", "Invalid input: …", "Invalid email address", "Unrecognized key …"). */
const ZOD_DEFAULT_MESSAGE = /^(Too (small|big):|Invalid\b|Unrecognized keys?\b|Required$)/

export function isRawValidationMessage(message: string | undefined | null) {
  return !message || ZOD_DEFAULT_MESSAGE.test(message.trim())
}

function amount(value: unknown) {
  return typeof value === 'bigint' ? Number(value) : Number(value)
}

/** One issue as a plain sentence. */
export function plainIssueMessage(issue: Issue, labels: FieldLabels = {}) {
  if (!isRawValidationMessage(issue.message)) return issue.message
  const key = typeof issue.path[0] === 'string' ? issue.path[0] : null
  const label = key ? labels[key] : undefined
  const field = label ?? 'This field'
  const lower = label ? label.toLocaleLowerCase('en') : 'this field'

  switch (issue.code) {
    case 'too_small': {
      const minimum = amount(issue.minimum)
      if (issue.origin === 'string') {
        return minimum <= 1 ? `${field} is required.` : `${field} needs at least ${pluralize(minimum, 'character')}.`
      }
      if (issue.origin === 'array' || issue.origin === 'set') {
        return minimum <= 1 ? `Add at least one entry to ${lower}.` : `Add at least ${minimum} entries to ${lower}.`
      }
      return `${field} must be ${minimum} or more.`
    }
    case 'too_big': {
      const maximum = amount(issue.maximum)
      if (issue.origin === 'string') return `${field} can be at most ${pluralize(maximum, 'character')}.`
      if (issue.origin === 'array' || issue.origin === 'set') return `${field} can have at most ${pluralize(maximum, 'entry', 'entries')}.`
      if (issue.origin === 'file') return `${field} is too large.`
      return `${field} must be ${maximum} or less.`
    }
    case 'invalid_type': {
      if (/received (undefined|null)/i.test(issue.message)) return `${field} is required.`
      if (issue.expected === 'number' || issue.expected === 'int' || issue.expected === 'bigint') {
        return issue.expected === 'int' ? `Enter a whole number for ${lower}.` : `Enter a number for ${lower}.`
      }
      if (issue.expected === 'date') return `Enter a valid date for ${lower}.`
      return `Check ${lower} and try again.`
    }
    case 'invalid_format': {
      if (issue.format === 'email') return 'Enter a valid email address.'
      if (issue.format === 'url') return label ? `Enter a valid web address for ${lower}, starting with https://.` : 'Enter a valid web address, starting with https://.'
      if (issue.format === 'uuid' || issue.format === 'guid') return 'This link is no longer valid. Reload the page and try again.'
      if (issue.format === 'datetime' || issue.format === 'date' || issue.format === 'time') return `Enter a valid date and time for ${lower}.`
      return `${field} contains characters that are not allowed.`
    }
    case 'invalid_value':
      return `Choose one of the options for ${lower}.`
    case 'not_multiple_of':
      return `Check the value of ${lower}.`
    case 'unrecognized_keys':
      return 'Please reload the page and try again.'
    default:
      return label ? `Check ${lower} and try again.` : 'Please check the highlighted information and try again.'
  }
}

/** The first issue as a plain sentence (for actions that report one message). */
export function firstPlainIssue(error: z.ZodError, fallback = 'Please check the highlighted information and try again.', labels: FieldLabels = {}) {
  const issue = error.issues[0]
  return issue ? plainIssueMessage(issue, labels) : fallback
}

/** Plain messages by top-level field (for forms that show a message under each field). */
export function plainFieldErrors(error: z.ZodError, labels: FieldLabels = {}): PlainFieldErrors {
  const fields: PlainFieldErrors = {}
  for (const issue of error.issues) {
    const key = typeof issue.path[0] === 'string' ? issue.path[0] : null
    if (!key) continue
    const message = plainIssueMessage(issue, labels)
    const list = fields[key] ?? (fields[key] = [])
    if (!list.includes(message)) list.push(message)
  }
  return fields
}
