import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { DeletedPostRecoveryPanel } from '@/features/admin/components/deleted-post-recovery-panel'
import { AdminChip, AdminEmptyState, AdminPageHeader, AdminPanel, formatAdminDate } from '@/features/admin/components/admin-ui'
import { adminRepository } from '@/features/admin/repository'
import { pluralize } from '@/lib/format'

export const metadata: Metadata = { title: 'Deleted content · Admin' }

function categoryLabel(value: string) {
  const text = value.replaceAll('_', ' ')
  return text ? text[0].toUpperCase() + text.slice(1) : text
}

export default async function DeletedContentPage() {
  const admin = await requireAwsUser()
  const deletedPosts = await adminRepository.listDeletedPosts(admin.id, 100)

  return (
    <main className="space-y-4">
      <AdminPageHeader
        title="Deleted content & recovery"
        meta={pluralize(deletedPosts.length, 'retained post')}
        description="Deleted posts are hidden from members immediately and kept for 30 days so an administrator can restore them; after that they are purged automatically."
      />

      <AdminPanel>
        {deletedPosts.length === 0 ? (
          <AdminEmptyState
            title="No deleted posts are currently being retained."
            description="Deleted posts will appear here during their recovery window."
          />
        ) : (
          <>
            <div
              aria-hidden="true"
              className="hidden grid-cols-[minmax(0,1fr)_10rem_10rem_8rem_7rem] gap-4 border-b border-mist-100 bg-mist-50/70 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted lg:grid"
            >
              <span>Post</span>
              <span>Author</span>
              <span>Deleted by</span>
              <span>Deleted on</span>
              <span>Status</span>
            </div>
            <ul className="divide-y divide-mist-100">
              {deletedPosts.map((post) => (
                <li key={post.id}>
                  <details className="group">
                    <summary className="grid cursor-pointer list-none gap-2 px-4 py-3 text-sm transition hover:bg-mist-50/60 lg:grid-cols-[minmax(0,1fr)_10rem_10rem_8rem_7rem] lg:items-center lg:gap-4 [&::-webkit-details-marker]:hidden">
                      <div className="flex min-w-0 items-start gap-2">
                        <ChevronRight aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted transition group-open:rotate-90" />
                        <div className="min-w-0">
                          <p className="line-clamp-1 whitespace-pre-wrap text-navy-950 group-open:line-clamp-none">{post.body}</p>
                          <p className="mt-0.5 truncate text-xs text-muted">
                            {categoryLabel(post.category)} · Reason: <span className="text-navy-900">{post.reason}</span>
                          </p>
                        </div>
                      </div>
                      <span className="truncate text-navy-900">
                        {post.author.slug ? (
                          <Link href={`/people/${post.author.slug}`} className="font-semibold text-ocean-700 hover:underline">
                            {post.author.fullName}
                          </Link>
                        ) : post.author.fullName}
                      </span>
                      <span className="truncate text-navy-900">{post.deletedBy.fullName}</span>
                      <span className="whitespace-nowrap text-muted">{formatAdminDate(post.deletedAt)}</span>
                      <span>
                        <AdminChip tone={post.recoverable ? 'info' : 'neutral'}>
                          {post.recoverable ? 'Recoverable' : 'Expired'}
                        </AdminChip>
                      </span>
                    </summary>
                    <div className="grid gap-4 border-t border-mist-100 bg-mist-50/40 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:pl-10">
                      <dl className="grid content-start gap-2 text-sm sm:grid-cols-2">
                        <div>
                          <dt className="text-xs font-semibold text-muted">Deleted on</dt>
                          <dd className="text-navy-950">{formatAdminDate(post.deletedAt, true)}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-semibold text-muted">Purged permanently after</dt>
                          <dd className="text-navy-950">{formatAdminDate(post.purgeAfter, true)}</dd>
                        </div>
                      </dl>
                      <DeletedPostRecoveryPanel postId={post.id} recoverable={post.recoverable} />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </>
        )}
      </AdminPanel>
    </main>
  )
}
