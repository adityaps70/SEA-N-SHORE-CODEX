import { describe, expect, it } from 'vitest'
import { learningEmail } from './learning-email'
import { learningKindOf, learningNotificationCopy } from './learning-notification-copy'

const emailId = '11111111-1111-4111-8111-111111111111'
const details = { courseTitle: 'SIRE 2.0 <Readiness>', courseSlug: 'sire-2-readiness' }

describe('learning notification words and email', () => {
  it('says what happened and links to the right place for every kind', () => {
    expect(learningNotificationCopy('enrolled', details)).toMatchObject({ path: '/learn/courses/sire-2-readiness/learn', action: 'Start learning' })
    expect(learningNotificationCopy('lessons_released', { ...details, count: 1, lessonId: 'l1', lessonTitle: 'Mooring' }).message)
      .toBe('“Mooring” is now available in SIRE 2.0 <Readiness>.')
    expect(learningNotificationCopy('lessons_released', { ...details, count: 3, lessonId: 'l1' })).toMatchObject({
      message: '3 new materials are now available in SIRE 2.0 <Readiness>.',
      path: '/learn/courses/sire-2-readiness/learn?lesson=l1',
    })
    expect(learningNotificationCopy('assignment_graded', { ...details, lessonTitle: 'Report', percentage: 55, passed: false }).message)
      .toBe('Your assignment “Report” in SIRE 2.0 <Readiness> was graded: 55%, not passed yet; you can submit again if attempts remain.')
    expect(learningNotificationCopy('certificate_issued', { ...details, verificationCode: 'ABC123' }).path).toBe('/certificates/ABC123')
    expect(learningNotificationCopy('course_approved', { ...details, studioCourseId: 'c1', revision: true }).message).toContain('approved your changes')
    expect(learningNotificationCopy('course_changes_requested', { ...details, studioCourseId: 'c2' }).path).toBe('/learn/studio/courses/c2/edit')
    expect(learningNotificationCopy('submissions_to_grade', { ...details, count: 1 }).message).toBe('1 assignment submission is waiting to be graded in SIRE 2.0 <Readiness>.')
    expect(learningNotificationCopy('submissions_to_grade', { ...details, count: 3, assignmentCount: 2, quizAnswerCount: 1 }).message)
      .toBe('2 assignment submissions and 1 quiz attempt with written answers are waiting to be graded in SIRE 2.0 <Readiness>.')
    expect(learningNotificationCopy('submissions_to_grade', { ...details, count: 2, assignmentCount: 0, quizAnswerCount: 2 }).message)
      .toBe('2 quiz attempts with written answers are waiting to be graded in SIRE 2.0 <Readiness>.')
    expect(learningKindOf('learning_certificate_issued')).toBe('certificate_issued')
    expect(learningKindOf('post_comment')).toBeNull()
    expect(learningKindOf('learning_something_else')).toBeNull()
  })

  it('builds an email with a button, escaped text and a one-click unsubscribe that names no one', () => {
    const email = learningEmail({ emailId, kind: 'enrolled', details, siteUrl: 'https://seanshore.in/' })

    expect(email.subject).toBe('You’re enrolled in SIRE 2.0 <Readiness>')
    expect(email.html).toContain('SIRE 2.0 &lt;Readiness&gt;')
    expect(email.html).not.toContain('<Readiness>')
    expect(email.html).toContain('href="https://seanshore.in/learn/courses/sire-2-readiness/learn"')
    expect(email.text).toContain(`Turn off learning emails: https://seanshore.in/email/learning/unsubscribe?token=${emailId}`)
    expect(email.headers).toEqual([
      { Name: 'List-Unsubscribe', Value: `<https://seanshore.in/api/email/learning/unsubscribe?token=${emailId}>` },
      { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
    ])
  })
})
