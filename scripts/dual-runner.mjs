/**
 * Test API for script tests that run under both runners: Vitest (`npm test`, which sets
 * VITEST) and `node --test scripts/**`. Under Vitest it is Vitest itself; under node it maps
 * describe/it/test to node:test. `expect` is Vitest's either way (it works without the Vitest
 * runner), so the assertions are identical in both.
 */
// A variable specifier keeps Vite (jsdom environment) from trying to bundle node:test.
const NODE_TEST = 'node:test'
const api = process.env.VITEST ? await import('vitest') : await import(/* @vite-ignore */ NODE_TEST)

export const describe = api.describe
export const it = api.it
export const test = api.test
export { expect } from 'vitest'
