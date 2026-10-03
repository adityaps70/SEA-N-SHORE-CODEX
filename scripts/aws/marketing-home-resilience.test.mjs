import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const homePath = new URL('../../src/app/(marketing)/page.tsx', import.meta.url)

test('public marketing home fails open when verified-user resolution throws', async () => {
  const source = await readFile(homePath, 'utf8')

  assert.match(
    source,
    /let\s+viewer\s*:\s*Awaited<ReturnType<typeof getVerifiedUser>>\s*\|\s*null\s*=\s*null/,
    'home must initialize viewer to anonymous before resolving an authenticated visitor',
  )
  assert.match(
    source,
    /try\s*\{[\s\S]*viewer\s*=\s*await\s+getVerifiedUser\(\)[\s\S]*\}\s*catch\s*\{/,
    'home must catch verified-user resolution failures so the public landing page can still render',
  )
  assert.match(
    source,
    /catch\s*\{[\s\S]*viewer\s*=\s*null[\s\S]*\}/,
    'home must fall back to anonymous visitor actions when auth/profile resolution is unavailable',
  )
})
