import Link from 'next/link'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen bg-mist-50">
      {children}
      <footer className="border-t border-mist-100 bg-white px-4 py-5 text-xs text-muted" aria-label="Authentication legal links">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Sea N Shore · All rights reserved.</p>
          <nav className="flex flex-wrap gap-x-4 gap-y-2" aria-label="Legal">
            <Link href="/terms" className="font-semibold hover:text-ocean-700">Terms</Link>
            <Link href="/privacy" className="font-semibold hover:text-ocean-700">Privacy</Link>
            <Link href="/copyright" className="font-semibold hover:text-ocean-700">Copyright &amp; IP</Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
