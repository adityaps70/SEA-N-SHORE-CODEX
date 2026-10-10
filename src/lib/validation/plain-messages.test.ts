import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { firstPlainIssue, isRawValidationMessage, plainFieldErrors, plainIssueMessage } from './plain-messages'

/** Learning round C (C0.1): zod's own wording never reaches a member. */

const RAW_WORDING = /Too small|Too big|expected (array|string|number)|Invalid input|Invalid option|Invalid (email|URL|UUID|string|ISO)|received (NaN|undefined)|^Required$/

describe('plain validation messages', () => {
  const schema = z.object({
    topics: z.array(z.string()).min(1),
    title: z.string().min(3).max(10),
    note: z.string().min(1),
    years: z.number().min(0).max(70),
    count: z.number().int(),
    email: z.string().email(),
    website: z.string().url(),
    id: z.string().uuid(),
    visibility: z.enum(['public', 'private']),
    slug: z.string().regex(/^[a-z]+$/),
    tags: z.array(z.string()).max(2),
    when: z.string().datetime(),
    missing: z.string(),
  })
  const labels = { topics: 'Course topics', title: 'Title', note: 'Note', years: 'Years', count: 'Count', email: 'Email', website: 'Website', visibility: 'Visibility', slug: 'Handle', tags: 'Tags', when: 'Start' }
  const bad = {
    topics: [], title: 'a'.repeat(11), note: '', years: Number.NaN, count: 1.5, email: 'no', website: 'nope', id: '1', visibility: 'secret',
    slug: 'A!', tags: ['a', 'b', 'c'], when: 'soon',
  }

  it('words every zod default plainly, naming the field when the label is known', () => {
    const error = schema.safeParse(bad).error!
    const messages = error.issues.map((issue) => plainIssueMessage(issue, labels))
    for (const message of messages) expect(message).not.toMatch(RAW_WORDING)
    expect(messages).toEqual([
      'Add at least one entry to course topics.',
      'Title can be at most 10 characters.',
      'Note is required.',
      'Enter a number for years.',
      'Enter a whole number for count.',
      'Enter a valid email address.',
      'Enter a valid web address for website, starting with https://.',
      'This link is no longer valid. Reload the page and try again.',
      'Choose one of the options for visibility.',
      'Handle contains characters that are not allowed.',
      'Tags can have at most 2 entries.',
      'Enter a valid date and time for start.',
      'This field is required.',
    ])
  })

  it('keeps every message a schema wrote itself', () => {
    const own = z.object({ topics: z.array(z.string()).min(1, 'Add at least one course topic, separated by commas') })
    const error = own.safeParse({ topics: [] }).error!
    expect(firstPlainIssue(error)).toBe('Add at least one course topic, separated by commas')
    expect(plainFieldErrors(error)).toEqual({ topics: ['Add at least one course topic, separated by commas'] })
    expect(isRawValidationMessage('Add at least one course topic, separated by commas')).toBe(false)
    expect(isRawValidationMessage('Too small: expected array to have >=1 items')).toBe(true)
  })

  it('gives one message per field, and a fallback when there is no issue', () => {
    const error = schema.safeParse({ ...bad, title: '' }).error!
    const fields = plainFieldErrors(error, labels)
    expect(fields.title).toEqual(['Title needs at least 3 characters.'])
    expect(Object.values(fields).flat().join(' ')).not.toMatch(RAW_WORDING)
    expect(firstPlainIssue(new z.ZodError([]), 'Check the form.')).toBe('Check the form.')
  })
})

/**
 * Source scan: an action that reports a validation problem goes through these helpers, so a rule without its own
 * message can never show zod's wording. A raw `issues[0].message` or `.flatten().fieldErrors` reaching a result
 * fails this test.
 */
describe('no raw zod messages in the app', () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return sourceFiles(path)
      return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : []
    })
  }

  it('reads validation messages only through plain-messages', () => {
    const root = join(process.cwd(), 'src')
    const offenders = sourceFiles(root)
      .filter((path) => !path.endsWith(join('lib', 'validation', 'plain-messages.ts')))
      .flatMap((path) => {
        const text = readFileSync(path, 'utf8')
        const hits = [
          ...text.matchAll(/\.issues\[0\]\??\.message/g),
          ...text.matchAll(/\.flatten\(\)\.fieldErrors/g),
          ...text.matchAll(/z\.(prettifyError|flattenError|treeifyError)\(/g),
          ...text.matchAll(/issues\.map\(\(issue\) => issue\.message\)/g),
        ]
        return hits.map(() => relative(process.cwd(), path))
      })
    expect(offenders).toEqual([])
  })
})
