import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Public profile realtime boundary', () => {
  it('mounts realtime only for authenticated public profile viewers so network invalidations can refresh canonical relationship state', () => {
    // Round H (H1): the provider moved from the profile page to the (public) layout, so moving
    // between Home, Learn and a profile keeps one socket. It is still mounted for signed-in viewers only.
    // Round H (H6): signed-in viewers get the shared MemberChrome, which holds the provider.
    const layout = readFileSync('src/app/(public)/layout.tsx', 'utf8')
    const signedIn = layout.slice(layout.indexOf('if (viewer) {'), layout.indexOf('return (\n    <div className="group/shell min-h-screen bg-mist-50">'))
    const chrome = readFileSync('src/components/navigation/member-chrome.tsx', 'utf8')

    expect(chrome).toContain("import { MessagingRealtimeProvider } from '@/features/realtime/provider'")
    expect(chrome).toContain('<MessagingRealtimeProvider viewerProfileId={viewerId}>')
    expect(signedIn).toContain('<MemberChrome viewerId={viewer.id} chrome={chrome}>')
    const signedOut = layout.slice(layout.indexOf('return (\n    <div className="group/shell min-h-screen bg-mist-50">'))
    expect(signedOut).toContain('<PublicHeader />')
    expect(signedOut).not.toContain('MessagingRealtimeProvider')
    expect(signedOut).not.toContain('MemberChrome')

    const page = readFileSync('src/app/(public)/people/[slug]/page.tsx', 'utf8')
    expect(page).not.toContain('<MessagingRealtimeProvider')
  })
})
