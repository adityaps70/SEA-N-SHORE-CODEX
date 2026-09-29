import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A server component may render a client component, but it may not CALL a plain function (or read a
 * value) exported from a 'use client' module: Next.js replaces those exports with client references
 * on the server, and calling one throws at request time ("Attempted to call … from the server").
 * The round 8 public profile page did exactly that and returned 500 for every profile, while unit
 * tests (which don't apply the client boundary) passed. This scan keeps helpers used on the server
 * out of client modules.
 */
const root = process.cwd()
const SRC = path.join(root, 'src')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [full] : []
  })
}

function isClientModule(file: string) {
  return /^\s*(\/\/[^\n]*\n\s*)*['"]use client['"]/.test(readFileSync(file, 'utf8').slice(0, 300))
}

function resolveImport(from: string, spec: string) {
  const base = spec.startsWith('@/') ? path.join(SRC, spec.slice(2)) : spec.startsWith('.') ? path.resolve(path.dirname(from), spec) : null
  if (!base) return null
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

describe('server components never call exports of client modules', () => {
  it('only renders client components (PascalCase JSX) from server files, never calls their helper functions', () => {
    const offenders: string[] = []
    const importPattern = /import\s+(?!type\b)\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g
    for (const file of sourceFiles(SRC)) {
      if (isClientModule(file)) continue
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(importPattern)) {
        const target = resolveImport(file, match[2])
        if (!target || !isClientModule(target)) continue
        const names = match[1]
          .split(',')
          .map((part) => part.trim())
          .filter((part) => part && !part.startsWith('type '))
          .map((part) => part.split(/\s+as\s+/).pop()!.trim())
        for (const name of names) {
          if (/^[A-Z][a-z]/.test(name)) continue // components are rendered, which is allowed
          const called = new RegExp(`(?<![\\w.])${name}\\s*\\(`).test(source)
          if (called) offenders.push(`${path.relative(root, file)} calls ${name}() from ${path.relative(root, target)}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
