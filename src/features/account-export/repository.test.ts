import { describe, expect, it, vi } from 'vitest'
import { createAccountExportRepository } from './repository'

const profileId = '11111111-1111-4111-8111-111111111111'

describe('account export repository', () => {
  it('collects the user profile, authored content, network, messaging, jobs, events, and learning data with one bound profile id', async () => {
    const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
      expect(values).toEqual([profileId])
      return [{
        export_data: {
          profile: { id: profileId, full_name: 'Captain Example' },
          posts: [{ id: 'post-1' }],
          connections: [{ id: 'connection-1' }],
          sentMessages: [{ id: 'message-1', body: 'Hello' }],
          jobApplications: [{ id: 'application-1' }],
          learningEnrollments: [{ id: 'enrollment-1' }],
        },
      }]
    })

    const repository = createAccountExportRepository({ query })
    const result = await repository.exportAccountData(profileId)

    expect(result.profile).toEqual({ id: profileId, full_name: 'Captain Example' })
    expect(result.posts).toHaveLength(1)
    expect(result.connections).toHaveLength(1)
    expect(result.sentMessages).toHaveLength(1)
    expect(result.jobApplications).toHaveLength(1)
    expect(result.learningEnrollments).toHaveLength(1)

    const sql = vi.mocked(query).mock.calls[0]?.[0] ?? ''
    expect(sql).toMatch(/from public\.profiles/i)
    expect(sql).toMatch(/from public\.posts/i)
    expect(sql).toMatch(/from public\.post_media/i)
    expect(sql).toMatch(/from public\.post_comments/i)
    expect(sql).toMatch(/from public\.connections/i)
    expect(sql).toMatch(/from public\.follows/i)
    expect(sql).toMatch(/from public\.messages/i)
    expect(sql).toMatch(/sender_profile_id = \$1/i)
    expect(sql).toMatch(/from public\.job_applications/i)
    expect(sql).toMatch(/from public\.events/i)
    expect(sql).toMatch(/from public\.learning_enrollments/i)
    expect(sql).toMatch(/from public\.learning_quiz_attempts/i)
    expect(sql).toMatch(/from public\.learning_assignment_attempts/i)
    expect(sql).toMatch(/from public\.learning_courses/i)
    expect(sql).toMatch(/from public\.company_members/i)
    expect(sql).toMatch(/from public\.organization_applications/i)
  })

  it('chunks the top-level JSON object so PostgreSQL never receives more than 100 function arguments', async () => {
    const query = vi.fn(async () => [{ export_data: {} }])
    const repository = createAccountExportRepository({ query })

    await repository.exportAccountData(profileId)

    const sql = vi.mocked(query).mock.calls[0]?.[0] ?? ''
    expect(sql).toMatch(/jsonb_build_object\([\s\S]*\)\s*\|\|\s*jsonb_build_object\(/i)
  })

  it('returns a stable empty export shape when the database returns no row', async () => {
    const query = vi.fn(async () => [])
    const repository = createAccountExportRepository({ query })

    await expect(repository.exportAccountData(profileId)).resolves.toEqual({})
  })
})
