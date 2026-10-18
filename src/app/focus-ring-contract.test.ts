import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Round H (H8): one visible focus ring for every interactive element: a 2px solid outline, 2px off the element,
// in --focus-ring (3:1 or better on white and the mist backgrounds; see src/lib/color-contrast.test.ts).

const root = process.cwd()
const css = readFileSync(path.join(root, 'src/app/globals.css'), 'utf8')

/** The global rule: `:where(<selectors>):focus-visible { <declarations> }` inside `@layer utilities`. */
function focusRule() {
  const layer = css.match(/@layer utilities \{([\s\S]*?)\n\}/)?.[1] ?? ''
  const rule = layer.match(/:where\(([\s\S]*?)\):focus-visible \{([\s\S]*?)\}/)
  return rule ? { selectors: rule[1].split(',').map((selector) => selector.trim()).filter(Boolean), body: rule[2] } : null
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(tsx|ts)$/.test(full) && !/\.test\.tsx?$/.test(full) ? [full] : []
  })
}

/** Quoted class strings (one line each) from the app source. */
function classStrings() {
  const found: Array<{ where: string; value: string }> = []
  for (const file of sourceFiles(path.join(root, 'src'))) {
    readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      for (const match of line.matchAll(/(["'`])((?:(?!\1).)*(?:outline|ring)(?:(?!\1).)*)\1/g)) {
        found.push({ where: `${path.relative(root, file)}:${index + 1}`, value: match[2] })
      }
    })
  }
  return found
}

describe('focus ring contract (Round H, H8)', () => {
  it('draws a 2px solid --focus-ring outline with a 2px offset', () => {
    const rule = focusRule()
    expect(rule).not.toBeNull()
    expect(rule!.body).toMatch(/outline:\s*2px solid var\(--focus-ring\);/)
    expect(rule!.body).toMatch(/outline-offset:\s*2px;/)
    expect(css).toMatch(/--focus-ring:\s*var\(--ocean-700\);/)
  })

  it('covers every kind of interactive element', () => {
    const selectors = focusRule()!.selectors
    for (const selector of [
      'a[href]', 'button', 'input', 'select', 'textarea', 'summary', '[tabindex]:not([tabindex="-1"])',
      '[role="button"]', '[role="tab"]', '[role="menuitem"]', '[role="option"]',
    ]) expect(selectors, selector).toContain(selector)
  })

  it('no longer removes the ring from form fields or draws the 1px teal outline', () => {
    expect(css).not.toContain('box-shadow: none !important')
    expect(css).not.toMatch(/:focus-visible[^{]*\{[^}]*outline:\s*none/)
    expect(css).not.toMatch(/outline:\s*1px solid var\(--teal-500\)/)
    expect(css).not.toMatch(/:focus-visible[^{]*\{[^}]*border-color:\s*var\(--teal-500\)/)
  })

  it('keeps the browser ring off only where a visible replacement is drawn', () => {
    const offenders = classStrings()
      .filter(({ value }) => /(^|\s)focus-visible:outline-none(\s|$)/.test(value))
      .filter(({ value }) => !/focus-visible:(ring-2|after:outline)/.test(value))
      .map(({ where }) => where)
    expect(offenders).toEqual([])
  })

  it('uses no see-through focus rings (ocean-500/40 was about 1.6:1)', () => {
    const offenders = classStrings()
      .filter(({ value }) => /focus-visible:ring-(ocean|teal|navy)-\d+\/\d+/.test(value))
      .map(({ where }) => where)
    expect(offenders).toEqual([])
  })

  it('removes the bare outline-none from the composer and picker fields named in the audit', () => {
    for (const file of [
      'src/features/messaging/components/message-composer.tsx',
      'src/features/messaging/components/new-message-dialog.tsx',
      'src/features/feed/components/post-composer.tsx',
      'src/features/learning/components/resumable-lesson-media.tsx',
      'src/features/events/components/event-date-time-field.tsx',
    ]) {
      const source = readFileSync(path.join(root, file), 'utf8')
      const fields = [...source.matchAll(/<(textarea|input|select)\b[\s\S]*?\/?>/g)].map((match) => match[0])
      for (const field of fields) expect(field, `${file}: ${field.slice(0, 80)}`).not.toMatch(/(["'\s`])outline-none(\s|["'`])/)
    }
  })
})
