import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Contract (Round H, H7): counts read naturally ("1 comment", "3 comments"), never "comment(s)".
 * Use `pluralize` / `pluralizeWithVerb` from src/lib/format.ts for any count shown to people.
 *
 * Scope: every non-test .ts/.tsx file under src/. A word (or a `${...}` expression) followed by "(s)" and then a
 * space, punctuation, a quote or a tag fails. "http(s)" is the URL scheme, not a plural, and is allowed.
 */
const SRC = path.join(process.cwd(), 'src')
const PLURAL_S = /(?<!htt)(?:[A-Za-z]|\})\(s\)(?=[\s?!:;,'"`<]|\.(?![A-Za-z_$])|$)/

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name) || entry.name.endsWith('.d.ts')) return []
    return [full]
  })
}

describe('plural copy contract (round H, H7)', () => {
  it('the pattern catches "(s)" plurals and leaves http(s) and function calls alone', () => {
    expect(PLURAL_S.test('Start sending 2 prepared invitation(s)?')).toBe(true)
    expect(PLURAL_S.test('`${count} ${noun}(s) are queued`')).toBe(true)
    expect(PLURAL_S.test('{count} message(s) are being processed')).toBe(true)
    expect(PLURAL_S.test('Remove the selected item(s).')).toBe(true)
    expect(PLURAL_S.test('Use a valid http(s) URL.')).toBe(false)
    expect(PLURAL_S.test('Number(String(s).replace(",", "."))')).toBe(false)
  })

  it('no source file shows a count as "word(s)"', () => {
    const offenders = sourceFiles(SRC).flatMap((file) => readFileSync(file, 'utf8')
      .split('\n')
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => PLURAL_S.test(line))
      .map(({ line, index }) => `${path.relative(process.cwd(), file)}:${index + 1}: ${line.trim()}`))
    expect(offenders).toEqual([])
  })
})
