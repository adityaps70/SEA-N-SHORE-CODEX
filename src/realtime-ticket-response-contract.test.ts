import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readRepositoryFile(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('realtime ticket response contract', () => {
  it('uses one canonical webSocketUrl field from the API through browser consumers', () => {
    const route = readRepositoryFile('src/app/api/realtime/ticket/route.ts')
    const provider = readRepositoryFile('src/features/realtime/provider.tsx')
    const stagingE2e = readRepositoryFile('scripts/aws/realtime-staging-e2e.mjs')

    expect(route).toContain('webSocketUrl: getRealtimeWebsocketUrl()')
    expect(route).not.toContain('websocketUrl:')

    expect(provider).toContain("'webSocketUrl' in payload")
    expect(provider).toContain('payload.webSocketUrl')

    expect(stagingE2e).toContain('payload.webSocketUrl')
    expect(stagingE2e).not.toContain('payload.websocketUrl')
  })
})
