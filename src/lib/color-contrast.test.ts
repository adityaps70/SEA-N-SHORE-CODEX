import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AA_LARGE_TEXT_AND_UI, AA_TEXT, contrastRatio, parseHexColor, relativeLuminance } from './color-contrast'

describe('contrast maths', () => {
  it('parses six- and three-digit hex colours', () => {
    expect(parseHexColor('#0b2740')).toEqual([11, 39, 64])
    expect(parseHexColor('fff')).toEqual([255, 255, 255])
    expect(() => parseHexColor('oklch(0.5 0.1 200)')).toThrow()
  })

  it('matches the WCAG reference values', () => {
    expect(relativeLuminance('#000000')).toBe(0)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5)
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1)
    // The order of the two colours does not matter.
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#767676'), 10)
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThan(4.5)
  })
})

// Round H (H8): every colour token is defined once in src/app/globals.css. These tests read the tokens from there,
// so changing a token re-checks every text colour against the page backgrounds.
const css = readFileSync(path.join(process.cwd(), 'src/app/globals.css'), 'utf8')
const rootBlock = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
const TOKENS = Object.fromEntries(
  [...rootBlock.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{3,6})\s*;/gi)].map((match) => [match[1], match[2]]),
) as Record<string, string>
const BACKGROUNDS = { white: '#ffffff', 'mist-50': TOKENS['mist-50'], 'mist-100': TOKENS['mist-100'] }

/** Tokens the site uses for text on light backgrounds; each needs 4.5:1 on white, mist-50 and mist-100. */
const TEXT_TOKENS = ['ink', 'muted', 'navy-950', 'navy-900', 'navy-800', 'navy-700', 'navy-500', 'ocean-900', 'ocean-800', 'ocean-700', 'ocean-600']

/**
 * Tailwind's default grey shades that are too light for text on a light page (slate-400 is 2.6:1 on white). The
 * lighter 50–200 shades only colour text on dark surfaces, so they are not listed.
 */
const FORBIDDEN_DEFAULT_TEXT = /(?:^|:)text-(?:slate|gray|zinc|neutral|stone)-(?:300|400)$/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(tsx|ts)$/.test(full) && !/\.test\.tsx?$/.test(full) ? [full] : []
  })
}

/** Every quoted class string in the app that uses a text colour class. */
function textColourClassStrings() {
  const found: Array<{ where: string; classes: string[] }> = []
  for (const file of sourceFiles(path.join(process.cwd(), 'src'))) {
    readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      for (const match of line.matchAll(/(["'`])((?:(?!\1).)*\btext-[a-z]+-?[0-9]*(?:(?!\1).)*)\1/g)) {
        found.push({ where: `${path.relative(process.cwd(), file)}:${index + 1}`, classes: match[2].split(/\s+/) })
      }
    })
  }
  return found
}

/** A class string on a lucide icon (sized with size-*), where the colour is a graphic, not text. */
const isIcon = (classes: string[]) => classes.some((token) => /^size-[\d.]+$/.test(token))

describe('colour tokens (Round H, H8)', () => {
  it('reads the palette from globals.css', () => {
    for (const token of [...TEXT_TOKENS, 'mist-50', 'mist-100', 'teal-500']) expect(TOKENS[token], token).toMatch(/^#/)
  })

  it.each(TEXT_TOKENS)('text token %s reaches 4.5:1 on white, mist-50 and mist-100', (token) => {
    for (const [name, background] of Object.entries(BACKGROUNDS)) {
      expect(contrastRatio(TOKENS[token], background), `${token} on ${name}`).toBeGreaterThanOrEqual(AA_TEXT)
    }
  })

  it('gives the focus ring 3:1 on white and every mist background', () => {
    const focus = css.match(/--focus-ring:\s*var\(--([a-z0-9-]+)\)/)?.[1]
    expect(focus).toBeTruthy()
    for (const background of ['#ffffff', TOKENS['mist-50'], TOKENS['mist-100'], TOKENS['mist-200']]) {
      expect(contrastRatio(TOKENS[focus!], background)).toBeGreaterThanOrEqual(AA_LARGE_TEXT_AND_UI)
    }
  })

  it('colours text only with tokens that reach 4.5:1 (icons may use the lighter accents)', () => {
    const offenders: string[] = []
    for (const { where, classes } of textColourClassStrings()) {
      if (isIcon(classes)) continue
      for (const token of classes) {
        // text-<token>, also behind variants (hover:, placeholder:, group-hover: …); opacity suffixes are checked too.
        const match = token.match(/(?:^|:)text-([a-z]+(?:-[0-9]+)?)(?:\/([0-9]+))?$/)
        if (match && TOKENS[match[1]]) {
          const worst = Math.min(...Object.values(BACKGROUNDS).map((background) => contrastRatio(TOKENS[match[1]], background)))
          if (match[2] || worst < AA_TEXT) offenders.push(`${where}: ${token} (${worst.toFixed(2)}:1${match[2] ? ', with opacity' : ''})`)
        }
        if (FORBIDDEN_DEFAULT_TEXT.test(token)) offenders.push(`${where}: ${token}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
