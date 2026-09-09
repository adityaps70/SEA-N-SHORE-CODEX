# Sea N Shore Landing Page Redesign

## Objective

Redesign the public Sea N Shore landing page so it feels unmistakably maritime, explains the actual product within seconds, and converts visitors into signed-in members without breaking the existing product visual language.

The redesign must preserve the current Sea N Shore design system: navy/ocean/teal palette, mist/off-white backgrounds, rounded cards, subtle borders, RouteLine motif, current typography, current Wordmark/header behavior, restrained motion, and the existing authenticated/unauthenticated CTA logic.

## Positioning

Primary positioning:

**The professional network built for the maritime industry.**

Supporting idea:

Sea N Shore brings maritime identity, community, professional knowledge, networking and career visibility into one professional network for seafarers, shore professionals, recruiters and maritime companies.

Avoid positioning the product as a generic social network. Avoid overstating future features.

## Landing Page Information Architecture

### 1. Header

Keep the existing PublicHeader visual language and visitor-aware Login / Join behavior.

Do not add a large multi-level navigation bar in this phase.

### 2. Hero

Replace the current generic headline and abstract Product Preview.

Headline:

**The professional network built for the maritime industry.**

Supporting copy should explain that members can build a Maritime Passport, connect with maritime professionals, share industry knowledge and improve career visibility.

Primary CTA:
- Signed out: Join Sea N Shore / Create profile
- Signed in: Open Sea N Shore / Go to Home

Secondary CTA:
- Signed out: Explore the community or Sign in, depending on the existing visitor-action helper
- Signed in: Explore network / Open profile, using existing action semantics

Hero visual must look like a real slice of Sea N Shore rather than a generic mock product card. It should combine:
- Maritime Passport identity card
- Rank / role
- Vessel experience
- Onboard / Ashore status
- Certification / credential hint
- Professional feed/network preview

No fake user statistics or fake verification badges.

### 3. Community Proof Strip

Add a compact trust strip immediately below the hero.

Use audience categories that are truthful and always safe to state:
- Seafarers
- Shore Professionals
- Recruiters & Crewing Teams
- Maritime Companies

A member-count number should only be added when it is backed by a live or explicitly approved source. Do not hardcode an unverified number into the landing page.

### 4. Core Platform Capabilities

Replace the current generic four pillars with six concrete product capability cards:

1. Maritime Passport
2. Professional Network
3. Maritime Feed
4. Career Visibility
5. Knowledge & Learning
6. Opportunities

Each card should explain a real current capability or a safely phrased direction. Do not say an unavailable feature is live.

### 5. Maritime Passport Showcase

Make Maritime Passport the strongest product-specific section.

Headline direction:

**Your maritime career. One professional identity.**

Show real fields already present in the product:
- Rank / role
- Sea service
- Current vessel
- Vessel types
- Cargo experience
- Engine experience
- Trading areas
- Onboard / Ashore availability
- CoC / certifications
- Career timeline
- QR-ready public profile
- Downloadable CV

CTA: Create your Maritime Passport / Open your Maritime Passport depending on viewer state.

### 6. Built For Every Side Of Maritime

Four audience cards:

#### Seafarers
- Professional maritime identity
- Build industry connections
- Share professional knowledge
- Improve career visibility

#### Shore Professionals
- Maintain professional visibility after coming ashore
- Network across companies and functions
- Share expertise and industry knowledge

#### Recruiters & Crewing Teams
- Discover maritime professionals
- Understand actual role and experience context
- See availability and relevant professional information

#### Maritime Companies
- Build professional visibility
- Discover talent and expertise
- Participate in industry conversations

Do not imply recruiter workflows, ATS functionality, employer dashboards or verification features unless they are already available.

### 7. Professional Feed Showcase

Use realistic maritime examples rather than generic marketing copy.

Suggested content examples:
- Bridge-team behavior / pilotage discussion
- Chief Engineer technical troubleshooting lesson
- SIRE 2.0 competency poll

The cards are illustrative product UI, not fabricated member testimonials. Keep names generic or use role labels rather than fake real people.

### 8. Professional Discovery

Add a section explaining who members can discover across maritime.

Example role chips:
- Master Mariners
- Chief Engineers
- Marine Superintendents
- Technical Superintendents
- Crewing Managers
- DPA / CSO
- Marine Consultants
- Trainers
- Recruiters

Visual presentation should resemble existing search/network UI patterns.

### 9. Opportunities

Use safe positioning:

**Grow your maritime career and discover opportunities.**

Mention:
- Sea-going opportunities
- Shore career visibility
- Professional collaborations
- Industry connections

Do not present Jobs as a fully active service if the dedicated jobs workflow is still incomplete.

### 10. Why Sea N Shore Exists

Add a concise problem/mission section.

Headline direction:

**Maritime careers should not depend on who happens to know you.**

Explain the fragmentation Sea N Shore addresses:
- Professional identity is scattered
- Connections are lost between contracts
- Shore transitions are difficult
- Useful maritime knowledge is fragmented
- Recruitment remains heavily relationship-driven

Then position Sea N Shore as one professional network connecting identity, community, knowledge and opportunity.

### 11. Ecosystem Flow

Use the existing RouteLine motif to show a simple four-stage path:

**Maritime Passport → Network → Knowledge → Opportunity**

This should be a visual story, not a separate product architecture diagram.

### 12. Testimonials / Maritime Voices

Do not fabricate testimonials.

For this phase, either:
- omit the section entirely, or
- render a clearly marked placeholder only if backed by real approved quotes in source data.

Default implementation: omit testimonials until authentic quotes are supplied.

### 13. Final CTA

Headline direction:

**Your maritime network should move with your career.**

Supporting copy should work for both onboard and ashore members.

Primary CTA: Create Sea N Shore profile / Open Sea N Shore based on viewer state.
Secondary CTA: Sign in / Explore network based on viewer state.

### 14. Footer

Add a lightweight footer using the current Wordmark and visual language.

Keep it minimal. Suggested links only where routes already exist:
- Sign in / Join
- Public community/profile discovery entry point if available
- Terms / Privacy only if real routes already exist

Do not add dead links.

## Content To Remove Or Replace

Remove or replace the following from the current page:

- Generic hero headline: “Where maritime careers and knowledge move forward.”
- Generic “Product preview” label.
- Current Careers card copy that explicitly says careers are part of the next product phase.
- Current four generic pillars: Network / Careers / Knowledge / Trust.
- Bottom disclaimer listing Formal identity verification badges, Jobs, Communities, Events and Academy as still in development.
- Generic marketing language that could describe any professional network.

Do not hide product limitations by making false claims. Instead, simply avoid featuring unfinished capabilities as active features.

## Visual Design Rules

Preserve:
- Current PublicHeader
- Current Wordmark
- navy-950 / ocean / teal palette
- mist backgrounds
- existing Card language
- RouteLine motif
- rounded-xl / rounded-2xl geometry
- current typography and spacing rhythm
- subtle shadow usage only

Add:
- stronger visual hierarchy
- alternating white / mist / navy section backgrounds
- product-like cards rather than decorative illustrations
- responsive grid layouts
- restrained hover transitions
- no excessive gradients, glassmorphism or unrelated SaaS aesthetics

## Responsive Behavior

Mobile must remain first-class:
- Hero stacks vertically
- CTA buttons become full-width where appropriate
- Product showcase avoids tiny text
- Audience/capability cards reduce to one column
- Role chips wrap naturally
- No horizontal scrolling
- PublicHeader remains usable on narrow screens

## Accessibility

- One H1 only
- Section headings use correct hierarchy
- Decorative icons use `aria-hidden`
- CTA labels remain explicit
- Sufficient text/background contrast
- No information encoded by color alone
- Respect reduced-motion preferences for any motion added

## Technical Scope

Primary file:
- `src/app/(marketing)/page.tsx`

Likely supporting components under:
- `src/components/marketing/`

Potentially update:
- marketing-page tests / landing-page contract tests
- no changes to authenticated app shell, onboarding, profile behavior, Cognito, SES or AWS infrastructure are required for the landing redesign itself

## Testing Contract

RED tests should require:
- exact maritime-specific hero positioning
- no “Product preview” copy
- no “next product phase” Careers copy
- no development disclaimer
- Maritime Passport showcase
- concrete platform capability labels
- four maritime audience groups
- professional feed examples
- professional discovery role labels
- final conversion CTA
- visitor-aware CTA semantics remain intact

GREEN must pass:
- lint
- typecheck
- focused landing-page tests
- full application test suite
- production Docker build
- existing AWS infrastructure/guard checks

Then follow existing deployment sequence:
- exact-head CI
- staging deploy-once
- fresh runtime verification
- return staging deploy switch to `plan`

## Explicit Non-Goals

This redesign does not:
- make unfinished Jobs workflows active
- create an employer ATS
- create new verification badges
- create Events or Academy workflows
- change authentication or onboarding
- change profile-media infrastructure
- change production DNS
- merge to `main` or create a PR
