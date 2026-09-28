import { describe, expect, it } from 'vitest'
import { courseOpenToNewLearnersSql, learnerCourseAccessSql, publishedCourseVisibilitySql } from './course-publication'

describe('course visibility for learners', () => {
  it('keeps enrolled learners’ access when the course was removed with its owner’s account or the plan ended', () => {
    const sql = learnerCourseAccessSql()
    expect(sql).toContain(publishedCourseVisibilitySql())
    expect(sql).toContain('or course.removed_at is not null')
    expect(sql).not.toContain('hidden_for_plan_at')
  })

  it('opens a course to new learners and buyers only when it is not removed and the owner’s plan is live', () => {
    const sql = courseOpenToNewLearnersSql()
    expect(sql).toContain("course.status = 'published'")
    expect(sql).toContain('course.removed_at is null')
    expect(sql).toContain('course.hidden_for_plan_at is null')
    expect(sql).toContain("capability = 'course.publish'")
  })
})
