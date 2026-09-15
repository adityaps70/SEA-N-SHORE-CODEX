import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')

describe('guarded SIRE 2.0 staging course seed', () => {
  it('targets the requested mentor and submits a media-backed course for review', () => {
    const workflow = read('.github/workflows/aws-learning-sire-course-seed.yml')
    const wrapper = read('scripts/aws/learning-sire-course-seed.cjs')
    const remote = read('scripts/aws/learning-sire-course-seed-remote.sh')

    expect(workflow).toContain('feat/aws-native-phase-0-1')
    expect(workflow).toContain('AWS Infrastructure CI')
    expect(workflow).toContain('310356785722')
    expect(workflow).toContain('seed-once')
    expect(wrapper).toContain('learning-sire-course-seed-remote.sh')

    expect(remote).toContain('adityaps700@gmail.com')
    expect(remote).toContain('sire-2-0-practical-vessel-inspection-readiness')
    expect(remote).toContain('SIRE 2.0: Practical Vessel Inspection Readiness')
    expect(remote).toContain('public.identity_accounts')
    expect(remote).toContain("ia.provider = 'cognito'")
    expect(remote).toContain('lower(ia.email)')
    expect(remote).not.toContain('lower(p.email)')
    expect(remote).toContain('learning_mentor_applications')
    expect(remote).toContain("status = 'approved'")
    expect(remote).toContain("m.status = 'active'")
    expect(remote).toContain("'submitted'")
    expect(remote).not.toMatch(/'published'/)
    expect(remote).toContain('sea-n-shore-staging-310356785722-media')
    expect(remote).toContain('course_thumbnail')
    expect(remote).toContain('downloadable_resource')
    expect(remote).toContain('https://www.ocimf.org/publications/video/videos/sire-2-0-animation')
    expect(remote).toContain('SIRE_COURSE_SEED_VERIFIED=true')
  })
})
