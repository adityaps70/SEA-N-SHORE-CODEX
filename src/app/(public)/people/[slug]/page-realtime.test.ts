import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Public profile realtime boundary', () => {
  it('mounts realtime only for authenticated public profile viewers so network invalidations can refresh canonical relationship state', () => {
    // Round H (H1): the provider moved from the profile page to the (public) layout, so moving
    // between Home, Learn and a profile keeps one socket. It is still mounted for signed-in viewers only.
    const layout = readFileSync('src/app/(public)/layout.tsx', 'utf8')
    const signedIn = layout.slice(layout.indexOf('if (viewer) {'), layout.indexOf('return (\n    <div className="min-h-screen bg-mist-50">'))

    expect(layout).toContain("import { MessagingRealtimeProvider } from '@/features/realtime/provider'")
    expect(signedIn).toContain('<MessagingRealtimeProvider viewerProfileId={viewer.id}>')
    const signedOut = layout.slice(layout.indexOf('return (\n    <div className="min-h-screen bg-mist-50">'))
    expect(signedOut).toContain('<PublicHeader />')
    expect(signedOut).not.toContain('MessagingRealtimeProvider')

    const page = readFileSync('src/app/(public)/people/[slug]/page.tsx', 'utf8')
    expect(page).not.toContain('<MessagingRealtimeProvider')
  })
})
