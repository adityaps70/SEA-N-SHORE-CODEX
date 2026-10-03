import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('CI-sensitive transitive packages are pinned to published npm versions', async () => {
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))

  assert.equal(pkg.overrides?.ignore, '7.0.10')
  assert.equal(pkg.overrides?.['electron-to-chromium'], '1.5.439')
})
