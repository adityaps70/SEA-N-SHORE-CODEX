import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// iPhone Safari zooms the page in when a text field under 16px gets focus (the messages composer is text-sm),
// and it stays zoomed after the message is sent. On touch screens every text field is at least 16px instead.
// Pinch-zoom must stay available, so the fix is never maximum-scale or user-scalable=no in the viewport.
const css = readFileSync(path.join(process.cwd(), 'src/app/globals.css'), 'utf8')
const layout = readFileSync(path.join(process.cwd(), 'src/app/layout.tsx'), 'utf8')

function touchRule() {
  const start = css.indexOf('@media (pointer: coarse) {')
  expect(start, 'a (pointer: coarse) block in globals.css').toBeGreaterThanOrEqual(0)
  return css.slice(start, css.indexOf('\n}\n', start))
}

describe('phone text fields never trigger the iPhone focus zoom', () => {
  it('sets text fields, selects, text areas and editable regions to 16px on touch screens', () => {
    const rule = touchRule()
    expect(rule).toMatch(/\binput:not\(/)
    expect(rule).toMatch(/\bselect,/)
    expect(rule).toMatch(/\btextarea,/)
    expect(rule).toMatch(/\[contenteditable\]/)
    expect(rule).toMatch(/font-size: 16px;/)
    for (const type of ['checkbox', 'radio', 'file', 'hidden']) expect(rule).toContain(`[type="${type}"]`)
  })

  it('is not inside a cascade layer, so the text-sm and text-xs utilities cannot win over it', () => {
    const before = css.slice(0, css.indexOf('@media (pointer: coarse) {'))
    const opened = (before.match(/@layer [a-z]+ \{/g) ?? []).length
    const depth = [...before].reduce((level, char) => level + (char === '{' ? 1 : char === '}' ? -1 : 0), 0)
    expect(opened).toBeGreaterThan(0)
    expect(depth).toBe(0)
  })

  it('keeps pinch-zoom: the viewport never sets maximum-scale or turns user scaling off', () => {
    expect(layout).not.toMatch(/maximumScale|userScalable|maximum-scale|user-scalable/)
  })
})
