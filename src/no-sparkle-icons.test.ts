import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Contract: the product never decorates anything with a sparkle-type icon
 * (lucide Sparkle / Sparkles / WandSparkles / Stars, their CSS class names or
 * the ✨ character). The only ✨ allowed is the emoji palette entry members
 * pick for their own messages.
 */
const root = process.cwd()
const SRC = path.join(root, 'src')
const THIS_FILE = path.join(SRC, 'no-sparkle-icons.test.ts')
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mdx', '.css'])
const SPARKLE_EMOJI_ALLOW_LIST = new Set([path.join(SRC, 'features/messaging/components/message-emoji-picker.tsx')])

const LUCIDE_NAMED_IMPORT = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]lucide-react['"]/g
const SPARKLE_SPECIFIER = /\b(Sparkles?|WandSparkles|Stars)\b/
const LUCIDE_DEEP_IMPORT = /['"]lucide-react\/(?:dist\/esm\/)?icons\/(?:sparkle|sparkles|wand-sparkles|stars)(?:\.js)?['"]/
const LUCIDE_CLASS_NAME = /\blucide-(?:sparkles?|wand-sparkles|stars)\b/
const SPARKLE_EMOJI = '✨'

function sourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name)))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => !file.split(path.sep).includes('node_modules') && file !== THIS_FILE)
}

function sparkleViolations(file: string, text: string): string[] {
  const reasons: string[] = []
  for (const match of text.matchAll(LUCIDE_NAMED_IMPORT)) {
    const specifier = match[1].split(',').map((entry) => entry.trim()).find((entry) => SPARKLE_SPECIFIER.test(entry))
    if (specifier) reasons.push(`imports "${specifier}" from lucide-react`)
  }
  if (LUCIDE_DEEP_IMPORT.test(text)) reasons.push('imports a sparkle icon from a lucide-react icons path')
  const className = text.match(LUCIDE_CLASS_NAME)
  if (className) reasons.push(`references the "${className[0]}" class name`)
  if (text.includes(SPARKLE_EMOJI) && !SPARKLE_EMOJI_ALLOW_LIST.has(file)) reasons.push('uses the sparkle emoji as decoration')
  return reasons
}

describe('no sparkle icons', () => {
  it('walks every source file under src/', () => {
    const files = sourceFiles()
    expect(files.length).toBeGreaterThan(100)
    expect(files).toContain(path.join(SRC, 'features/profiles/persona-icons.ts'))
    expect(files).not.toContain(THIS_FILE)
  })

  it('flags each kind of sparkle reference', () => {
    const file = path.join(SRC, 'example.tsx')
    expect(sparkleViolations(file, "import { Anchor, Sparkles as Shine } from 'lucide-react'")).toEqual(['imports "Sparkles as Shine" from lucide-react'])
    expect(sparkleViolations(file, "import { Sparkle } from 'lucide-react'")).toHaveLength(1)
    expect(sparkleViolations(file, "import { WandSparkles } from 'lucide-react'")).toHaveLength(1)
    expect(sparkleViolations(file, "import { Stars } from 'lucide-react'")).toHaveLength(1)
    expect(sparkleViolations(file, "import Sparkles from 'lucide-react/dist/esm/icons/sparkles'")).toHaveLength(1)
    expect(sparkleViolations(file, "expect(icon).toHaveClass('lucide-wand-sparkles')")).toHaveLength(1)
    expect(sparkleViolations(file, '<span>✨ New</span>')).toEqual(['uses the sparkle emoji as decoration'])
    expect(sparkleViolations([...SPARKLE_EMOJI_ALLOW_LIST][0], "{ emoji: '✨' }")).toEqual([])
    expect(sparkleViolations(file, "import { Star, StarHalf, Anchor } from 'lucide-react'\nclassName=\"lucide-star\"")).toEqual([])
  })

  it('never imports, styles or draws a sparkle-type icon anywhere under src/', () => {
    const offenders = sourceFiles().flatMap((file) => {
      const reasons = sparkleViolations(file, readFileSync(file, 'utf8'))
      return reasons.length ? [`${path.relative(root, file)}: ${reasons.join('; ')}`] : []
    })
    expect(offenders, `Sparkle-type icons are not part of the design language. Offending files:\n${offenders.join('\n')}`).toEqual([])
  })
})
