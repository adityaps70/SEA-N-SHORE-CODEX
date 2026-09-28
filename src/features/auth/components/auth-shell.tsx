import type { ReactNode } from 'react'
import { Wordmark } from '@/components/brand/wordmark'

/**
 * Page frame for the auth screens. Desktop and tablet: one white card on the mist
 * background with the stacked logo. Phones: a plain full-width white page with the
 * horizontal logo, like an app sign-in screen.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-mist-50 px-4 py-10 max-md:min-h-0 max-md:place-items-start max-md:bg-white max-md:px-5 max-md:pb-8 max-md:pt-6">
      <section className="w-full max-w-md rounded-[var(--radius-card)] bg-white p-6 shadow-[var(--shadow-card)] sm:p-8 max-md:mx-auto max-md:rounded-none max-md:p-0 max-md:shadow-none">
        <div className="md:hidden">
          <Wordmark compact />
        </div>
        <div className="max-md:hidden">
          <Wordmark />
        </div>
        {children}
      </section>
    </main>
  )
}
