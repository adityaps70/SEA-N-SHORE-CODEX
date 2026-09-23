import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'
import { requirePlatformAdministratorUser } from '@/features/admin/access'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  try {
    await requirePlatformAdministratorUser()
  } catch (error) {
    if (error instanceof Error && error.message === 'admin_forbidden') notFound()
    throw error
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6 overflow-hidden rounded-[1.75rem] bg-navy-950 p-5 text-white shadow-[var(--shadow-card)] sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-teal-200">
              <ShieldCheck aria-hidden="true" className="size-4" /> Sea N Shore Admin
            </p>
            <h1 className="mt-2 text-3xl font-bold">Platform administration</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/70">Manage platform trust, content reports, maritime organizations, learning approvals and controlled access from one operations workspace.</p>
          </div>
          <nav aria-label="Admin navigation" className="flex flex-wrap gap-2 text-sm font-bold">
            <Link href="/admin" className="rounded-xl bg-white/10 px-4 py-2.5 transition hover:bg-white/15">Overview</Link>
            <Link href="/admin/moderation" className="rounded-xl bg-white px-4 py-2.5 text-navy-950 transition hover:bg-mist-50">Moderation</Link>
            <Link href="/admin/users" className="rounded-xl bg-white/10 px-4 py-2.5 transition hover:bg-white/15">Users</Link>
            <Link href="/admin/audit" className="rounded-xl bg-white/10 px-4 py-2.5 transition hover:bg-white/15">Audit</Link>
            <Link href="/admin/organizations" className="rounded-xl bg-white/10 px-4 py-2.5 transition hover:bg-white/15">Organizations</Link>
            <Link href="/admin/learning" className="rounded-xl bg-white/10 px-4 py-2.5 transition hover:bg-white/15">Learning</Link>
          </nav>
        </div>
      </header>
      {children}
    </div>
  )
}
