import { questionCsvTemplate } from '@/features/learning/quiz-csv'

export const runtime = 'nodejs'
export const dynamic = 'force-static'

/** The question bank CSV template: column names and one example of each question type. No member data. */
export function GET() {
  return new Response(questionCsvTemplate(), {
    status: 200,
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="sea-n-shore-question-bank-template.csv"',
    },
  })
}
