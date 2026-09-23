import Link from 'next/link'
import { Clock3, FileClock, ShieldCheck } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { DeletedPostRecoveryPanel } from '@/features/admin/components/deleted-post-recovery-panel'
import { adminRepository } from '@/features/admin/repository'

function dateLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function categoryLabel(value: string) {
  return value.replaceAll('_', ' ')
}

export default async function DeletedContentPage() {
  const admin = await requireAwsUser()
  const deletedPosts = await adminRepository.listDeletedPosts(admin.id, 100)

  return (
    <main className="space-y-5">
      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-red-700">
              <FileClock aria-hidden="true" className="size-4" />
              Content retention
            </p>
            <h2 className="mt-2 text-2xl font-bold text-navy-950">Deleted content & recovery</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              Deleted posts disappear from public feeds immediately, but Sea N Shore retains the post record for 30 days so an administrator can recover accidental or inappropriate deletions. After the retention deadline, the background retention worker permanently purges the post record and its database-linked content.
            </p>
          </div>
          <div className="rounded-2xl bg-mist-50 px-4 py-3 text-sm font-semibold text-navy-950">
            {deletedPosts.length} retained post{deletedPosts.length === 1 ? '' : 's'}
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-mist-100 bg-mist-50/60 p-4">
            <ShieldCheck aria-hidden="true" className="size-5 text-emerald-700" />
            <p className="mt-2 text-sm font-bold text-navy-950">Hidden immediately</p>
            <p className="mt-1 text-xs leading-5 text-muted">Soft-deleted posts are excluded from the public feed, profile posts, saves and direct post views.</p>
          </div>
          <div className="rounded-xl border border-mist-100 bg-mist-50/60 p-4">
            <Clock3 aria-hidden="true" className="size-5 text-ocean-700" />
            <p className="mt-2 text-sm font-bold text-navy-950">30-day recovery window</p>
            <p className="mt-1 text-xs leading-5 text-muted">Deletion date, actor and reason are retained together with the recovery deadline.</p>
          </div>
          <div className="rounded-xl border border-mist-100 bg-mist-50/60 p-4">
            <FileClock aria-hidden="true" className="size-5 text-red-700" />
            <p className="mt-2 text-sm font-bold text-navy-950">Automatic purge</p>
            <p className="mt-1 text-xs leading-5 text-muted">Expired deleted posts are permanently removed by the retention worker instead of being kept indefinitely.</p>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        {deletedPosts.map((post) => (
          <article key={post.id} className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-bold text-red-800">Deleted post</span>
                  <span className="rounded-full bg-mist-50 px-2.5 py-1 text-xs font-bold capitalize text-muted">
                    {categoryLabel(post.category)}
                  </span>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${post.recoverable ? 'bg-ocean-50 text-ocean-800' : 'bg-mist-100 text-muted'}`}>
                    {post.recoverable ? 'Recoverable' : 'Retention expired'}
                  </span>
                </div>

                <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-ink">
                  {post.body.length > 700 ? `${post.body.slice(0, 700)}…` : post.body}
                </p>

                <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-mist-50 p-3">
                    <dt className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted">Author</dt>
                    <dd className="mt-1 text-sm font-semibold text-navy-950">
                      {post.author.slug ? (
                        <Link href={`/people/${post.author.slug}`} className="text-ocean-700 hover:underline">
                          {post.author.fullName}
                        </Link>
                      ) : post.author.fullName}
                    </dd>
                  </div>
                  <div className="rounded-xl bg-mist-50 p-3">
                    <dt className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted">Deleted by</dt>
                    <dd className="mt-1 text-sm font-semibold text-navy-950">{post.deletedBy.fullName}</dd>
                  </div>
                  <div className="rounded-xl bg-mist-50 p-3">
                    <dt className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted">Deleted on</dt>
                    <dd className="mt-1 text-sm font-semibold text-navy-950">{dateLabel(post.deletedAt)}</dd>
                  </div>
                  <div className="rounded-xl bg-mist-50 p-3">
                    <dt className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted">Permanent purge after</dt>
                    <dd className="mt-1 text-sm font-semibold text-navy-950">{dateLabel(post.purgeAfter)}</dd>
                  </div>
                </dl>

                <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50/70 p-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-amber-800">Deletion reason</p>
                  <p className="mt-1 text-sm leading-6 text-amber-950">{post.reason}</p>
                </div>
              </div>

              <DeletedPostRecoveryPanel postId={post.id} recoverable={post.recoverable} />
            </div>
          </article>
        ))}

        {deletedPosts.length === 0 ? (
          <section className="rounded-[1.5rem] border border-dashed border-mist-200 bg-white p-10 text-center">
            <FileClock aria-hidden="true" className="mx-auto size-7 text-muted" />
            <h3 className="mt-3 text-lg font-bold text-navy-950">No deleted posts are currently being retained.</h3>
            <p className="mt-2 text-sm text-muted">Deleted posts will appear here during their 30-day recovery window.</p>
          </section>
        ) : null}
      </section>
    </main>
  )
}
