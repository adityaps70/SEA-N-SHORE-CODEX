/** Real routes the landing page links to. Kept together so tests and pages agree. */
export const LANDING_LINKS = {
  signIn: '/auth/sign-in',
  signUp: '/auth/sign-up',
  googleSignIn: '/auth/google/start?intent=sign-in',
  terms: '/terms',
  privacy: '/privacy',
  refunds: '/refunds',
  jobs: '/jobs',
  learn: '/learn',
  events: '/events',
  pricing: '/pricing',
  /** Opens the "Register a new organization" panel on /organizations (sign-in required). */
  registerOrganization: '/organizations?register=1#update-application',
  home: '/home',
  profile: '/profile',
} as const

/** Sections of the landing page, in page order, as shown in the header navigation. */
export const LANDING_SECTIONS = [
  { id: 'jobs', label: 'Jobs' },
  { id: 'passport', label: 'Passport' },
  { id: 'learn', label: 'Learn' },
  { id: 'events', label: 'Events' },
  { id: 'feed', label: 'Feed' },
  { id: 'organizations', label: 'For companies' },
  { id: 'pricing', label: 'Pricing' },
] as const
