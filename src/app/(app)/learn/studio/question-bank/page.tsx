import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, Library } from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { canUsePlatformAdminAuthority } from '@/features/admin/mfa-gate'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { QuestionBankManager } from '@/features/learning/components/question-bank-manager'
import { questionBankRepository, type BankFilters } from '@/features/learning/question-bank-repository'
import { learningRepository } from '@/features/learning/repository'
import { DIFFICULTIES, QUESTION_TYPES, type Difficulty, type QuestionType } from '@/features/learning/quiz-model'

export const metadata: Metadata = { title: 'Question bank' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function one(value: string | string[] | undefined) {
  return typeof value === 'string' ? value.slice(0, 200) : ''
}

export default async function QuestionBankPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireAwsUser()
  const params = await searchParams
  const [mentorState, isAdmin] = await Promise.all([
    learningRepository.getMentorApplicationState(user.id),
    canUsePlatformAdminAuthority(user.id),
  ])
  const hasActiveMentor = mentorState.kind === 'mentor' && mentorState.mentorStatus === 'active'
  const trainerParam = one(params.trainer)
  const trainer = isAdmin && UUID.test(trainerParam) ? trainerParam : null
  if (!hasActiveMentor && !isAdmin) return redirect('/learn/teach')

  const adminBanks = isAdmin ? await questionBankRepository.listBanksForAdmin() : []

  // An administrator who is not a trainer picks a trainer's bank first.
  if ((!trainer && !hasActiveMentor) || (isAdmin && one(params.banks) === 'all')) {
    return (
      <div className="mx-auto w-full max-w-page-wide py-6 max-md:pt-0 sm:px-6 lg:px-8">
        <MobilePageBar backHref="/learn/studio" title="Question banks" />
        <h1 className="text-2xl font-bold text-navy-950 max-md:sr-only">Question banks</h1>
        <p className="mt-2 text-sm text-muted">Choose a trainer’s bank. Banks are private to their trainer and to Sea N Shore administrators.</p>
        <ul className="mt-5 divide-y divide-mist-100 rounded-2xl border border-mist-200 bg-white">
          {adminBanks.length === 0 ? <li className="p-5 text-sm text-muted">No trainer has a question bank yet.</li> : adminBanks.map((bank) => (
            <li key={bank.mentorId}>
              <Link href={`/learn/studio/question-bank?trainer=${bank.mentorId}`} className="flex min-h-12 items-center justify-between gap-3 px-5 py-3 text-sm font-semibold text-navy-950 hover:bg-mist-50">
                <span>{bank.trainerName}</span>
                <span className="text-muted">{bank.questions} {bank.questions === 1 ? 'question' : 'questions'}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const typeParam = one(params.type)
  const difficultyParam = one(params.difficulty)
  const filters: BankFilters = {
    type: (QUESTION_TYPES as readonly string[]).includes(typeParam) ? typeParam as QuestionType : null,
    difficulty: (DIFFICULTIES as readonly string[]).includes(difficultyParam) ? difficultyParam as Difficulty : null,
    topic: one(params.topic) || null,
    departmentKey: one(params.department) || null,
    roleKey: one(params.rank) || null,
    search: one(params.q) || null,
  }
  const bank = await questionBankRepository.getBank({ actorId: user.id, asAdminForMentorId: trainer }, filters)
  const filtered = Object.values(filters).some(Boolean)

  return (
    <div className="mx-auto w-full max-w-page-wide py-6 max-md:pt-0 sm:px-6 lg:px-8">
      <MobilePageBar backHref="/learn/studio" title="Question bank" />
      <Link href="/learn/studio" className="inline-flex items-center gap-2 text-sm font-bold text-ocean-700 underline-offset-2 transition-colors hover:text-navy-950 hover:underline max-md:hidden">
        <ArrowLeft className="size-4" aria-hidden="true" /> Learning Studio
      </Link>
      <section className="mt-5 rounded-[1.8rem] bg-navy-950 p-6 text-white shadow-[var(--shadow-card)] sm:p-8 max-md:mt-0 max-md:rounded-2xl max-md:p-5">
        <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-teal-200"><Library className="size-4" aria-hidden="true" /> Assessment library</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight max-md:text-2xl">{trainer ? `${bank.trainerName}’s question bank` : 'Question bank'}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70">Write questions once and add them to any quiz. Quizzes keep their own copy, so editing a bank question never changes a published quiz. Only you{trainer ? ' (the trainer)' : ''} and Sea N Shore administrators can see this bank.</p>
        <div className="mt-5 flex flex-wrap gap-3 text-sm font-semibold">
          <span className="rounded-full bg-white/10 px-3 py-1.5">{bank.total} {bank.total === 1 ? 'question' : 'questions'}</span>
          {bank.topics.length ? <span className="rounded-full bg-white/10 px-3 py-1.5">{bank.topics.length} {bank.topics.length === 1 ? 'topic' : 'topics'}</span> : null}
        </div>
      </section>
      {isAdmin && adminBanks.length > 0 ? (
        <p className="mt-3 text-xs text-muted">
          Administrator: <Link className="font-semibold text-teal-800 underline" href="/learn/studio/question-bank?banks=all">see every trainer’s bank</Link>
        </p>
      ) : null}
      <QuestionBankManager
        questions={bank.questions}
        topics={bank.topics}
        filters={{
          type: filters.type ?? '',
          difficulty: filters.difficulty ?? '',
          topic: filters.topic ?? '',
          department: filters.departmentKey ?? '',
          rank: filters.roleKey ?? '',
          q: filters.search ?? '',
        }}
        filtered={filtered}
        total={bank.total}
        trainerMentorId={trainer}
      />
    </div>
  )
}
