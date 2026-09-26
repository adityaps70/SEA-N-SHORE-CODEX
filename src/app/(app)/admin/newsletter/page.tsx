import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Download, Search } from 'lucide-react'
import { requirePlatformAdministratorUser } from '@/features/admin/access'
import {
  AdminChip,
  AdminEmptyState,
  AdminFilterBar,
  AdminPageHeader,
  AdminPanel,
  formatAdminDate,
  type AdminChipTone,
} from '@/features/admin/components/admin-ui'
import { AdminCampaignComposer, AdminUnsubscribeButton } from '@/features/newsletter/components/admin-newsletter-controls'
import { getNewsletterConfig, newsletterSendingStatus, SENDING_DISABLED_MESSAGES } from '@/features/newsletter/config'
import { newsletterRepository, type NewsletterSyncStatus } from '@/features/newsletter/repository'
import {
  isNewsletterTopic,
  NEWSLETTER_STATUS_LABELS,
  NEWSLETTER_STATUSES,
  NEWSLETTER_TOPICS,
  newsletterTopicLabel,
  type NewsletterStatus,
} from '@/features/newsletter/topics'
import { pluralize } from '@/lib/format'

export const metadata: Metadata = { title: 'Newsletter · Admin' }
export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const PAGE_SIZE = 50

const statusTone: Record<NewsletterStatus, AdminChipTone> = { subscribed: 'success', pending: 'warning', unsubscribed: 'neutral' }
const syncLabels: Record<NewsletterSyncStatus, { label: string; tone: AdminChipTone }> = {
  synced: { label: 'In SES', tone: 'success' },
  pending: { label: 'Sync pending', tone: 'info' },
  failed: { label: 'Sync retrying', tone: 'danger' },
  not_required: { label: 'Not in SES', tone: 'neutral' },
}
const eventLabels: Record<string, string> = {
  subscribe_requested: 'Consent given',
  subscribe_confirmed: 'Subscription confirmed',
  topics_changed: 'Topics changed',
  unsubscribed: 'Unsubscribed',
  duplicate_signup: 'Signed up again (already subscribed)',
}
const sourceLabels: Record<string, string> = {
  newsletter_page: 'Newsletter page',
  public_footer: 'Website footer',
  unsubscribe_page: 'Unsubscribe link',
  one_click: 'One-click unsubscribe',
  ses_subscription_management: 'SES subscription management',
  member_settings: 'Member preferences',
  admin: 'Administrator',
  confirmation_link: 'Confirmation link',
}

const campaignStatusLabels: Record<string, string> = {
  queued: 'Queued',
  sending: 'Sending',
  sent: 'Sent',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

export default async function AdminNewsletterPage({ searchParams }: { searchParams: SearchParams }) {
  try {
    await requirePlatformAdministratorUser()
  } catch (error) {
    if (error instanceof Error && error.message === 'admin_forbidden') notFound()
    throw error
  }

  const params = await searchParams
  const q = single(params.q).trim().slice(0, 120)
  const statusParam = single(params.status)
  const status = NEWSLETTER_STATUSES.includes(statusParam as NewsletterStatus) ? (statusParam as NewsletterStatus) : null
  const topicParam = single(params.topic)
  const topic = isNewsletterTopic(topicParam) ? topicParam : null
  const page = Math.max(1, Math.min(10_000, Number.parseInt(single(params.page), 10) || 1))
  const selectedId = /^[0-9a-f-]{36}$/i.test(single(params.subscriber)) ? single(params.subscriber) : null

  const config = getNewsletterConfig()
  const sending = newsletterSendingStatus(config)

  const [results, counts, selected, history, campaigns] = await Promise.all([
    newsletterRepository.search({ q, status, topic, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    newsletterRepository.statusCounts(),
    selectedId ? newsletterRepository.getById(selectedId) : Promise.resolve(null),
    selectedId ? newsletterRepository.consentHistory(selectedId) : Promise.resolve([]),
    newsletterRepository.listCampaigns(10),
  ])

  function href(next: { status?: NewsletterStatus | null; topic?: string | null; page?: number; subscriber?: string | null }) {
    const search = new URLSearchParams()
    if (q) search.set('q', q)
    const nextStatus = next.status === undefined ? status : next.status
    const nextTopic = next.topic === undefined ? topic : next.topic
    if (nextStatus) search.set('status', nextStatus)
    if (nextTopic) search.set('topic', nextTopic)
    if (next.page && next.page > 1) search.set('page', String(next.page))
    if (next.subscriber) search.set('subscriber', next.subscriber)
    const value = search.toString()
    return `/admin/newsletter${value ? `?${value}` : ''}`
  }

  const exportSearch = new URLSearchParams()
  if (q) exportSearch.set('q', q)
  if (status) exportSearch.set('status', status)
  if (topic) exportSearch.set('topic', topic)
  const exportHref = `/api/admin/newsletter/export${exportSearch.toString() ? `?${exportSearch}` : ''}`
  const totalAll = counts.pending + counts.subscribed + counts.unsubscribed
  const lastPage = Math.max(1, Math.ceil(results.total / PAGE_SIZE))

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Newsletter"
        meta={`${pluralize(counts.subscribed, 'subscriber')} · ${counts.pending} awaiting confirmation · ${counts.unsubscribed} unsubscribed`}
        description="Consent is stored in the Sea N Shore database and synced to the Amazon SES contact list. The database is the source of truth; SES sync retries automatically."
        actions={(
          <a href={exportHref} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-mist-100 bg-white px-3 text-sm font-semibold text-navy-950 hover:bg-mist-50">
            <Download aria-hidden="true" className="size-4" />
            Export CSV
          </a>
        )}
      />

      <AdminPanel className="p-4">
        <h3 className="text-sm font-semibold text-navy-950">Amazon SES connection</h3>
        <ul className="mt-2 flex flex-wrap gap-2 text-sm">
          <li><AdminChip tone={config.contactListName ? 'success' : 'warning'}>{config.contactListName ? `Contact list: ${config.contactListName}` : 'Contact list not configured'}</AdminChip></li>
          <li><AdminChip tone={config.fromAddress ? 'success' : 'warning'}>{config.fromAddress ? 'Verified sender set' : 'Sender not configured'}</AdminChip></li>
          <li><AdminChip tone={config.productionAccess ? 'success' : 'warning'}>{config.productionAccess ? 'Production access on' : 'Sandbox: sending off'}</AdminChip></li>
          <li><AdminChip tone={config.tokenSecret ? 'success' : 'danger'}>{config.tokenSecret ? 'Link signing ready' : 'Link-signing secret missing'}</AdminChip></li>
        </ul>
      </AdminPanel>

      <div className="flex flex-col gap-3">
        <AdminFilterBar
          label="Subscriber status filters"
          options={[
            { href: href({ status: null, page: 1 }), label: 'All', active: !status, count: totalAll },
            ...NEWSLETTER_STATUSES.map((item) => ({ href: href({ status: item, page: 1 }), label: NEWSLETTER_STATUS_LABELS[item], active: status === item, count: counts[item] })),
          ]}
        />
        <form method="get" action="/admin/newsletter" className="flex max-w-2xl flex-wrap gap-2">
          {status ? <input type="hidden" name="status" value={status} /> : null}
          <label className="relative min-w-0 flex-1 basis-48">
            <span className="sr-only">Search by email</span>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input type="search" name="q" defaultValue={q} maxLength={120} placeholder="Search by email" className="min-h-9 w-full rounded-lg border border-mist-100 bg-white py-1.5 pl-9 pr-3 text-sm text-navy-950 outline-none focus:border-ocean-400 focus:ring-2 focus:ring-ocean-100" />
          </label>
          <label className="min-w-0">
            <span className="sr-only">Topic</span>
            <select name="topic" defaultValue={topic ?? ''} className="min-h-9 rounded-lg border border-mist-100 bg-white px-2 text-sm text-navy-950">
              <option value="">All topics</option>
              {NEWSLETTER_TOPICS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
            </select>
          </label>
          <button type="submit" className="min-h-9 rounded-lg bg-navy-950 px-3 text-sm font-semibold text-white hover:bg-navy-900">Apply</button>
        </form>
      </div>

      {selected ? (
        <AdminPanel className="p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h3 className="break-all text-lg font-semibold text-navy-950">{selected.email}</h3>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                <AdminChip tone={statusTone[selected.status]}>{NEWSLETTER_STATUS_LABELS[selected.status]}</AdminChip>
                <AdminChip tone={syncLabels[selected.sesSyncStatus].tone}>{syncLabels[selected.sesSyncStatus].label}</AdminChip>
                <span>{selected.topics.map(newsletterTopicLabel).join(', ') || 'No topics'}</span>
                {selected.profileId ? <Link href={`/admin/users/${selected.profileId}`} className="font-semibold text-ocean-700 hover:underline">Linked member</Link> : null}
              </p>
              {selected.sesSyncError ? <p className="mt-2 text-xs text-red-700">Last SES error: {selected.sesSyncError}</p> : null}
            </div>
            <Link href={href({ page })} className="text-sm font-semibold text-ocean-700 hover:underline">Close</Link>
          </div>
          {selected.status !== 'unsubscribed' ? (
            <div className="mt-4"><AdminUnsubscribeButton subscriberId={selected.id} email={selected.email} /></div>
          ) : null}
          <h4 className="mt-5 text-sm font-semibold text-navy-950">Consent history</h4>
          {history.length ? (
            <ol className="mt-2 divide-y divide-mist-100 rounded-lg border border-mist-100">
              {history.map((event) => (
                <li key={event.id} className="grid gap-1 px-3 py-2.5 text-sm sm:grid-cols-[12rem_minmax(0,1fr)]">
                  <span className="text-muted">{formatAdminDate(event.createdAt, true)}</span>
                  <span className="min-w-0">
                    <span className="font-semibold text-navy-950">{eventLabels[event.eventType] ?? event.eventType}</span>
                    <span className="text-muted"> · {sourceLabels[event.source] ?? event.source}</span>
                    {event.topics.length ? <span className="block text-xs text-muted">Topics: {event.topics.map(newsletterTopicLabel).join(', ')}</span> : null}
                    <span className="block text-xs text-muted">
                      {[event.consentTextVersion ? `Consent text ${event.consentTextVersion}` : null, event.userAgentSummary, event.ipHash ? `IP ref ${event.ipHash.slice(0, 8)}` : null].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-sm text-muted">No consent events recorded.</p>
          )}
        </AdminPanel>
      ) : selectedId ? (
        <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">That subscriber no longer exists.</p>
      ) : null}

      <AdminPanel>
        {results.subscribers.length === 0 ? (
          <AdminEmptyState title="No subscribers match this view." description="Try a different search, status or topic." />
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[52rem] text-left text-sm">
              <thead className="border-b border-mist-100 bg-mist-50/70 text-xs font-semibold uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2.5">Email</th>
                  <th scope="col" className="px-4 py-2.5">Status</th>
                  <th scope="col" className="px-4 py-2.5">Topics</th>
                  <th scope="col" className="px-4 py-2.5">SES</th>
                  <th scope="col" className="px-4 py-2.5">Signed up</th>
                  <th scope="col" className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-mist-100">
                {results.subscribers.map((subscriber) => (
                  <tr key={subscriber.id} className="align-middle hover:bg-mist-50/60">
                    <td className="max-w-[16rem] truncate px-4 py-2.5 font-medium text-navy-950" title={subscriber.email}>{subscriber.email}</td>
                    <td className="px-4 py-2.5"><AdminChip tone={statusTone[subscriber.status]}>{NEWSLETTER_STATUS_LABELS[subscriber.status]}</AdminChip></td>
                    <td className="min-w-[12rem] px-4 py-2.5 text-muted">{subscriber.topics.map(newsletterTopicLabel).join(', ') || '—'}</td>
                    <td className="px-4 py-2.5"><AdminChip tone={syncLabels[subscriber.sesSyncStatus].tone}>{syncLabels[subscriber.sesSyncStatus].label}</AdminChip></td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted">{formatAdminDate(subscriber.createdAt)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Link href={href({ page, subscriber: subscriber.id })} className="inline-flex min-h-8 items-center whitespace-nowrap rounded-lg border border-mist-100 px-3 text-xs font-semibold text-navy-950 hover:border-ocean-200 hover:bg-ocean-50">
                        Consent history
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminPanel>
      {lastPage > 1 ? (
        <nav aria-label="Subscriber pages" className="flex items-center justify-between text-sm">
          {page > 1 ? <Link href={href({ page: page - 1 })} className="font-semibold text-ocean-700 hover:underline">Previous page</Link> : <span />}
          <span className="text-muted">Page {page} of {lastPage}</span>
          {page < lastPage ? <Link href={href({ page: page + 1 })} className="font-semibold text-ocean-700 hover:underline">Next page</Link> : <span />}
        </nav>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <AdminPanel className="p-4 sm:p-5">
          <h3 className="text-base font-semibold text-navy-950">Send a campaign</h3>
          <p className="mt-1 text-sm text-muted">Sent through the Amazon SES API to confirmed subscribers of one topic. Consent is re-checked for every recipient at send time.</p>
          <div className="mt-4">
            <AdminCampaignComposer disabledReason={sending.enabled ? null : SENDING_DISABLED_MESSAGES[sending.reason]} />
          </div>
        </AdminPanel>
        <AdminPanel className="p-4 sm:p-5">
          <h3 className="text-base font-semibold text-navy-950">Recent campaigns</h3>
          {campaigns.length ? (
            <ul className="mt-3 divide-y divide-mist-100">
              {campaigns.map((campaign) => (
                <li key={campaign.id} className="py-2.5 text-sm">
                  <p className="font-semibold text-navy-950">{campaign.subject}</p>
                  <p className="text-xs text-muted">
                    {newsletterTopicLabel(campaign.topic)} · {campaignStatusLabels[campaign.status] ?? campaign.status} · {campaign.sentCount}/{campaign.recipientCount} sent
                    {campaign.failedCount ? ` · ${campaign.failedCount} failed` : ''} · {formatAdminDate(campaign.createdAt, true)}
                  </p>
                  {campaign.lastError ? <p className="text-xs text-red-700">{campaign.lastError}</p> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted">No campaigns yet.</p>
          )}
        </AdminPanel>
      </div>
    </div>
  )
}
