import { describe, expect, it } from 'vitest'
import { createAccountExportZip } from './zip'

describe('account export ZIP', () => {
  it('packages the full JSON export together with spreadsheet-friendly CSV files and a README', () => {
    const payload = {
      schemaVersion: 1,
      generatedAt: '2026-09-23T07:15:00.000Z',
      account: {
        profileId: '11111111-1111-4111-8111-111111111111',
        email: 'captain@example.com',
      },
      data: {
        profile: {
          full_name: 'Captain Example',
          headline: 'Master Mariner',
        },
        posts: [
          {
            id: 'post-1',
            body: 'Safety first',
          },
        ],
        connections: [
          {
            id: 'connection-1',
            status: 'accepted',
          },
        ],
      },
    }

    const archive = createAccountExportZip(payload)
    const raw = Buffer.from(archive)
    const readable = raw.toString('utf8')

    expect(Array.from(raw.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04])
    expect(readable).toContain('README.txt')
    expect(readable).toContain('data.json')
    expect(readable).toContain('csv/profile.csv')
    expect(readable).toContain('csv/posts.csv')
    expect(readable).toContain('csv/connections.csv')
    expect(readable).toContain('Captain Example')
    expect(readable).toContain('Safety first')
  })

  it('does not create meaningless CSV files for null or empty sections', () => {
    const archive = createAccountExportZip({
      schemaVersion: 1,
      generatedAt: '2026-09-23T07:15:00.000Z',
      account: {
        profileId: '11111111-1111-4111-8111-111111111111',
        email: null,
      },
      data: {
        profile: null,
        posts: [],
      },
    })

    const readable = Buffer.from(archive).toString('utf8')

    expect(readable).not.toContain('csv/profile.csv')
    expect(readable).not.toContain('csv/posts.csv')
    expect(readable).toContain('data.json')
  })
})
