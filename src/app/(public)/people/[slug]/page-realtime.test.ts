import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Public profile realtime boundary', () => {
  it('mounts realtime only for authenticated public profile viewers so network invalidations can refresh canonical relationship state', () => {
    const source = readFileSync('src/app/(public)/people/[slug]/page.tsx', 'utf8')

    expect(source).toContain("import { MessagingRealtimeProvider } from '@/features/realtime/provider'")
    expect(source).toContain('const profileContent = (')
    expect(source).toContain('return viewer ? (')
    expect(source).toContain('<MessagingRealtimeProvider>{profileContent}</MessagingRealtimeProvider>')
    expect(source).toContain(') : profileContent')
  })
})
