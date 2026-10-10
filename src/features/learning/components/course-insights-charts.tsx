import type { ReactNode } from 'react'
import { BarChart3, TriangleAlert } from 'lucide-react'
import { formatMoney } from '@/features/payments/currency'
import type {
  CourseLessonFunnel,
  CourseMonthlyTrend,
  CurrencyRevenue,
  QuizDifficulty,
} from '../mentor-course-insights-repository'

/*
 * Learning Studio course insight charts. Plain HTML/CSS marks (no chart library), server-rendered.
 * Colour roles (validated with the dataviz palette checks on the white card surface):
 * - funnel: ordinal ocean ramp, reached #3aa6c6 (light) -> completed #075e82 (dark);
 * - single-series bars: ocean #09739a;
 * - revenue stack: trainer net #09739a, Sea N Shore fee #c99332, refunded #86a2ba (de-emphasis gray).
 * Light marks sit under 3:1 contrast, so every chart carries direct labels and a table view.
 * Text always uses text tokens, never a series colour.
 */

const COLOR = {
  reached: '#3aa6c6',
  completed: '#075e82',
  series: '#09739a',
  fee: '#c99332',
  refunded: '#86a2ba',
} as const

export function monthLabel(month: string, style: 'short' | 'long' = 'short') {
  const date = new Date(`${month}-01T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return month
  // en-US keeps every short month to three letters ("Sep", not "Sept"), so axis labels stay even.
  return new Intl.DateTimeFormat('en-US', style === 'short'
    ? { month: 'short', timeZone: 'UTC' }
    : { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date)
}

function ChartCard({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <figure className="m-0 min-w-0 rounded-[1.5rem] border border-mist-200 bg-white p-4 shadow-[var(--shadow-card)] sm:p-6">
      <figcaption>
        <h3 className="text-lg font-bold text-navy-950">{title}</h3>
        {description ? <p className="mt-1 text-sm leading-6 text-muted">{description}</p> : null}
      </figcaption>
      <div className="mt-5">{children}</div>
    </figure>
  )
}

function EmptyChart({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-mist-200 bg-mist-50 px-4 py-8 text-center">
      <BarChart3 className="mx-auto size-6 text-navy-300" aria-hidden="true" />
      <p className="mt-2 text-sm font-semibold text-navy-700">{children}</p>
    </div>
  )
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <li className="inline-flex items-center gap-2">
      <span className="inline-block size-3 rounded-[3px]" style={{ backgroundColor: color }} aria-hidden="true" />
      {label}
    </li>
  )
}

function Legend({ items }: { items: Array<{ color: string; label: string }> }) {
  return (
    <ul className="mb-4 flex flex-wrap gap-x-5 gap-y-1 text-xs font-semibold text-navy-700" aria-label="Legend">
      {items.map((item) => <LegendItem key={item.label} {...item} />)}
    </ul>
  )
}

function TableView({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <details className="group mt-5 rounded-xl border border-mist-100 bg-mist-50/60">
      <summary className="px-4 py-2.5 text-sm font-bold text-ocean-700">View as table</summary>
      <div className="overflow-x-auto px-4 pb-4">
        <table className="w-full min-w-[20rem] border-collapse text-left text-sm tabular-nums">
          <caption className="sr-only">{caption}</caption>
          {children}
        </table>
      </div>
    </details>
  )
}

const th = 'border-b border-mist-200 py-2 pr-4 text-xs font-bold uppercase tracking-[0.08em] text-muted'
const td = 'border-b border-mist-100 py-2 pr-4 text-navy-900'

/** A bar's width as a percentage, keeping any non-zero value visible as at least a sliver. */
function barWidth(value: number, max: number) {
  if (value <= 0 || max <= 0) return '0%'
  return `${Math.max(1.5, Math.min(100, (value / max) * 100))}%`
}

// ---------------------------------------------------------------------------------------------
// 1. Lesson drop-off

export function LessonDropOffChart({ funnel }: { funnel: CourseLessonFunnel }) {
  const { learnerCount, lessons } = funnel
  const description = 'How many current learners opened and finished each published material, in curriculum order. Revoked enrolments are left out.'
  if (!lessons.length) {
    return <ChartCard title="Lesson drop-off" description={description}><EmptyChart>Publish materials to see where learners drop off.</EmptyChart></ChartCard>
  }
  if (learnerCount === 0) {
    return <ChartCard title="Lesson drop-off" description={description}><EmptyChart>No learners are enrolled yet.</EmptyChart></ChartCard>
  }
  const biggestDrop = lessons.slice(1).reduce<{ index: number; drop: number } | null>((best, lesson, index) => {
    const drop = lessons[index]!.reachedCount - lesson.reachedCount
    return drop > 0 && (!best || drop > best.drop) ? { index: index + 1, drop } : best
  }, null)
  const first = lessons[0]!
  const last = lessons[lessons.length - 1]!
  const summary = `Of ${learnerCount} learners, ${first.reachedCount} (${first.reachedPercent}%) reached the first material and ${last.completedCount} (${last.completedPercent}%) completed the last.`
    + (biggestDrop ? ` The largest drop is before “${lessons[biggestDrop.index]!.title}”, with ${biggestDrop.drop} fewer learners.` : '')

  return (
    <ChartCard title="Lesson drop-off" description={description}>
      <p className="mb-4 text-sm font-semibold text-navy-900">{summary}</p>
      <Legend items={[{ color: COLOR.reached, label: 'Reached' }, { color: COLOR.completed, label: 'Completed' }]} />
      <ol className="space-y-4" aria-hidden="true">
        {lessons.map((lesson) => (
          <li key={lesson.lessonId} className="min-w-0">
            <p className="min-w-0 break-words text-sm font-semibold text-navy-950">
              <span className="text-muted">{lesson.position}.</span> {lesson.title}
            </p>
            <div className="relative mt-1.5 h-3.5 rounded-r-[4px] bg-mist-100">
              <div className="absolute inset-y-0 left-0 rounded-r-[4px]" style={{ width: barWidth(lesson.reachedCount, learnerCount), backgroundColor: COLOR.reached }} />
              <div className="absolute inset-y-0 left-0 rounded-r-[4px]" style={{ width: barWidth(lesson.completedCount, learnerCount), backgroundColor: COLOR.completed }} />
            </div>
            <p className="mt-1 text-xs text-muted">
              <span className="font-semibold text-navy-700 tabular-nums">{lesson.reachedPercent}% reached · {lesson.completedPercent}% done</span>
              {' '}· {lesson.reachedCount} reached, {lesson.completedCount} completed · {lesson.sectionTitle}
            </p>
          </li>
        ))}
      </ol>
      <TableView caption={`Lesson drop-off for ${learnerCount} learners`}>
        <thead>
          <tr><th scope="col" className={th}>Material</th><th scope="col" className={th}>Reached</th><th scope="col" className={th}>Completed</th></tr>
        </thead>
        <tbody>
          {lessons.map((lesson) => (
            <tr key={lesson.lessonId}>
              <th scope="row" className={`${td} font-semibold`}>{lesson.position}. {lesson.title}</th>
              <td className={td}>{lesson.reachedCount} ({lesson.reachedPercent}%)</td>
              <td className={td}>{lesson.completedCount} ({lesson.completedPercent}%)</td>
            </tr>
          ))}
        </tbody>
      </TableView>
    </ChartCard>
  )
}

// ---------------------------------------------------------------------------------------------
// 2. Quiz item difficulty

function questionTypeLabel(type: string) {
  switch (type) {
    case 'single_choice': return 'Single choice'
    case 'multiple_choice': return 'Multiple choice'
    case 'true_false': return 'True / false'
    case 'fill_blank': return 'Fill in the blank'
    case 'subjective': return 'Written answer'
    default: return type
  }
}

export function QuizDifficultyChart({ quizzes }: { quizzes: QuizDifficulty[] }) {
  const description = 'Share of submitted answers marked correct, per question. Written answers count their graded marks; answers awaiting grading are left out.'
  if (!quizzes.length || quizzes.every((quiz) => !quiz.questions.length)) {
    return <ChartCard title="Quiz question difficulty" description={description}><EmptyChart>This course has no quiz questions yet.</EmptyChart></ChartCard>
  }
  return (
    <ChartCard title="Quiz question difficulty" description={description}>
      <div className="space-y-7">
        {quizzes.map((quiz) => {
          const hardest = quiz.questions.filter((question) => question.isHardest)
          const answered = quiz.questions.filter((question) => question.correctPercent !== null)
          return (
            <section key={quiz.quizId} aria-label={`Quiz: ${quiz.lessonTitle}`}>
              <h4 className="text-sm font-bold uppercase tracking-[0.1em] text-teal-700">{quiz.lessonTitle}</h4>
              <p className="sr-only">
                {answered.length
                  ? `${answered.length} of ${quiz.questions.length} questions have answers.`
                    + (hardest.length ? ` Hardest: ${hardest.map((question) => `question ${question.position} at ${question.correctPercent}% correct`).join(', ')}.` : '')
                  : 'Not enough answers yet.'}
              </p>
              <ol className="mt-3 space-y-4">
                {quiz.questions.map((question) => (
                  <li key={question.questionId} className="min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 break-words text-sm font-semibold text-navy-950">
                        <span className="text-muted">Q{question.position}.</span> {question.prompt}
                      </p>
                      {question.isHardest ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-mist-100 px-2 py-0.5 text-xs font-bold text-navy-900">
                          <TriangleAlert className="size-3.5" aria-hidden="true" /> Hardest
                        </span>
                      ) : null}
                    </div>
                    {question.correctPercent === null ? (
                      <p className="mt-1.5 text-xs font-semibold text-muted">
                        Not enough answers yet{question.pendingCount ? ` · ${question.pendingCount} awaiting grading` : ''}
                      </p>
                    ) : (
                      <>
                        <div className="mt-1.5 flex items-center gap-3" aria-hidden="true">
                          <div className="relative h-3 min-w-0 flex-1 rounded-r-[4px] bg-mist-100">
                            <div className="absolute inset-y-0 left-0 rounded-r-[4px]" style={{ width: barWidth(question.correctPercent, 100), backgroundColor: COLOR.series }} />
                          </div>
                          <span className="w-11 shrink-0 text-right text-sm font-bold text-navy-950 tabular-nums">{question.correctPercent}%</span>
                        </div>
                        <p className="mt-1 text-xs text-muted">
                          <span className="sr-only">{question.correctPercent}% correct. </span>
                          {questionTypeLabel(question.questionType)} · {question.answerCount} {question.answerCount === 1 ? 'answer' : 'answers'}
                          {question.pendingCount ? ` · ${question.pendingCount} awaiting grading` : ''}
                        </p>
                      </>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )
        })}
      </div>
    </ChartCard>
  )
}

// ---------------------------------------------------------------------------------------------
// 3. Enrolments and revenue over time

function ColumnChart({ columns, label }: {
  label: string
  columns: Array<{ key: string; axisLabel: string; tooltip: string; segments: Array<{ value: number; color: string }>; capLabel?: string }>
}) {
  const max = Math.max(0, ...columns.map((column) => column.segments.reduce((sum, segment) => sum + segment.value, 0)))
  return (
    <div aria-hidden="true" data-chart={label}>
      <div className="flex h-40 items-end gap-[2px] border-b border-mist-200 sm:gap-1.5">
        {columns.map((column) => {
          const total = column.segments.reduce((sum, segment) => sum + segment.value, 0)
          return (
            <div key={column.key} className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end">
              {column.capLabel && total > 0 ? (
                <span className="mb-1 text-[10px] font-bold leading-none text-navy-900 tabular-nums">{column.capLabel}</span>
              ) : null}
              <div className="flex w-full max-w-6 flex-col-reverse gap-[2px]" style={{ height: max > 0 ? `${(total / max) * 85}%` : '0%' }}>
                {column.segments.filter((segment) => segment.value > 0).map((segment, index, visible) => (
                  <div
                    key={index}
                    className={index === visible.length - 1 ? 'rounded-t-[4px]' : ''}
                    style={{ flexGrow: segment.value, flexBasis: 0, minHeight: 2, backgroundColor: segment.color }}
                  />
                ))}
              </div>
              <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden w-max max-w-[12rem] -translate-x-1/2 rounded-lg bg-navy-950 px-2.5 py-1.5 text-xs font-semibold text-white shadow-lg group-hover:block">
                {column.tooltip}
              </span>
            </div>
          )
        })}
      </div>
      <div className="mt-1.5 flex gap-[2px] sm:gap-1.5">
        {columns.map((column) => (
          <span key={column.key} className="min-w-0 flex-1 truncate text-center text-[10px] font-semibold text-muted">{column.axisLabel}</span>
        ))}
      </div>
    </div>
  )
}

function RevenueChart({ revenue }: { revenue: CurrencyRevenue }) {
  const money = (value: number) => formatMoney(value, revenue.currency)
  const { totals } = revenue
  const peak = revenue.months.reduce<CurrencyRevenue['months'][number] | null>((best, bucket) => (
    bucket.grossMinor > 0 && (!best || bucket.grossMinor > best.grossMinor) ? bucket : best
  ), null)
  const tiles = [
    { label: 'Gross sales', value: money(totals.grossMinor), note: `${totals.orderCount} ${totals.orderCount === 1 ? 'sale' : 'sales'}` },
    { label: 'Refunded', value: money(totals.refundedMinor), note: `${totals.refundedOrderCount} refunded` },
    { label: 'Sea N Shore fee', value: money(totals.platformFeeMinor), note: 'on kept sales' },
    { label: 'Your earnings', value: money(totals.trainerNetMinor), note: 'on kept sales' },
  ]
  return (
    <section aria-label={`Revenue in ${revenue.currency}`} className="min-w-0">
      <h4 className="text-sm font-bold uppercase tracking-[0.1em] text-teal-700">Revenue · {revenue.currency}</h4>
      <dl className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-xl bg-mist-50 p-3">
            <dt className="text-xs font-semibold text-muted">{tile.label}</dt>
            <dd className="mt-1 break-words font-bold text-navy-950">{tile.value}</dd>
            <dd className="text-[11px] text-muted">{tile.note}</dd>
          </div>
        ))}
      </dl>
      {totals.orderCount === 0 || !peak ? null : (
        <div className="mt-5">
          <p className="mb-3 text-sm font-semibold text-navy-900">
            Best month: {monthLabel(peak.month, 'long')}, {money(peak.grossMinor)} gross from {peak.orderCount} {peak.orderCount === 1 ? 'sale' : 'sales'}.
          </p>
          <Legend items={[
            { color: COLOR.series, label: 'Your earnings' },
            { color: COLOR.fee, label: 'Sea N Shore fee' },
            { color: COLOR.refunded, label: 'Refunded' },
          ]} />
          <ColumnChart
            label={`revenue-${revenue.currency}`}
            columns={revenue.months.map((bucket) => ({
              key: bucket.month,
              axisLabel: monthLabel(bucket.month),
              tooltip: `${monthLabel(bucket.month, 'long')}: ${money(bucket.grossMinor)} gross · ${money(bucket.trainerNetMinor)} yours · ${money(bucket.platformFeeMinor)} fee · ${money(bucket.refundedMinor)} refunded`,
              segments: [
                { value: bucket.trainerNetMinor, color: COLOR.series },
                { value: bucket.platformFeeMinor, color: COLOR.fee },
                { value: bucket.refundedMinor, color: COLOR.refunded },
              ],
            }))}
          />
        </div>
      )}
      <TableView caption={`Monthly revenue in ${revenue.currency}`}>
        <thead>
          <tr>
            <th scope="col" className={th}>Month</th>
            <th scope="col" className={th}>Sales</th>
            <th scope="col" className={th}>Gross</th>
            <th scope="col" className={th}>Refunded</th>
            <th scope="col" className={th}>Fee</th>
            <th scope="col" className={th}>Your earnings</th>
          </tr>
        </thead>
        <tbody>
          {revenue.months.map((bucket) => (
            <tr key={bucket.month}>
              <th scope="row" className={`${td} font-semibold`}>{monthLabel(bucket.month, 'long')}</th>
              <td className={td}>{bucket.orderCount}</td>
              <td className={td}>{money(bucket.grossMinor)}</td>
              <td className={td}>{money(bucket.refundedMinor)}</td>
              <td className={td}>{money(bucket.platformFeeMinor)}</td>
              <td className={td}>{money(bucket.trainerNetMinor)}</td>
            </tr>
          ))}
        </tbody>
      </TableView>
    </section>
  )
}

export function MonthlyTrendCharts({ trend }: { trend: CourseMonthlyTrend }) {
  const { months, revenue } = trend
  const totalEnrollments = months.reduce((sum, bucket) => sum + bucket.enrollmentCount, 0)
  const totalRevoked = months.reduce((sum, bucket) => sum + bucket.revokedCount, 0)
  const busiest = months.reduce<typeof months[number] | null>((best, bucket) => (
    bucket.enrollmentCount > 0 && (!best || bucket.enrollmentCount > best.enrollmentCount) ? bucket : best
  ), null)
  const range = months.length ? `${monthLabel(months[0]!.month, 'long')} – ${monthLabel(months[months.length - 1]!.month, 'long')}` : ''

  return (
    <ChartCard
      title="Enrolments and revenue"
      description={`Last 12 months (${range}), by India Standard Time month. Revenue counts confirmed sales by the month they were paid; refunded sales are shown separately and earn no fee or payout. Each currency is shown on its own.`}
    >
      <section aria-label="New enrolments per month" className="min-w-0">
        <h4 className="text-sm font-bold uppercase tracking-[0.1em] text-teal-700">New enrolments</h4>
        {totalEnrollments === 0 ? (
          <div className="mt-3"><EmptyChart>No new enrolments in the last 12 months.</EmptyChart></div>
        ) : (
          <>
            <p className="mt-1 mb-4 text-sm font-semibold text-navy-900">
              {totalEnrollments} new {totalEnrollments === 1 ? 'enrolment' : 'enrolments'} in 12 months
              {busiest ? `, most in ${monthLabel(busiest.month, 'long')} (${busiest.enrollmentCount})` : ''}.
              {totalRevoked ? ` ${totalRevoked} ${totalRevoked === 1 ? 'was' : 'were'} later revoked.` : ''}
            </p>
            <ColumnChart
              label="enrolments"
              columns={months.map((bucket) => ({
                key: bucket.month,
                axisLabel: monthLabel(bucket.month),
                tooltip: `${monthLabel(bucket.month, 'long')}: ${bucket.enrollmentCount} new${bucket.revokedCount ? `, ${bucket.revokedCount} revoked since` : ''}`,
                capLabel: bucket === busiest || bucket === months[months.length - 1] ? String(bucket.enrollmentCount) : undefined,
                segments: [{ value: bucket.enrollmentCount, color: COLOR.series }],
              }))}
            />
            <TableView caption="New enrolments per month">
              <thead>
                <tr><th scope="col" className={th}>Month</th><th scope="col" className={th}>New enrolments</th><th scope="col" className={th}>Revoked since</th></tr>
              </thead>
              <tbody>
                {months.map((bucket) => (
                  <tr key={bucket.month}>
                    <th scope="row" className={`${td} font-semibold`}>{monthLabel(bucket.month, 'long')}</th>
                    <td className={td}>{bucket.enrollmentCount}</td>
                    <td className={td}>{bucket.revokedCount}</td>
                  </tr>
                ))}
              </tbody>
            </TableView>
          </>
        )}
      </section>

      <div className="mt-8 space-y-8">
        {revenue.length ? revenue.map((entry) => <RevenueChart key={entry.currency} revenue={entry} />) : (
          <section aria-label="Revenue">
            <h4 className="text-sm font-bold uppercase tracking-[0.1em] text-teal-700">Revenue</h4>
            <div className="mt-3"><EmptyChart>No paid sales in the last 12 months.</EmptyChart></div>
          </section>
        )}
      </div>
    </ChartCard>
  )
}
