import type { Metadata } from 'next'
import { cache } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, CheckCircle2, ExternalLink, FilePenLine } from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { canAccessPlatformAdmin } from '@/features/admin/access'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { renderArticleHtml } from '@/features/learning/article-html'
import { courseRevisionComparisonRepository, type MaterialTextComparison } from '@/features/learning/course-revision-comparison'
import { articleText, diffWords, sameWordsIgnoringCase } from '@/features/learning/text-diff'
import { createMediaReadUrl } from '@/lib/aws/storage'

/**
 * Learning round E: a read-only review of a draft revision against the live course, material by material, with the
 * wording diffed word by word and both versions side by side. For the course team and platform administrators.
 */

const loadComparison = cache(async (courseId: string) => {
  const user = await requireAwsUser()
  const platformAdmin = await canAccessPlatformAdmin(user.id)
  return courseRevisionComparisonRepository.load(user.id, courseId, { platformAdmin })
})

export async function generateMetadata({ params }: { params: Promise<{ courseId: string }> }): Promise<Metadata> {
  const { courseId } = await params
  const comparison = await loadComparison(courseId).catch(() => null)
  return { title: comparison ? `Draft changes · ${comparison.title}` : 'Draft changes' }
}

async function renderVersion(body: string | null, format: string) {
  if (!body) return { html: null, text: null }
  if (format === 'html') return { html: await renderArticleHtml(body, (path) => createMediaReadUrl(path)), text: null }
  return { html: null, text: body }
}

function Version({ label, version }: { label: string; version: RenderedVersion }) {
  return (
    <div className="min-w-0 rounded-2xl border border-mist-200 bg-white p-4">
      <p className="text-meta font-semibold text-muted">{label}</p>
      {version.html ? (
        // Sanitized with the article allow-list on the server (article-html.ts).
        <div className="lesson-article mt-2 max-w-[68ch]" dangerouslySetInnerHTML={{ __html: version.html }} />
      ) : version.text ? (
        <div className="lesson-article mt-2 max-w-[68ch] whitespace-pre-wrap">{version.text}</div>
      ) : (
        <p className="mt-2 text-sm text-muted">No article text.</p>
      )}
    </div>
  )
}

type RenderedVersion = { html: string | null; text: string | null }
type PreparedMaterial = { item: MaterialTextComparison; before: RenderedVersion | null; after: RenderedVersion | null }

/** Signs article images and sanitizes both versions on the server before the page renders. */
async function prepare(item: MaterialTextComparison): Promise<PreparedMaterial> {
  if (!item.fields.includes('article')) return { item, before: null, after: null }
  const [before, after] = await Promise.all([
    renderVersion(item.before.articleBody, item.before.articleFormat),
    renderVersion(item.after.articleBody, item.after.articleFormat),
  ])
  return { item, before, after }
}

function MaterialCard({ prepared: { item, before, after } }: { prepared: PreparedMaterial }) {
  const beforeText = articleText(item.before.articleBody, item.before.articleFormat)
  const afterText = articleText(item.after.articleBody, item.after.articleFormat)
  const articleChanged = item.fields.includes('article')
  const wordsKept = articleChanged && item.status === 'changed' && sameWordsIgnoringCase(beforeText, afterText)

  return (
    <article id={`material-${item.id}`} aria-label={item.title} className="scroll-mt-24 rounded-[1.4rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)]">
      <p className="text-meta text-muted">{item.sectionTitle}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <h2 className="text-card-title font-semibold text-navy-950">{item.title}</h2>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${item.status === 'added' ? 'bg-teal-50 text-teal-800' : item.status === 'removed' ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-900'}`}>
          {item.status === 'added' ? 'New' : item.status === 'removed' ? 'Removed' : 'Changed'}
        </span>
        {articleChanged && item.before.articleFormat !== item.after.articleFormat ? (
          <span className="rounded-full bg-mist-100 px-2.5 py-0.5 text-xs font-semibold text-navy-800">
            {item.before.articleFormat === 'plain' ? 'Plain text' : 'Rich text'} → {item.after.articleFormat === 'html' ? 'rich text' : 'plain text'}
          </span>
        ) : null}
      </div>

      {item.fields.includes('title') && item.status === 'changed' ? (
        <p className="mt-3 text-sm"><span className="font-semibold">Title:</span> <del className="bg-rose-50 text-rose-900">{item.before.title}</del> → <ins className="bg-teal-50 text-teal-900 no-underline">{item.after.title}</ins></p>
      ) : null}
      {item.fields.includes('summary') && item.status === 'changed' ? (
        <p className="mt-2 text-sm"><span className="font-semibold">Summary:</span> <del className="bg-rose-50 text-rose-900">{item.before.summary ?? '—'}</del> → <ins className="bg-teal-50 text-teal-900 no-underline">{item.after.summary ?? '—'}</ins></p>
      ) : null}

      {articleChanged ? (
        <>
          {wordsKept ? (
            <p className="mt-3 inline-flex items-center gap-2 rounded-xl bg-teal-50 px-3 py-2 text-sm font-semibold text-teal-900">
              <CheckCircle2 aria-hidden="true" className="size-4" /> Same words. Only the layout and heading capitals change.
            </p>
          ) : null}
          <details className="mt-3" open={!wordsKept}>
            <summary className="cursor-pointer text-sm font-semibold text-ocean-700">Wording changes, word by word</summary>
            <p className="mt-2 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-xl border border-mist-200 bg-mist-50/60 p-3 text-sm leading-7 text-navy-900">
              {diffWords(beforeText, afterText).map((segment, index) => segment.kind === 'same'
                ? <span key={index}>{segment.text} </span>
                : segment.kind === 'added'
                  ? <ins key={index} className="bg-teal-100 text-teal-950 no-underline">{segment.text} </ins>
                  : <del key={index} className="bg-rose-100 text-rose-950">{segment.text} </del>)}
            </p>
          </details>
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-semibold text-ocean-700">Live and draft side by side</summary>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <Version label="Live (what learners see now)" version={before!} />
              <Version label="Draft (after approval)" version={after!} />
            </div>
          </details>
        </>
      ) : null}
    </article>
  )
}

export default async function CourseRevisionChangesPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params
  const comparison = await loadComparison(courseId)
  if (!comparison) return notFound()
  const { materials, changes } = comparison
  const prepared = await Promise.all(materials.map(prepare))
  const otherChanges = changes.filter((change) => change.area !== 'material' || !materials.some((item) => item.title === change.label))

  return (
    <div className="mx-auto w-full max-w-6xl py-6 max-md:pt-0 sm:px-6 lg:px-8">
      <MobilePageBar backHref={`/learn/studio/courses/${comparison.revisionCourseId}/edit`} title="Draft changes" />
      <Link href={`/learn/studio/courses/${comparison.revisionCourseId}/edit`} className="inline-flex items-center gap-2 text-sm font-bold text-ocean-700 underline-offset-2 hover:underline max-md:hidden">
        <ArrowLeft aria-hidden="true" className="size-4" /> Back to the draft
      </Link>
      <section className="mt-4 rounded-[1.75rem] border border-mist-100 bg-white p-6 shadow-[var(--shadow-card)] max-md:mx-4 sm:p-8">
        <h1 className="text-page-title font-bold text-navy-950">Draft changes</h1>
        <p className="mt-1 text-body font-semibold text-navy-900">{comparison.title}</p>
        <p className="mt-2 inline-flex items-center gap-2 text-meta text-muted">
          <FilePenLine aria-hidden="true" className="size-4" />
          {comparison.closed ? 'This draft is closed (approved or discarded).' : comparison.status === 'submitted' ? 'Submitted for review.' : 'Not submitted yet. Learners keep the live version until it is approved.'}
        </p>
        <p className="mt-3 text-sm text-muted">
          {materials.length} material{materials.length === 1 ? '' : 's'} with changed text.{' '}
          <Link href={`/learn/courses/${comparison.liveSlug}`} className="inline-flex items-center gap-1 font-semibold text-ocean-700 hover:underline">
            Live course page <ExternalLink aria-hidden="true" className="size-3.5" />
          </Link>
        </p>
        {otherChanges.length ? (
          <div className="mt-4">
            <h2 className="text-card-title font-semibold text-navy-950">Other changes</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-navy-900">
              {otherChanges.map((change, index) => (
                <li key={index}>{change.label}: {change.change}{change.fields.length ? ` (${change.fields.join(', ')})` : ''}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <div className="mt-5 space-y-4 max-md:px-4">
        {prepared.length ? prepared.map((entry) => <MaterialCard key={`${entry.item.status}-${entry.item.id}`} prepared={entry} />) : (
          <p className="rounded-2xl border border-dashed border-mist-200 bg-white p-6 text-center text-sm text-muted">No material text differs from the live course.</p>
        )}
      </div>
    </div>
  )
}
