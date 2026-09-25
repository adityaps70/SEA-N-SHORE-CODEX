import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  expect(existsSync(path), `${path} should exist`).toBe(true)
  return readFileSync(path, 'utf8')
}

describe('LMS publish-as experience', () => {
  it('allows Studio access for active mentors or organization LMS managers', () => {
    const page = source('src/app/(app)/learn/studio/page.tsx')

    expect(page).toContain('listUserOrganizations')
    expect(page).toContain("role === 'lms_manager'")
    expect(page).toContain("role === 'administrator'")
    expect(page).toContain("role === 'owner'")
    expect(page).toContain('listOwnedCourses')
  })

  it('builds personal and organization publisher choices on course creation', () => {
    const page = source('src/app/(app)/learn/studio/courses/new/page.tsx')

    expect(page).toContain('getAccessContext')
    expect(page).toContain('getOwnProfileFromAurora')
    expect(page).toContain('listUserOrganizations')
    expect(page).toContain('buildCoursePublisherOptions')
    expect(page).toContain('publisherOptions')
  })

  it('shows Publish as with separate course verification and upgrade blockers', () => {
    const form = source('src/features/learning/components/course-form.tsx')

    expect(form).toContain('Publish as')
    expect(form).toContain('publisherOptions')
    expect(form).toContain('verification_required')
    expect(form).toContain('upgrade_required')
    expect(form).toContain('/plans')
    expect(form).toContain('publisherType')
  })

  it('loads organization-managed courses for editing without requiring personal mentor state', () => {
    const page = source('src/app/(app)/learn/studio/courses/[courseId]/edit/page.tsx')

    expect(page).toContain('getOwnedCourse')
    expect(page).toContain('course.publisherName')
    expect(page).not.toContain("redirect('/learn/teach')")
  })
})
