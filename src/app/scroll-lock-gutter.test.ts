import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(process.cwd(), 'src')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

// Round H (H6): opening the post composer (or any dialog that locks scroll) used to shift the page
// by the scrollbar's width (~8px). The page now always reserves the scrollbar's space instead.
describe('scroll lock without layout shift', () => {
  it('reserves the scrollbar gutter on the root element', () => {
    const css = readFileSync(join(SRC, 'app/globals.css'), 'utf8')
    expect(css).toMatch(/^html \{ scrollbar-gutter: stable; \}$/m)
  })

  it('locks scroll only by hiding overflow on body or html, which the reserved gutter covers', () => {
    const locks = sourceFiles(SRC).flatMap((file) => {
      const text = readFileSync(file, 'utf8')
      return [...text.matchAll(/([\w.]+)\.style\.overflow = 'hidden'/g)].map((match) => ({ file: relative(SRC, file), target: match[1], text }))
    })
    // The post composer, the phone sheet and drawer, the media viewers and the messaging dialogs.
    expect(locks.map((lock) => lock.file)).toEqual(expect.arrayContaining([
      'features/feed/components/post-composer.tsx',
      'features/messaging/components/use-modal-layer.ts',
    ]))
    for (const lock of locks) {
      if (lock.target === 'document.body') continue
      // Any other name must be the root element.
      expect(lock.text, lock.file).toContain(`const ${lock.target.replace(/\.style$/, '')} = document.documentElement`)
    }
  })

  it('never pads the page to make up for a hidden scrollbar (the gutter already does, so it would double)', () => {
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, 'utf8')
      expect(text, relative(SRC, file)).not.toMatch(/(?:body|documentElement)\.style\.paddingRight|innerWidth - document\.documentElement\.clientWidth/)
    }
  })
})
