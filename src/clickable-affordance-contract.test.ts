import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  backLinkClass,
  iconButtonClass,
  primaryButtonClass,
  reportButtonClass,
  secondaryButtonClass,
  textLinkClass,
} from '@/components/ui/interactive-styles'

const root = process.cwd()
const CLICKABLE = new Set(['button', 'a', 'Link'])
const FILLED = /^bg-(navy-9[05]0|ocean-700|teal-[67]00|emerald-700|red-700|rose-700|amber-900)$/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return full.endsWith('.tsx') && !full.endsWith('.test.tsx') ? [full] : []
  })
}

/** Clickable elements whose className is a single string literal. */
function literalClickables() {
  const found: Array<{ where: string; className: string }> = []
  for (const file of ['src/app', 'src/components', 'src/features'].flatMap((dir) => sourceFiles(path.join(root, dir)))) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const visit = (node: ts.Node) => {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && CLICKABLE.has(node.tagName.getText(source))) {
        for (const attribute of node.attributes.properties) {
          if (!ts.isJsxAttribute(attribute) || attribute.name.getText(source) !== 'className' || !attribute.initializer) continue
          const init = attribute.initializer
          const literal = ts.isStringLiteral(init)
            ? init
            : ts.isJsxExpression(init) && init.expression && (ts.isStringLiteral(init.expression) || ts.isNoSubstitutionTemplateLiteral(init.expression))
              ? init.expression
              : null
          if (literal) {
            const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1
            found.push({ where: `${path.relative(root, file)}:${line}`, className: literal.text })
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return found
}

describe('clickable elements look clickable', () => {
  it('gives buttons, [role=button], summaries and toggle labels the pointer cursor globally, and disabled controls not-allowed', () => {
    const css = readFileSync(path.join(root, 'src/app/globals.css'), 'utf8')
    const pointerRule = css.match(/@layer base \{([\s\S]*?)cursor: pointer;/)?.[1] ?? ''
    for (const selector of ['button:not(:disabled)', '[role="button"]', 'summary', 'label[for]', 'select:not(:disabled)']) {
      expect(pointerRule).toContain(selector)
    }
    expect(css).toMatch(/button:disabled,[\s\S]*?cursor: not-allowed;/)
  })

  it('shares button and link styles that always carry a visible resting state, a hover change and the pointer cursor', () => {
    expect(primaryButtonClass).toMatch(/\bbg-navy-950\b.*\bhover:bg-navy-800\b/)
    expect(secondaryButtonClass).toMatch(/\bborder border-mist-200\b.*\bhover:border-ocean-300\b.*\bhover:bg-mist-50\b/)
    expect(reportButtonClass).toMatch(/\bborder border-mist-200\b.*\bhover:bg-red-50\b/)
    expect(textLinkClass).toMatch(/\btext-ocean-700\b.*\bhover:underline\b/)
    expect(backLinkClass).toMatch(/\btext-ocean-700\b.*\bhover:underline\b/)
    expect(iconButtonClass).toMatch(/\bsize-9\b.*\bhover:bg-mist-100\b/)
    for (const value of [primaryButtonClass, secondaryButtonClass, reportButtonClass, textLinkClass, backLinkClass, iconButtonClass]) {
      expect(value).toContain('cursor-pointer')
    }
    for (const value of [primaryButtonClass, secondaryButtonClass, iconButtonClass]) {
      expect(value).toContain('disabled:cursor-not-allowed')
      expect(value).toContain('focus-visible:ring-2')
    }
  })

  it('never leaves a filled or bordered button or link without a hover state', () => {
    const clickables = literalClickables()
    expect(clickables.length).toBeGreaterThan(200)
    const offenders = clickables
      .filter(({ className }) => !/(^|\s)(enabled:|group-)?hover:/.test(className) && !/cursor-not-allowed/.test(className.replace(/disabled:cursor-not-allowed/g, '')))
      .filter(({ className }) => {
        const base = className.split(/\s+/).filter((token) => !token.includes(':'))
        const filled = base.some((token) => FILLED.test(token))
        const bordered = base.includes('border') && base.some((token) => /^border-(mist|navy|ocean|teal)-\d+$/.test(token))
        return filled || bordered
      })
      .map(({ where }) => where)
    expect(offenders).toEqual([])
  })

  it('keeps full borders on clickable controls visible (no near-white border-mist-100)', () => {
    const offenders = literalClickables()
      .filter(({ className }) => {
        const tokens = className.split(/\s+/)
        return tokens.includes('border') && tokens.includes('border-mist-100')
      })
      .map(({ where }) => where)
    expect(offenders).toEqual([])
  })
})
