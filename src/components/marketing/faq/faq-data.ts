import { BUSINESS } from '@/config/business'

/**
 * Frequently asked questions — the one source for the landing-page FAQ and the full FAQ
 * on /help (including its FAQPage JSON-LD). Answers are plain text so they can be used
 * for structured data as-is; keep them in line with /pricing, /refunds and the product.
 *
 * Plan prices here are the launch prices seeded in plan_prices (migration 0048). If an
 * admin changes a price, update these answers too.
 */
export type FaqItem = {
  id: string
  question: string
  answer: string
}

export type FaqGroup = {
  id: string
  title: string
  items: FaqItem[]
}

export type FaqOptions = {
  /** Google sign-in is only offered when AWS_COGNITO_GOOGLE_ENABLED is on. */
  googleEnabled?: boolean
}

function signInAnswer(googleEnabled: boolean) {
  const methods = googleEnabled
    ? 'your email address and password, your mobile number with a one-time code (OTP), or your Google account'
    : 'your email address and password, or your mobile number with a one-time code (OTP)'
  return `You can join and sign in with ${methods}. Whichever you choose, you get the same free account.`
}

export function faqGroups({ googleEnabled = false }: FaqOptions = {}): FaqGroup[] {
  const email = BUSINESS.email

  return [
    {
      id: 'seafarers',
      title: 'Seafarers & shore professionals',
      items: [
        {
          id: 'is-it-free',
          question: 'Is Sea N Shore free?',
          answer:
            'Yes. Membership is free for every seafarer and shore professional, with no card needed. You can build your Maritime Passport, apply for jobs, post in the feed, message people, follow organizations and join free events and courses. You only pay if you buy a paid course or event ticket, or choose the Creator Pro plan.',
        },
        {
          id: 'maritime-passport',
          question: 'What is the Maritime Passport?',
          answer:
            'It is your professional profile, written the way crewing offices read it: rank or role, department and availability, sea service by vessel type, your CoC, STCW and other certificates, and your career timeline. You can download it as a PDF profile in DG format to send to any crewing office, and certificates from courses you finish on Sea N Shore are added to it.',
        },
        {
          id: 'maritime-match',
          question: 'What is Maritime Match?',
          answer:
            'Every job shows a Maritime Match score: how well your Passport fits the role, based on things like rank, vessel type, years of experience, certificates, visas, trading areas and availability. It also lists what matches and what to check before you apply. It is a guide to help you decide — the employer still makes the hiring decision.',
        },
        {
          id: 'apply',
          question: 'How do I apply for a job?',
          answer:
            'Open a job and use Easy Apply to send your Maritime Passport to the employer. You can also save jobs for later and follow the status of every application you have sent. Jobs are posted only by verified organizations and recruiters.',
        },
      ],
    },
    {
      id: 'organizations',
      title: 'Companies & organizations',
      items: [
        {
          id: 'create-page',
          question: 'How do I create a page for my company or institute?',
          answer:
            'Sign in, open Organizations and register your organization with its name, type, website and business details — it is free. Sea N Shore reviews and verifies every organization before its page is published, so members only see real employers, institutes and organizers.',
        },
        {
          id: 'unclaimed',
          question: 'My company is not on Sea N Shore yet. Can I still add it?',
          answer:
            'Yes. An employee can add it, and it is shown as "Unclaimed" until its owner takes it over. The owner can claim the page later; it becomes theirs to manage once Sea N Shore has verified the claim.',
        },
        {
          id: 'team',
          question: 'Who can manage our page and post for the organization?',
          answer:
            'The owner and administrators decide who joins the organization and with which role, and approve people who ask to join. Owners, administrators and content managers can post in the feed as the organization, with its name and logo. Other roles cover recruiting, courses, events and analytics.',
        },
        {
          id: 'org-pro',
          question: 'What does Organization Pro add?',
          answer:
            'Organization Pro is the plan for a verified organization page. It unlocks posting jobs and reviewing applicants, publishing events and courses, multiple administrators and team permissions, branding and page analytics. It costs ₹2,000 a month or ₹20,000 a year.',
        },
      ],
    },
    {
      id: 'learning-events',
      title: 'Courses & events',
      items: [
        {
          id: 'courses',
          question: 'How do courses and certificates work?',
          answer:
            'Courses are run by verified maritime trainers and organizations. Some are free, some are paid. When you complete a course that offers a certificate, the certificate is added to your Maritime Passport so employers can see it.',
        },
        {
          id: 'paid-checkout',
          question: 'How do I pay for a course or an event ticket?',
          answer:
            'Paid courses and event tickets are paid online by UPI or card through our payment gateway, Cashfree Payments. The price is shown on the course or event page and again before you pay. Your course opens in My learning, or your ticket appears in My events, as soon as the payment is confirmed.',
        },
        {
          id: 'sell',
          question: 'Can I sell my own course or run a paid event?',
          answer:
            'Yes. Verified trainers and event hosts can publish courses and events with Creator Pro, and organizations with Organization Pro. You set the price. Sea N Shore collects the payment from buyers and pays you your share, minus a platform fee, to your bank account after a holding period. Refunds to buyers are deducted from your earnings.',
        },
      ],
    },
    {
      id: 'payments',
      title: 'Payments & plans',
      items: [
        {
          id: 'plans',
          question: 'What do the paid plans cost?',
          answer:
            'Creator Pro costs ₹100 a month or ₹1,000 a year and is for members who publish courses and events. Organization Pro costs ₹2,000 a month or ₹20,000 a year and is bought for a verified organization page. All prices are in Indian rupees, and you see the exact amount before you pay.',
        },
        {
          id: 'renewal',
          question: 'Do plans renew automatically? How do I cancel?',
          answer:
            'Yes, plans renew automatically each month or year through Cashfree. You can cancel auto-renew at any time in Settings → Membership & billing (for an organization, an owner or administrator does this in its Plan & billing). You are not charged again, and the plan stays active until the end of the period you already paid for. Partly used periods are not refunded.',
        },
        {
          id: 'plan-ends',
          question: 'What happens when a paid plan ends?',
          answer:
            'The plan features stop. Jobs, events and courses published under the plan are hidden from members until you renew, and come back when the plan is active again.',
        },
        {
          id: 'refunds',
          question: 'Can I get a refund?',
          answer: `Event tickets are refunded in full if the organizer cancels, or if you cancel at least 48 hours before the event. Paid courses can be refunded within 7 days of purchase if you have completed less than 20% and no certificate has been issued. Email ${email} with your order ID. The Refund & cancellation policy has the full rules.`,
        },
      ],
    },
    {
      id: 'account',
      title: 'Account & privacy',
      items: [
        {
          id: 'sign-in',
          question: 'How do I sign in?',
          answer: signInAnswer(googleEnabled),
        },
        {
          id: 'delete-account',
          question: 'How do I delete my account, and what happens?',
          answer:
            'Go to Settings → Your data & privacy and choose Delete my account. Your personal data — profile, posts, comments, applications, connections and messages you sent — is deleted and cannot be recovered. An organization that you alone manage keeps its page, but its jobs, events and courses are removed. People who bought your courses or event tickets keep their access.',
        },
        {
          id: 'download-data',
          question: 'Can I download a copy of my data?',
          answer:
            'Yes. Go to Settings → Your data & privacy to download a copy of your data at any time.',
        },
        {
          id: 'contact',
          question: 'How do I contact Sea N Shore?',
          answer: `Email ${email} or call ${BUSINESS.phone.display} (${BUSINESS.supportHours}). We reply ${BUSINESS.responseTime}. For a payment question, include your order ID.`,
        },
      ],
    },
  ]
}

/** The short list shown on the landing page, in display order. */
const LANDING_FAQ_IDS = [
  'is-it-free',
  'maritime-passport',
  'maritime-match',
  'create-page',
  'unclaimed',
  'plans',
  'renewal',
  'paid-checkout',
  'sign-in',
  'delete-account',
] as const

export function landingFaqs(options: FaqOptions = {}): FaqItem[] {
  const all = faqGroups(options).flatMap((group) => group.items)
  return LANDING_FAQ_IDS.map((id) => all.find((item) => item.id === id)).filter((item): item is FaqItem => Boolean(item))
}

/** schema.org FAQPage structured data for the given questions. */
export function faqJsonLd(items: FaqItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  }
}

/** JSON for a <script type="application/ld+json">, with "<" escaped so it cannot close the tag. */
export function jsonLdScript(data: unknown) {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}
