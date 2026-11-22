import { canUsePlatformAdminAuthority } from '@/features/admin/mfa-gate'
import { getVerifiedUser } from '@/features/auth/queries'
import { questionBankRepository, QuestionBankError } from '@/features/learning/question-bank-repository'
import { questionsToCsv } from '@/features/learning/quiz-csv'
import { backgroundFetchRefused, isBackgroundFetch } from '@/lib/http/background-fetch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function textError(message: string, status: number) {
  return new Response(message, { status, headers: { 'Cache-Control': 'private, no-store', 'Content-Type': 'text/plain; charset=utf-8' } })
}

/** CSV export of a question bank: the trainer's own, or (platform admins) the trainer named by ?trainer=. */
export async function GET(request: Request) {
  // Owner (21 Nov): a prefetch never builds a question bank export; only a person's own download does.
  if (isBackgroundFetch(request.headers)) return backgroundFetchRefused()
  const user = await getVerifiedUser()
  if (!user) return textError('Sign in to export your question bank.', 401)
  const trainer = new URL(request.url).searchParams.get('trainer')
  if (trainer && (!UUID.test(trainer) || !(await canUsePlatformAdminAuthority(user.id)))) return textError('Not found', 404)

  try {
    const questions = await questionBankRepository.listQuestions({ actorId: user.id, asAdminForMentorId: trainer || null })
    const date = new Date().toISOString().slice(0, 10)
    return new Response(questionsToCsv(questions), {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="sea-n-shore-question-bank-${date}.csv"`,
      },
    })
  } catch (error) {
    if (error instanceof QuestionBankError && error.message === 'question_bank_forbidden') return textError('Only verified trainers can export a question bank.', 403)
    console.error('[question_bank_export_failed]', { error: error instanceof Error ? error.name : 'unknown' })
    return textError('The export could not be created. Please try again.', 500)
  }
}
