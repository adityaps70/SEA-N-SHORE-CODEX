import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { backgroundFetchRefused, isBackgroundFetch } from './background-fetch'

const headers = (values: Record<string, string>) => new Headers(values)

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : []
  })
}

describe('background fetches (owner 21 Nov)', () => {
  it('recognises Next.js router prefetches and browser speculative prefetches, and nothing else', () => {
    expect(isBackgroundFetch(headers({ rsc: '1' }))).toBe(true)
    expect(isBackgroundFetch(headers({ 'next-router-prefetch': '1' }))).toBe(true)
    expect(isBackgroundFetch(headers({ 'next-router-segment-prefetch': '/_tree' }))).toBe(true)
    expect(isBackgroundFetch(headers({ 'sec-purpose': 'prefetch;prerender' }))).toBe(true)
    expect(isBackgroundFetch(headers({ purpose: 'Prefetch' }))).toBe(true)
    // A person's own click: a plain navigation or download carries none of these.
    expect(isBackgroundFetch(headers({ accept: 'application/pdf', 'sec-fetch-mode': 'navigate' }))).toBe(false)
    expect(isBackgroundFetch(headers({}))).toBe(false)
  })

  it('answers a background request with an empty, uncached 204', async () => {
    const response = backgroundFetchRefused()
    expect(response.status).toBe(204)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.text()).toBe('')
  })

  it('no Next.js <Link> or IntentLink that prefetches points at a route handler under /api/ (it would run in the background)', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(join(process.cwd(), 'src'))) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/<(Link|IntentLink)\b/g)) {
        // The opening tag: up to the first '>' that is not part of an arrow function.
        const rest = text.slice(match.index, match.index + 800)
        const end = rest.search(/[^=]>/)
        const tag = end >= 0 ? rest.slice(0, end + 2) : rest
        if (!/\bhref=\{?\s*[`'"]\/api\//.test(tag)) continue
        // An explicit prefetch={false} on a plain <Link> never prefetches (IntentLink prefetches on hover regardless).
        if (match[1] === 'Link' && /\bprefetch=\{false\}/.test(tag)) continue
        offenders.push(`${file.replace(process.cwd() + '/', '')}:${text.slice(0, match.index).split('\n').length}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
