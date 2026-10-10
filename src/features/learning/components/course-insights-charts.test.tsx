import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { CourseLessonFunnel, CourseMonthlyTrend, QuizDifficulty } from '../mentor-course-insights-repository'
import { LessonDropOffChart, MonthlyTrendCharts, QuizDifficultyChart, monthLabel } from './course-insights-charts'

afterEach(() => cleanup())

const MONTHS = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']

function emptyRevenueMonth(month: string) {
  return { month, orderCount: 0, refundedOrderCount: 0, grossMinor: 0, refundedMinor: 0, platformFeeMinor: 0, trainerNetMinor: 0 }
}

describe('LessonDropOffChart', () => {
  const funnel: CourseLessonFunnel = {
    learnerCount: 5,
    lessons: [
      { lessonId: 'l1', title: 'Intro', sectionTitle: 'Section A', position: 1, reachedCount: 5, reachedPercent: 100, completedCount: 4, completedPercent: 80 },
      { lessonId: 'l2', title: 'Walkthrough video', sectionTitle: 'Section A', position: 2, reachedCount: 2, reachedPercent: 40, completedCount: 1, completedPercent: 20 },
    ],
  }

  it('renders reached and completed counts per material with a summary and table view', () => {
    render(<LessonDropOffChart funnel={funnel} />)

    expect(screen.getByRole('heading', { name: 'Lesson drop-off' })).toBeInTheDocument()
    expect(screen.getByText(/Of 5 learners, 5 \(100%\) reached the first material and 1 \(20%\) completed the last\./)).toBeInTheDocument()
    expect(screen.getByText(/largest drop is before “Walkthrough video”, with 3 fewer learners/)).toBeInTheDocument()
    expect(screen.getByText('40% reached · 20% done')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Legend' })).toHaveTextContent('ReachedCompleted')

    const table = screen.getByRole('table', { hidden: true })
    expect(within(table).getByRole('rowheader', { name: '1. Intro', hidden: true })).toBeInTheDocument()
    expect(within(table).getByText('5 (100%)')).toBeInTheDocument()
    expect(within(table).getByText('1 (20%)')).toBeInTheDocument()
  })

  it('shows empty states for a course with no materials or no learners', () => {
    const { rerender } = render(<LessonDropOffChart funnel={{ learnerCount: 3, lessons: [] }} />)
    expect(screen.getByText('Publish materials to see where learners drop off.')).toBeInTheDocument()

    rerender(<LessonDropOffChart funnel={{ ...funnel, learnerCount: 0 }} />)
    expect(screen.getByText('No learners are enrolled yet.')).toBeInTheDocument()
    expect(screen.queryByRole('table', { hidden: true })).not.toBeInTheDocument()
  })
})

describe('QuizDifficultyChart', () => {
  const quizzes: QuizDifficulty[] = [{
    quizId: 'q1',
    lessonId: 'l3',
    lessonTitle: 'Knowledge check',
    questions: [
      { questionId: 'a', prompt: 'Which document comes first?', questionType: 'single_choice', position: 1, answerCount: 3, pendingCount: 0, correctPercent: 67, isHardest: false },
      { questionId: 'b', prompt: 'Describe the vetting sequence.', questionType: 'subjective', position: 2, answerCount: 2, pendingCount: 1, correctPercent: 50, isHardest: true },
      { questionId: 'c', prompt: 'Which form records the findings?', questionType: 'single_choice', position: 3, answerCount: 0, pendingCount: 0, correctPercent: null, isHardest: false },
    ],
  }]

  it('shows each question prompt with its share correct, answers counted and the hardest flagged', () => {
    render(<QuizDifficultyChart quizzes={quizzes} />)

    expect(screen.getByRole('heading', { name: 'Quiz question difficulty' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Knowledge check' })).toBeInTheDocument()
    const items = within(screen.getByRole('region', { name: 'Quiz: Knowledge check' })).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent('Which document comes first?')
    expect(items[0]).toHaveTextContent('67% correct.')
    expect(items[0]).toHaveTextContent('3 answers')
    expect(items[0]).not.toHaveTextContent('Hardest')
    expect(items[1]).toHaveTextContent('Hardest')
    expect(items[1]).toHaveTextContent('Written answer · 2 answers · 1 awaiting grading')
    expect(items[2]).toHaveTextContent('Not enough answers yet')
    expect(screen.getByText(/Hardest: question 2 at 50% correct\./)).toBeInTheDocument()
  })

  it('shows an empty state when the course has no quiz questions', () => {
    render(<QuizDifficultyChart quizzes={[]} />)
    expect(screen.getByText('This course has no quiz questions yet.')).toBeInTheDocument()
  })
})

describe('MonthlyTrendCharts', () => {
  const trend: CourseMonthlyTrend = {
    months: MONTHS.map((month) => ({
      month,
      enrollmentCount: month === '2026-09' ? 3 : month === '2026-10' ? 1 : 0,
      revokedCount: month === '2026-09' ? 1 : 0,
    })),
    revenue: [
      {
        currency: 'INR',
        months: MONTHS.map((month) => month === '2026-10'
          ? { month, orderCount: 1, refundedOrderCount: 0, grossMinor: 49900, refundedMinor: 0, platformFeeMinor: 4990, trainerNetMinor: 44910 }
          : month === '2026-09'
            ? { month, orderCount: 1, refundedOrderCount: 1, grossMinor: 49900, refundedMinor: 49900, platformFeeMinor: 0, trainerNetMinor: 0 }
            : emptyRevenueMonth(month)),
        totals: { orderCount: 2, refundedOrderCount: 1, grossMinor: 99800, refundedMinor: 49900, platformFeeMinor: 4990, trainerNetMinor: 44910 },
      },
      {
        currency: 'USD',
        months: MONTHS.map((month) => month === '2026-09'
          ? { month, orderCount: 1, refundedOrderCount: 0, grossMinor: 1500, refundedMinor: 0, platformFeeMinor: 150, trainerNetMinor: 1350 }
          : emptyRevenueMonth(month)),
        totals: { orderCount: 1, refundedOrderCount: 0, grossMinor: 1500, refundedMinor: 0, platformFeeMinor: 150, trainerNetMinor: 1350 },
      },
    ],
  }

  it('summarises monthly enrolments and shows each currency’s revenue separately', () => {
    render(<MonthlyTrendCharts trend={trend} />)

    expect(screen.getByText(/4 new enrolments in 12 months, most in Sep 2026 \(3\)\. 1 was later revoked\./)).toBeInTheDocument()
    const inr = screen.getByRole('region', { name: 'Revenue in INR' })
    const usd = screen.getByRole('region', { name: 'Revenue in USD' })
    expect(within(inr).getByText('Gross sales').nextSibling).toHaveTextContent('₹998')
    expect(within(inr).getByText('Refunded', { selector: 'dt' }).nextSibling).toHaveTextContent('₹499')
    expect(within(inr).getByText('Sea N Shore fee', { selector: 'dt' }).nextSibling).toHaveTextContent('₹49.90')
    expect(within(inr).getByText('Your earnings', { selector: 'dt' }).nextSibling).toHaveTextContent('₹449.10')
    expect(within(usd).getByText('Gross sales').nextSibling).toHaveTextContent('$15')
    expect(within(usd).getByText('Your earnings', { selector: 'dt' }).nextSibling).toHaveTextContent('$13.50')
    expect(within(usd).queryByText(/₹/)).not.toBeInTheDocument()
    expect(within(inr).getByText('Best month: Sep 2026, ₹499 gross from 1 sale.')).toBeInTheDocument()

    const enrolmentTable = screen.getByRole('table', { name: 'New enrolments per month', hidden: true })
    expect(within(enrolmentTable).getAllByRole('row', { hidden: true })).toHaveLength(13)
    const september = within(enrolmentTable).getByRole('rowheader', { name: 'Sep 2026', hidden: true }).closest('tr')!
    expect(september).toHaveTextContent('Sep 202631')
  })

  it('shows empty states with no enrolments and no sales', () => {
    render(<MonthlyTrendCharts trend={{ months: MONTHS.map((month) => ({ month, enrollmentCount: 0, revokedCount: 0 })), revenue: [] }} />)
    expect(screen.getByText('No new enrolments in the last 12 months.')).toBeInTheDocument()
    expect(screen.getByText('No paid sales in the last 12 months.')).toBeInTheDocument()
  })

  it('labels months in short and long forms', () => {
    expect(monthLabel('2026-01')).toBe('Jan')
    expect(monthLabel('2026-01', 'long')).toBe('Jan 2026')
  })
})
