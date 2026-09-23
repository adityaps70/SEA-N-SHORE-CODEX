import Link from 'next/link'

export default function TermsPage() {
  return (
    <section className="mx-auto max-w-3xl rounded-[1.75rem] border border-mist-100 bg-white p-6 shadow-[var(--shadow-card)] sm:p-8">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-ocean-700">Terms</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-navy-950">Responsible use of Sea N Shore</h1>
      <p className="mt-2 text-xs font-medium text-muted">Last updated: 23 September 2026</p>

      <div className="mt-6 space-y-7 text-sm leading-7 text-muted">
        <section aria-labelledby="responsible-use">
          <h2 id="responsible-use" className="text-lg font-bold text-navy-950">Professional and lawful use</h2>
          <div className="mt-2 space-y-3">
            <p>Members are responsible for the accuracy of information they submit and for using jobs, learning, messaging and community features professionally and lawfully.</p>
            <p>Do not impersonate another person or organisation, post fraudulent vacancies, misuse another member&apos;s information, or use the platform to distribute harmful, deceptive, infringing or unlawful content.</p>
            <p>Professional verification and trust signals improve context but do not replace a member&apos;s own due diligence before entering employment, commercial or training arrangements.</p>
          </div>
        </section>

        <section aria-labelledby="user-content">
          <h2 id="user-content" className="text-lg font-bold text-navy-950">User content and intellectual property</h2>
          <div className="mt-2 space-y-3">
            <p><strong className="text-navy-950">You retain ownership</strong> of the original content and intellectual-property rights you hold in material you post, upload or otherwise provide to Sea N Shore.</p>
            <p>When you submit user-generated content, you grant Sea N Shore a non-exclusive, worldwide, royalty-free licence to host, store, reproduce, process, technically format, display and distribute that content as reasonably necessary to operate, secure and provide the platform, including making it available to the audience you choose. This licence does not transfer ownership of your content to Sea N Shore.</p>
            <p>The licence continues for as long as the content remains on the service and may continue only to the extent reasonably necessary for backups, legal compliance, dispute handling, safety records or content that other members have independently shared or incorporated into permitted platform activity.</p>
            <p>You must have the rights and permissions needed for anything you upload. Do not post copyrighted images, videos, documents, articles, logos, course materials or other protected works unless you own them, have permission, or another lawful basis allows the use.</p>
          </div>
        </section>

        <section aria-labelledby="platform-ip">
          <h2 id="platform-ip" className="text-lg font-bold text-navy-950">Sea N Shore materials</h2>
          <p className="mt-2">The Sea N Shore name, branding, interface, software, original platform content and other materials supplied by Sea N Shore or its licensors remain protected by applicable intellectual-property laws. These terms do not grant members ownership of those materials.</p>
        </section>

        <section aria-labelledby="copyright-complaints">
          <h2 id="copyright-complaints" className="text-lg font-bold text-navy-950">Copyright complaints and review</h2>
          <div className="mt-2 space-y-3">
            <p>If you believe content on Sea N Shore infringes your copyright or other intellectual-property rights, use the content&apos;s <strong className="text-navy-950">Report</strong> control and choose <strong className="text-navy-950">Copyright or intellectual property infringement</strong>. Provide enough information to identify the original work, the material complained of, and your ownership or authority to act.</p>
            <p>Copyright complaints enter the platform moderation queue for review. Sea N Shore may request additional information, restrict or remove content while a complaint is assessed, preserve relevant records, restore content where appropriate, and take action against repeated or abusive misuse of the platform.</p>
            <p>
              See the <Link href="/copyright" className="font-semibold text-ocean-700 hover:underline">Copyright &amp; IP Policy</Link> for the reporting workflow and information to include in a complaint.
            </p>
          </div>
        </section>
      </div>
    </section>
  )
}
