import type { Metadata } from 'next'
import { LegalList, LegalPage, LegalSection, RelatedPolicies, TextLink } from '@/components/legal/legal-page'
import { BUSINESS } from '@/config/business'
import { metaDescription } from '@/lib/seo/meta'

// Round H (H5): a canonical address and a plain-text search description.
export const metadata: Metadata = {
  title: 'Accessibility',
  description: metaDescription('Sea N Shore aims to meet WCAG 2.1 AA. What we have done, the gaps we know about, and how to report an accessibility barrier.'),
  alternates: { canonical: '/accessibility' },
}

/** Round H (H8): when the statement below was last checked against the site. */
const REVIEWED = 'October 2026'

const SECTIONS = [
  { href: '#target', label: 'Our target' },
  { href: '#done', label: 'What we have done' },
  { href: '#known-gaps', label: 'Known gaps' },
  { href: '#report', label: 'Report a problem' },
]

/**
 * Round H (H8): an honest accessibility statement: the standard we work to, what is in place, what we know
 * is not there yet, and how to tell us about a barrier.
 */
export default function AccessibilityPage() {
  return (
    <LegalPage
      eyebrow="Accessibility"
      title="Accessibility statement"
      updated={REVIEWED}
      sections={SECTIONS}
      intro={(
        <p>
          Sea N Shore should work for every maritime professional, including people who use a keyboard instead of a
          mouse, a screen reader, screen magnification or larger text. This page says what we aim for, what we have
          done, and where we still fall short.
        </p>
      )}
    >
      <LegalSection id="target" title="Our target">
        <p>
          We aim to meet the{' '}
          <TextLink href="https://www.w3.org/TR/WCAG21/">Web Content Accessibility Guidelines (WCAG) 2.1</TextLink>{' '}
          at level AA across the website. We do not claim full conformance yet: the known gaps below are the ones we
          know about, and there may be others.
        </p>
      </LegalSection>

      <LegalSection id="done" title="What we have done">
        <p>In our last review ({REVIEWED}) we checked and fixed the following:</p>
        <LegalList>
          <li>Text has a contrast of at least 4.5:1 against its background (3:1 for large text), and an automated test checks the colours we use for text.</li>
          <li>Readable text is at least 12 pixels, and secondary details such as job titles and times in the feed are 13 pixels.</li>
          <li>Links, buttons and form fields show a clear focus ring when you reach them with the keyboard.</li>
          <li>Each page has one main content area and a &ldquo;Skip to content&rdquo; link that jumps past the navigation.</li>
          <li>The navigation areas have distinct names (main, mobile and footer links), and every page has a heading, the Home feed included.</li>
          <li>Buttons and links have names that say what they do: message actions name the person who sent the message, file pickers are labelled, and menu items are named by their label.</li>
          <li>Animations are reduced when your device asks for reduced motion.</li>
          <li>Automated accessibility checks (axe-core) cover Home, Jobs, a job page, Messages, Learn, a course page, Settings and the home page for visitors.</li>
        </LegalList>
      </LegalSection>

      <LegalSection id="known-gaps" title="Known gaps">
        <p>These are the problems we know about and have not fixed yet:</p>
        <LegalList>
          <li>
            <strong className="font-semibold text-navy-950">Videos.</strong> Course videos that trainers upload have no
            captions or transcripts unless the trainer adds them to the lesson. YouTube and Vimeo videos play in those
            services&rsquo; own players, and SCORM course packages come from their authors, so their keyboard and screen
            reader support is outside our control.
          </li>
          <li>
            <strong className="font-semibold text-navy-950">PDF documents.</strong> PDFs that members, trainers and
            organizations upload (CVs, course materials, verification documents) may not be readable by screen readers.
            The invoices and certificates we generate as PDFs are not yet tagged for screen readers either.
          </li>
          <li>
            <strong className="font-semibold text-navy-950">Images without descriptions.</strong> A photo in a post is
            described only when the person who shared it added a description; older photos, and photos sent in
            messages, have only a generic description such as the file name.
          </li>
          <li>
            <strong className="font-semibold text-navy-950">Content written by members.</strong> Posts, comments, job
            descriptions and courses are written by our members, and we cannot check that all of it is clear and well
            structured.
          </li>
          <li>
            <strong className="font-semibold text-navy-950">Some complex tools.</strong> Image cropping, charts in the
            trainer and admin analytics pages and some course-building tools may be hard to use with a screen reader or
            a keyboard alone. On a few dark surfaces the focus ring may be harder to see than elsewhere.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection id="report" title="Report a problem">
        <p>
          If something on Sea N Shore is hard or impossible for you to use, please tell us through the{' '}
          <TextLink href="/contact#contact-form">contact form</TextLink> or by email to{' '}
          <TextLink href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</TextLink>. It helps to know:
        </p>
        <LegalList>
          <li>the page address, or what you were looking at;</li>
          <li>what you were trying to do, and what went wrong;</li>
          <li>your device and browser, and any assistive technology you use, such as a screen reader or zoom.</li>
        </LegalList>
        <p>
          We reply {BUSINESS.responseTime}. If you need information from a page in another format, ask us and we will
          help where we can.
        </p>
      </LegalSection>

      <RelatedPolicies
        links={[
          { href: '/help', label: 'Help' },
          { href: '/contact', label: 'Contact' },
          { href: '/privacy', label: 'Privacy Policy' },
        ]}
      />
    </LegalPage>
  )
}
