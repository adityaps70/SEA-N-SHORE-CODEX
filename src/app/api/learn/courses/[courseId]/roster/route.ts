import { canUsePlatformAdminAuthority } from '@/features/admin/mfa-gate'
import { getVerifiedUser } from '@/features/auth/queries'
import { rosterToCsv } from '@/features/learning/course-roster'
import { courseRosterRepository } from '@/features/learning/course-roster-repository'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function textError(message: string, status: number) {
  return new Response(message, { status, headers: { 'Cache-Control': 'private, no-store', 'Content-Type': 'text/plain; charset=utf-8' } })
}

/** Round C (C1): CSV of a course's learners, for its own trainers and platform admins. Every export is audited. */
export async function GET(_request: Request, { params }: { params: Promise<{ courseId: string }> }) {
  const user = await getVerifiedUser()
  if (!user) return textError('Sign in to export your learners.', 401)
  const { courseId } = await params
  if (!UUID.test(courseId)) return textError('Not found', 404)

  try {
    const allCourses = await canUsePlatformAdminAuthority(user.id)
    const { course, learners } = await courseRosterRepository.exportRoster({ actorId: user.id, courseId, allCourses })
    const date = new Date().toISOString().slice(0, 10)
    const name = course.slug.replace(/[^a-z0-9-]/gi, '').slice(0, 60) || 'course'
    return new Response(rosterToCsv(learners), {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="sea-n-shore-learners-${name}-${date}.csv"`,
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'course_not_found') return textError('Not found', 404)
    console.error('[course_roster_export_failed]', { error: error instanceof Error ? error.name : 'unknown' })
    return textError('The export could not be created. Please try again.', 500)
  }
}
