import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Privacy' }

export default function PrivacyPage() {
  return (
    <section className="mx-auto max-w-3xl rounded-[1.75rem] border border-mist-100 bg-white p-6 shadow-[var(--shadow-card)] sm:p-8">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-ocean-700">Privacy</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-navy-950">Privacy on Sea N Shore</h1>
      <div className="mt-4 space-y-4 text-sm leading-7 text-muted">
        <p>Sea N Shore uses account and professional-profile information to provide member identity, discovery, jobs, learning, messaging and community features. Visibility controls should be respected wherever the product offers them.</p>
        <p>Private media and account-only data are not intended to be exposed through public storage addresses. Access should be delivered through authenticated or first-party application flows.</p>
        <p>Members should only publish information they are comfortable sharing with the audience selected for that feature and should keep sensitive personal or credential information out of public posts.</p>
      </div>
    </section>
  )
}
