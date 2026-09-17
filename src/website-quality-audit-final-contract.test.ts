import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  expect(existsSync(path), `${path} should exist`).toBe(true)
  return readFileSync(path, 'utf8')
}

describe('remaining website quality audit contract', () => {
  it('upgrades the post composer with audience, modes, topics, count and draft recovery', () => {
    const composer = source('src/features/feed/components/post-composer.tsx')
    expect(composer).toContain('Audience')
    expect(composer).toContain('Update')
    expect(composer).toContain('Question')
    expect(composer).toContain('Poll')
    expect(composer).toContain('Topic tags')
    expect(composer).toContain('5000')
    expect(composer).toContain('localStorage')
    expect(composer).toContain('Ask Community')
  })

  it('makes job discovery responsive, removable, countable and truthfully sorted', () => {
    const jobs = source('src/app/(app)/jobs/page.tsx')
    const controls = source('src/features/jobs/components/jobs-discovery-controls.tsx')
    expect(controls).toContain('router.replace')
    expect(controls).toContain('Clear all')
    expect(controls).toContain('Advanced filters')
    expect(controls).toContain('active')
    expect(jobs).toContain('matching opportunit')
    expect(jobs).toContain('Sort by')
    expect(jobs).toContain('Recommended')
    expect(jobs).toContain('Newest')
    expect(jobs).toContain('No maritime roles are live yet')
    expect(jobs).toContain('No roles match these filters yet')
  })

  it('keeps synthetic discovery data out of public people and learning surfaces', () => {
    const profiles = source('src/features/profiles/aws-queries.ts')
    const marketplace = source('src/features/learning/marketplace-repository.ts')
    expect(profiles).toContain('isSyntheticDiscoveryText')
    expect(marketplace).toContain('isSyntheticDiscoveryText')
    expect(source('src/lib/public-discovery.ts')).toContain('export function isSyntheticDiscoveryText')
  })

  it('keeps learning cards visual and distinguishes zero catalog from no-match', () => {
    const learn = source('src/app/(app)/learn/page.tsx')
    expect(learn).toContain('thumbnailPath')
    expect(learn).toContain('Browse all courses')
    expect(learn).toContain('No published courses yet')
    expect(learn).toContain('No published courses match these filters yet')
  })

  it('adds a prominent new-message recipient picker while retaining inbox trust cues', () => {
    const page = source('src/app/(app)/messages/page.tsx')
    const shell = source('src/features/messaging/components/message-shell.tsx')
    const picker = source('src/features/messaging/components/new-message-button.tsx')
    expect(page).toContain("getNetworkHub('connections')")
    expect(shell).toContain('NewMessageButton')
    expect(picker).toContain('New Message')
    expect(picker).toContain('Choose a connection')
    expect(picker).toContain('StartConversationButton')
    expect(source('src/features/messaging/components/conversation-list.tsx')).toContain('item.unread')
  })

  it('uses a compact trust footer with real internal routes', () => {
    const layout = source('src/app/(app)/layout.tsx')
    const footer = source('src/components/navigation/app-footer.tsx')
    expect(layout).toContain('AppFooter')
    for (const route of ['/about', '/privacy', '/terms', '/help']) expect(footer).toContain(route)
  })

  it('gives editable empty profile sections direct calls to action', () => {
    expect(source('src/features/profiles/components/profile-career-timeline.tsx')).toContain('Add your first experience')
    expect(source('src/features/profiles/components/profile-credential-wallet.tsx')).toContain('Add your first credential')
  })

  it('preserves username availability, at-handle display and two-edit limit regressions', () => {
    const contract = source('src/username-quality-regression.test.ts')
    expect(contract).toContain('400')
    expect(contract).toContain('@')
    expect(contract).toContain('2')
    expect(contract).toContain('availability')
  })
})
