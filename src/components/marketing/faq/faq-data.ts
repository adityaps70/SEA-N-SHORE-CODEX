import { BUSINESS } from '@/config/business'
import { PLAN_PRICES, TRIAL_MONTHS, formatRupeesShort } from '@/features/billing/plans'

/**
 * Frequently asked questions — the one source for the landing-page FAQ and the full FAQ
 * on /help (including its FAQPage JSON-LD). Answers are plain text so they can be used
 * for structured data as-is; keep them in line with /pricing, /refunds and the product.
 *
 * Plan prices and trial lengths come from src/features/billing/plans.ts (PLAN_PRICES,
 * TRIAL_MONTHS), the same list the database is seeded from, so the FAQ never drifts.
 */
export type FaqItem = {
  id: string
  question: string
  answer: string
  /** An optional page to open after the answer (not part of the structured data). */
  link?: { href: string; label: string }
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

const price = (plan: 'creator_pro' | 'organization_pro', interval: 'month' | 'half_year' | 'year') => formatRupeesShort(PLAN_PRICES[plan][interval] ?? 0)

/** "₹99 a month or ₹999 a year" */
export const CREATOR_PRO_PRICE_TEXT = `${price('creator_pro', 'month')} a month or ${price('creator_pro', 'year')} a year`
/** "₹1,999 a month, ₹10,000 for 6 months or ₹14,999 a year" */
export const ORGANIZATION_PRO_PRICE_TEXT = `${price('organization_pro', 'month')} a month, ${price('organization_pro', 'half_year')} for 6 months or ${price('organization_pro', 'year')} a year`

function signInAnswer(googleEnabled: boolean) {
  const methods = googleEnabled
    ? 'your email address and password, or your Google account'
    : 'your email address and password'
  return `You sign in with ${methods}. Whichever you choose, you get the same free account. If the confirmation or password email does not arrive, check your spam or junk folder.`
}

const ONBOARDING_STEPS = 'Sign up with your email address, confirm it, then follow the short setup: choose what best describes you, say what you are here to do, and fill in your profile basics (name, location, and your rank or role and current organisation). If the confirmation email does not arrive, check your spam or junk folder.'

export function faqGroups({ googleEnabled = false }: FaqOptions = {}): FaqGroup[] {
  const email = BUSINESS.email

  return [
    {
      id: 'joining',
      title: 'Joining Sea N Shore',
      items: [
        {
          id: 'who-can-join',
          question: 'Who can join Sea N Shore?',
          answer:
            'Everyone in the maritime world. Seafarers and shore staff join with a free personal account and pick the description that fits them when they set up their profile: Seafarer, Shore Professional, Recruiter / HR, Trainer / Instructor, Student / Cadet, Seafarer Family, Maritime Enthusiast or Other. Marine and technical consultants join the same way (as a Shore Professional or Trainer / Instructor) and can offer their services with Creator Pro. Community veterans are welcome as members too. Shipping companies, manning agencies, institutes and other organizations register an organization page from their personal account under Organizations.',
        },
        {
          id: 'register-seafarer',
          question: 'How do I register as a seafarer, shore staff, consultant or community veteran?',
          answer:
            `${ONBOARDING_STEPS} After that, open Profile to complete your Maritime Passport: your professional headline and summary, sea service by vessel type, your CoC, STCW and other certificates, your career timeline and your CV or DG-format profile PDF. Consultants describe their specialisation in the summary and expertise section; community veterans can choose Seafarer Family, Maritime Enthusiast or Other and are not asked the professional questions.`,
        },
        {
          id: 'why-join',
          question: 'Why should I join Sea N Shore?',
          answer:
            'Sea N Shore is a one-stop platform for shipping companies, seafarers, consultants and shore staff. Candidates and employers connect directly, with no middlemen, which protects seafarers from fraudulent agents. Companies get quick access to qualified seafarers when a vessel needs someone urgently, and a quality place to fill sea and shore jobs. Marine and technical consultants can be found at short notice, which saves the travel, accommodation, visa and agency costs of flying an expert in. And it is a place for seafarers to share their experiences and seek help from people who understand the life.',
        },
        {
          id: 'sign-in',
          question: 'How do I sign in?',
          answer: signInAnswer(googleEnabled),
        },
      ],
    },
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
          id: 'register-company',
          question: 'How do I register my company?',
          answer:
            'Sign in with your personal account, open Organizations and choose Register a new organization. Enter the company name, type, website and business details and submit it for verification. The Sea N Shore team reviews and approves every organization before its page is published, so members only see real employers, institutes and organizers. Once approved you manage the page from its Manage screen: page details, branding, who can join and the team’s roles.',
        },
        {
          id: 'why-register-company',
          question: 'Why should a shipping company register?',
          answer:
            `Registering is free: a verified organization page that members can follow, that your employees can link to as their current organisation, and that posts updates in the feed under your name and logo. Organization Pro adds the hiring and publishing tools: post jobs and review applicants, publish events and courses, several administrators with team roles and permissions, applicant and student management, branding and page analytics. It costs ${ORGANIZATION_PRO_PRICE_TEXT}, and every organization gets the first ${TRIAL_MONTHS.organization_pro} months free with no payment details needed.`,
        },
        {
          id: 'post-job',
          question: 'How do I post a job as a company?',
          answer:
            'Open Hiring and choose Post a job. Post one vacancy per job with the full details: rank or role, vessel type, contract, joining date, requirements and how to apply. Candidates apply with their Maritime Passport and you review them under Hiring → Applicants. Posting jobs needs a verified organization with Organization Pro, or a verified independent recruiter with Creator Pro.',
        },
        {
          id: 'find-seafarers',
          question: 'How do I find seafarers, marine or technical consultants?',
          answer:
            'Use the search bar at the top to search people, organizations, jobs, courses and events, or open My Network and search members by name, rank, company, location, vessel type or skill. Open a profile to see the Maritime Passport, then Connect, Follow or Message. When you post a job, the candidates who apply are listed under Hiring → Applicants with their Maritime Match.',
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
            `Organization Pro is the plan for a verified organization page. It unlocks posting jobs and reviewing applicants, publishing events and courses, multiple administrators and team permissions, branding and page analytics. It costs ${ORGANIZATION_PRO_PRICE_TEXT}; the first ${TRIAL_MONTHS.organization_pro} months are free.`,
        },
      ],
    },
    {
      id: 'partners',
      title: 'Global partners',
      items: [
        {
          id: 'global-partner',
          question: 'How can my company become a Sea N Shore Global Partner?',
          answer:
            'We are looking for like-minded companies to represent the Sea N Shore global community in their countries, who share our mission and vision of a one-stop solution for the shipping industry. The next step is to contact us through the Contact page: email us with the subject "Global partnership", your company name, country and what you do, and the Sea N Shore team will get back to you.',
          link: { href: '/contact', label: 'Contact us about a global partnership' },
        },
        {
          id: 'global-partner-benefits',
          question: 'What are the benefits of being a Global Partner?',
          answer:
            'Global visibility for your company across the Sea N Shore community, bringing you more business: your logo and role on the Sea N Shore landing page and a direct line to the seafarers, companies and consultants who use the platform in your region.',
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
            `Creator Pro costs ${CREATOR_PRO_PRICE_TEXT} and is for members who publish courses and events or recruit independently; the first ${TRIAL_MONTHS.creator_pro} months are free. Organization Pro costs ${ORGANIZATION_PRO_PRICE_TEXT} and is bought for a verified organization page; the first ${TRIAL_MONTHS.organization_pro} months are free. All prices are in Indian rupees, and you see the exact amount before you pay.`,
        },
        {
          id: 'free-trial',
          question: 'How does the free trial work?',
          answer:
            `Start the free trial from Settings → Membership & billing (or an organization’s Plan & billing) with no payment details: Creator Pro is free for ${TRIAL_MONTHS.creator_pro} months and Organization Pro for ${TRIAL_MONTHS.organization_pro} months, once per member or organization. You can choose a paid plan at any time during the trial and the first payment is only taken on the day the trial ends. We remind you 7 days and 1 day before. If you do nothing, the account returns to the free plan; anything you published with Pro is kept but hidden until you subscribe.`,
        },
        {
          id: 'renewal',
          question: 'Do plans renew automatically? How do I cancel?',
          answer:
            'Yes, plans renew automatically each month, six months or year through Cashfree. You can cancel auto-renew at any time in Settings → Membership & billing (for an organization, an owner or administrator does this in its Plan & billing). You are not charged again, and the plan stays active until the end of the period you already paid for. Partly used periods are not refunded.',
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
  'who-can-join',
  'maritime-passport',
  'maritime-match',
  'register-company',
  'post-job',
  'plans',
  'free-trial',
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
