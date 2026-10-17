import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Button, buttonClass as buttonClassFromButton } from '@/components/ui/button'
import { buttonClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui/interactive-styles'

/**
 * Contract (Round H, H6): one primary button colour across the site.
 * The primary action is navy (`buttonClass({ variant: 'primary' })` / `<Button>`); a second filled action is the
 * bordered white secondary. A teal, ocean, blue, sky or cyan fill with white text on a button or a button-styled
 * link is a leftover per-page primary and fails here. Convert it to `<Button>` or `buttonClass(...)`.
 *
 * Scope: every non-test .ts/.tsx file under src/ except the landing design folder.
 * Heuristic: a string literal (or one piece of a template literal) whose resting classes include such a fill,
 * `text-white`, a `rounded` class and padding or a min height. Literals inside the className of a plain
 * non-interactive element (span, div, p, li…) are not buttons and are skipped. Hover, focus and other state
 * variants are not resting classes; responsive variants (`md:`, `max-md:`) are, so a phone-only fill counts.
 */
const root = process.cwd()
const SRC = path.join(root, 'src')

/** The landing page keeps its own art direction (owned by the marketing design, not the shared Button). */
const EXCLUDED_DIRS = [path.join(SRC, 'components/marketing/landing') + path.sep]

type AllowEntry = { file: string; contains: string; reason: string }

/**
 * Genuine non-button uses of a filled colour with white text. An entry only covers class strings in `file` that
 * contain `contains`, so a real button in the same file is still caught. Every entry needs a reason.
 */
const ALLOW_LIST: AllowEntry[] = [
  { file: 'src/components/navigation/app-header.tsx', contains: 'min-w-5', reason: 'unread-count badge on the Messages icon, not a button' },
  { file: 'src/components/navigation/mobile-app-header.tsx', contains: 'min-w-5', reason: 'unread-count badge on the phone header icons, not a button' },
  { file: 'src/components/navigation/mobile-nav.tsx', contains: 'min-w-5', reason: 'unread-count badge on the phone tab bar, not a button' },
]

/**
 * Buttons in files owned by the parallel layout/header change (Round H, H6). They must become navy there; each
 * entry fails the stale-entry test below as soon as it is converted, so the list can only shrink.
 */
const PENDING_IN_OTHER_CHANGE: AllowEntry[] = []

const isCovered = (entries: AllowEntry[], offender: Offender) =>
  entries.some((entry) => entry.file === offender.file && offender.className.includes(entry.contains))

const COLOURED_FILL = /^bg-(ocean|teal|blue|sky|cyan)-[5-9]00(\/\d+)?$/
const RESPONSIVE_PREFIX = /^((max-)?(sm|md|lg|xl|2xl):)+/
const NON_INTERACTIVE_TAGS = new Set([
  'span', 'div', 'p', 'li', 'ul', 'ol', 'dd', 'dt', 'dl', 'img', 'svg', 'path', 'section', 'article', 'header',
  'footer', 'aside', 'nav', 'main', 'figure', 'figcaption', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em',
  'small', 'time', 'mark', 'abbr', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'progress', 'meter',
])

function sourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts'))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => !EXCLUDED_DIRS.some((dir) => file.startsWith(dir)))
}

/** Resting classes: drop state variants (hover:, focus-visible:, disabled:, group-hover:, aria-…), keep responsive ones. */
function restingTokens(className: string): string[] {
  return className
    .split(/\s+/)
    .map((token) => token.replace(RESPONSIVE_PREFIX, '').replace(/^!/, ''))
    .filter((token) => token && !token.includes(':'))
}

/** True when a class string reads as a filled teal/ocean/blue button with white text. */
function isColouredFilledButton(className: string): boolean {
  const tokens = restingTokens(className)
  return (
    tokens.some((token) => COLOURED_FILL.test(token)) &&
    tokens.includes('text-white') &&
    tokens.some((token) => /^rounded(-|$)/.test(token)) &&
    tokens.some((token) => /^(p|px|py|min-h)-/.test(token))
  )
}

/** The JSX element whose className attribute contains this node, if any. */
function enclosingClassNameTag(node: ts.Node, source: ts.SourceFile): string | null {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (ts.isJsxAttribute(current)) {
      if (current.name.getText(source) !== 'className') return null
      const element = current.parent.parent
      return ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element) ? element.tagName.getText(source) : null
    }
    if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current) || ts.isSourceFile(current)) return null
  }
  return null
}

type Offender = { file: string; where: string; className: string }

function fileOffenders(file: string, text: string): Offender[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
  const found: Offender[] = []
  const check = (node: ts.Node, value: string) => {
    if (!isColouredFilledButton(value)) return
    const tag = enclosingClassNameTag(node, source)
    if (tag && NON_INTERACTIVE_TAGS.has(tag)) return
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
    const relative = path.relative(root, file)
    found.push({ file: relative, where: `${relative}:${line}`, className: value })
  }
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) check(node, node.text)
    else if (ts.isTemplateExpression(node)) {
      check(node.head, node.head.text)
      for (const span of node.templateSpans) check(span.literal, span.literal.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

describe('one primary button colour', () => {
  it('gives <Button>, primaryButtonClass and buttonClass("primary") the same navy classes', () => {
    for (const value of [buttonClass(), buttonClass('primary'), buttonClass({ variant: 'primary' }), primaryButtonClass]) {
      const tokens = value.split(/\s+/)
      expect(tokens).toEqual(expect.arrayContaining(['bg-navy-950', 'text-white', 'hover:bg-navy-800', 'focus-visible:ring-2', 'cursor-pointer']))
      expect(tokens.some((token) => COLOURED_FILL.test(token))).toBe(false)
    }
    expect(buttonClass('primary')).toBe(buttonClass({ variant: 'primary', size: 'md' }))
    expect(buttonClass()).toContain('min-h-12')
    expect(primaryButtonClass).toBe(buttonClass({ variant: 'primary', size: 'sm' }))
    expect(primaryButtonClass).toContain('min-h-10')
  })

  it('renders <Button> (default and variant="primary") with exactly the buttonClass("primary") classes', () => {
    const classOf = (html: string) => html.match(/class="([^"]*)"/)?.[1] ?? ''
    const expected = buttonClass('primary').split(' ').sort()
    expect(classOf(renderToStaticMarkup(createElement(Button, null, 'Save'))).split(' ').sort()).toEqual(expected)
    expect(classOf(renderToStaticMarkup(createElement(Button, { variant: 'primary' }, 'Save'))).split(' ').sort()).toEqual(expected)
    expect(classOf(renderToStaticMarkup(createElement(Button, { variant: 'secondary', size: 'sm' }, 'Back'))).split(' ').sort())
      .toEqual(secondaryButtonClass.split(' ').sort())
    expect(buttonClassFromButton).toBe(buttonClass)
  })

  it('keeps secondary a bordered white button from the same helper', () => {
    expect(secondaryButtonClass).toBe(buttonClass({ variant: 'secondary', size: 'sm' }))
    expect(buttonClass('secondary')).toMatch(/\bborder border-mist-200\b.*\bbg-white\b.*\btext-navy-950\b/)
    expect(buttonClass('secondary')).not.toContain('text-white')
  })

  it('recognises coloured filled buttons and ignores state variants, chips and badges', () => {
    expect(isColouredFilledButton('inline-flex min-h-11 rounded-xl bg-teal-600 px-5 text-white hover:bg-teal-700')).toBe(true)
    expect(isColouredFilledButton('max-md:rounded-full max-md:bg-ocean-700 max-md:text-white max-md:min-h-11')).toBe(true)
    expect(isColouredFilledButton('rounded-xl bg-navy-950 px-5 text-white hover:bg-ocean-700')).toBe(false)
    expect(isColouredFilledButton('bg-ocean-700 text-white')).toBe(false)
    expect(isColouredFilledButton('rounded-full bg-teal-50 px-2 text-teal-800')).toBe(false)
    const where = (text: string) => fileOffenders(path.join(root, 'x.tsx'), text).map((offender) => offender.where)
    expect(where('<span className="rounded-full bg-ocean-700 px-1 text-white">3</span>')).toEqual([])
    expect(where('<button className="rounded-xl bg-ocean-700 px-4 text-white">Go</button>')).toEqual(['x.tsx:1'])
    expect(where('<Link className={`mt-2 rounded-xl bg-blue-600 px-4 text-white`} href="/">Go</Link>')).toEqual(['x.tsx:1'])
    expect(where("const cta = 'rounded-xl bg-teal-600 px-4 text-white'")).toEqual(['x.tsx:1'])
  })

  it('scans the whole app', () => {
    const files = sourceFiles()
    expect(files.length).toBeGreaterThan(200)
    expect(files).toContain(path.join(SRC, 'components/ui/button.tsx'))
    expect(files).toContain(path.join(SRC, 'features/jobs/components/mobile-chip.ts'))
    expect(files).not.toContain(path.join(SRC, 'components/ui/button-variant-contract.test.ts'))
    expect(files.some((file) => file.includes(`${path.sep}landing${path.sep}`) && file.includes('marketing'))).toBe(false)
  })

  const allOffenders = () => sourceFiles().flatMap((file) => fileOffenders(file, readFileSync(file, 'utf8')))

  it('has no teal, ocean or blue filled primary buttons outside the allow-list', () => {
    const offenders = allOffenders()
      .filter((offender) => !isCovered(ALLOW_LIST, offender) && !isCovered(PENDING_IN_OTHER_CHANGE, offender))
      .map((offender) => offender.where)
    expect(offenders).toEqual([])
  })

  it('keeps every allow-list and pending entry live, pointing at a real offender, with a reason', () => {
    const offenders = allOffenders()
    for (const entry of [...ALLOW_LIST, ...PENDING_IN_OTHER_CHANGE]) {
      expect(entry.reason.length, entry.file).toBeGreaterThan(10)
      expect(offenders.some((offender) => isCovered([entry], offender)), `stale entry: ${entry.file} (${entry.contains})`).toBe(true)
    }
  })
})
