import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { backgroundFetchRefused, isBackgroundFetch } from './background-fetch'

const headers = (values: Record<string, string>) => new Headers(values)

function sourceFiles(dir: string, extension = /\.tsx$/): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path, extension)
    return extension.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length

/** Every opening <Link> / <IntentLink> tag in a source text, with the line it starts on. */
function linkTags(text: string) {
  return [...text.matchAll(/<(Link|IntentLink)\b/g)].map((match) => {
    // The opening tag: up to the first '>' that is not part of an arrow function.
    const rest = text.slice(match.index, match.index + 800)
    const end = rest.search(/[^=]>/)
    return { name: match[1], tag: end >= 0 ? rest.slice(0, end + 2) : rest, line: lineOf(text, match.index) }
  })
}

/**
 * Owner (21 Nov): pages that change something while they render. The conversation page marks the conversation read;
 * Home records a visit metric. A full prefetch renders the page in the background, so neither may ever be fully
 * prefetched. (The default and IntentLink's hover prefetch fetch only the shell down to the nearest loading boundary.)
 */
const RENDER_SIDE_EFFECT_HREF = /\bhref=\{?\s*[`'"]\/(?:messages(?=[/?#`'"$])|home(?=[?#`'"]))/
// `prefetch={true}`, or the bare `prefetch` attribute, which JSX reads as true.
const FULL_PREFETCH_PROP = /\bprefetch(?:=\{\s*true\s*\}|(?=[\s/>]))/

/** Lines of the <Link>/<IntentLink> tags that fully prefetch the inbox or Home. */
function fullPrefetchLinksToRenderSideEffects(text: string) {
  return linkTags(text).filter(({ tag }) => RENDER_SIDE_EFFECT_HREF.test(tag) && FULL_PREFETCH_PROP.test(tag)).map(({ line }) => line)
}

/** Every `x.prefetch(...)` call in a source text: its argument text (up to the matching parenthesis) and line. */
function prefetchCalls(text: string) {
  return [...text.matchAll(/\.prefetch\s*\(/g)].map((match) => {
    const start = match.index + match[0].length
    let depth = 1
    let end = start
    while (end < text.length && end < start + 600 && depth > 0) {
      if (text[end] === '(') depth += 1
      if (text[end] === ')') depth -= 1
      end += 1
    }
    return { args: text.slice(start, end - 1), line: lineOf(text, match.index) }
  })
}

const FULL_PREFETCH_KIND = /PrefetchKind\s*(?:\.\s*FULL\b|\[\s*['"`]FULL['"`]\s*\])|\bkind\s*:\s*['"`]full['"`]/
const RENDER_SIDE_EFFECT_TARGET = /^\s*[`'"]\/(?:messages(?=[/?#`'"$])|home(?=[?#`'"]))/

/** Lines of `router.prefetch` calls that ask for a full prefetch, or name any kind for the inbox or Home. */
function riskyRouterPrefetches(text: string) {
  return prefetchCalls(text)
    .filter(({ args }) => FULL_PREFETCH_KIND.test(args) || (RENDER_SIDE_EFFECT_TARGET.test(args) && /\bkind\b|PrefetchKind/.test(args)))
    .map(({ line }) => line)
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

describe('the inbox and Home are never fully prefetched (owner 21 Nov)', () => {
  const relative = (file: string) => file.replace(process.cwd() + '/', '')

  it('the link matcher flags a full prefetch of the inbox or Home, and nothing else', () => {
    // Each of these must be flagged, so the guard below can never silently match nothing.
    expect(fullPrefetchLinksToRenderSideEffects('<Link href="/messages" prefetch={true}>Inbox</Link>')).toEqual([1])
    expect(fullPrefetchLinksToRenderSideEffects('<IntentLink\n  href={`/messages/${id}`}\n  prefetch\n>Open</IntentLink>')).toEqual([1])
    expect(fullPrefetchLinksToRenderSideEffects("<Link prefetch={ true } href='/home'>Home</Link>")).toEqual([1])
    expect(fullPrefetchLinksToRenderSideEffects('<IntentLink href="/home?compose=update" prefetch={true} />')).toEqual([1])
    expect(fullPrefetchLinksToRenderSideEffects('<Link href="/messages?with=crew" prefetch>Write</Link>')).toEqual([1])
    // Allowed: the default, IntentLink's hover prefetch, prefetch={false}, and other pages.
    expect(fullPrefetchLinksToRenderSideEffects([
      '<Link href="/messages">Inbox</Link>',
      '<IntentLink href={`/messages/${id}`} onClick={() => close()}>Open</IntentLink>',
      '<Link href="/home" prefetch={false}>Home</Link>',
      '<Link href="/home" prefetch="auto">Home</Link>',
      '<Link href="/homeport" prefetch={true}>Homeport</Link>',
      '<Link href="/messaging-help" prefetch>Help</Link>',
      '<Link href="/jobs" prefetch={true}>Jobs</Link>',
    ].join('\n'))).toEqual([])
  })

  it('no <Link> or IntentLink to /messages, /messages/... or /home sets prefetch={true}', () => {
    const offenders: string[] = []
    let linksSeen = 0
    for (const file of sourceFiles(join(process.cwd(), 'src'))) {
      const text = readFileSync(file, 'utf8')
      linksSeen += linkTags(text).filter(({ tag }) => RENDER_SIDE_EFFECT_HREF.test(tag)).length
      for (const line of fullPrefetchLinksToRenderSideEffects(text)) offenders.push(`${relative(file)}:${line}`)
    }
    // The scan really reads the app's links to these pages (there are several today).
    expect(linksSeen).toBeGreaterThan(0)
    expect(offenders).toEqual([])
  })

  it('the router.prefetch matcher flags a full kind anywhere and any explicit kind for the inbox or Home', () => {
    // Each of these must be flagged, so the guard below can never silently match nothing.
    expect(riskyRouterPrefetches("router.prefetch('/jobs', { kind: PrefetchKind.FULL })")).toEqual([1])
    expect(riskyRouterPrefetches('router.prefetch(href, { kind: "full" })')).toEqual([1])
    expect(riskyRouterPrefetches("appRouter.prefetch(\n  `/courses/${slug}`,\n  { kind: PrefetchKind['FULL'] },\n)")).toEqual([1])
    expect(riskyRouterPrefetches("router.prefetch('/messages', { kind: PrefetchKind.AUTO })")).toEqual([1])
    expect(riskyRouterPrefetches('router.prefetch(`/messages/${id}`, { kind: "temporary" })')).toEqual([1])
    expect(riskyRouterPrefetches("router.prefetch('/home?category=jobs', { kind })")).toEqual([1])
    // Allowed: a prefetch without a kind (the default), and a non-full kind for other pages.
    expect(riskyRouterPrefetches([
      "router.prefetch('/messages')",
      'router.prefetch(`/messages/${id}`, { onInvalidate: () => refresh() })',
      'router.prefetch(key)',
      "router.prefetch('/home')",
      "router.prefetch('/jobs', { kind: PrefetchKind.AUTO })",
      "router.prefetch('/homeport', { kind: PrefetchKind.AUTO })",
    ].join('\n'))).toEqual([])
  })

  it('no router.prefetch call asks for a full prefetch, or names any kind for /messages or /home', () => {
    const offenders: string[] = []
    let callsSeen = 0
    for (const file of sourceFiles(join(process.cwd(), 'src'), /\.tsx?$/)) {
      const text = readFileSync(file, 'utf8')
      callsSeen += prefetchCalls(text).length
      for (const line of riskyRouterPrefetches(text)) offenders.push(`${relative(file)}:${line}`)
    }
    // The scan really reads the app's prefetch calls (IntentLink's hover prefetch is one).
    expect(callsSeen).toBeGreaterThan(0)
    expect(offenders).toEqual([])
  })
})
