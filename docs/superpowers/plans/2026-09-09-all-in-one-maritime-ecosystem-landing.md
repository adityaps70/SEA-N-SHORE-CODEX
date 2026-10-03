# All-in-One Maritime Ecosystem Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Sea N Shore public landing page so it clearly presents the product as an all-in-one maritime ecosystem while preserving the current design system and truthful feature boundaries.

**Architecture:** Keep the existing marketing route, public header and visitor-action helper. Split the landing page into focused presentational sections backed by static, maritime-specific copy and existing product UI patterns; no new backend or database work is required. The hero and showcase UI should resemble the actual signed-in product rather than generic marketing cards.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS, lucide-react, Vitest/Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-09-all-in-one-maritime-ecosystem-landing.md`

## Global Constraints

- Work only on `feat/aws-native-phase-0-1`.
- Do not touch `main`, merge or create a PR.
- Preserve existing auth/onboarding behavior and `getPublicVisitorActions` routing.
- No database schema changes.
- No Cognito, SES, production DNS, Vercel or Supabase changes.
- Preserve the current navy/ocean/teal/mist visual system, typography, Wordmark, public header and RouteLine motif.
- Do not fabricate community-size numbers, testimonials, member identities, engagement metrics, verification states or live product features.
- Keep staging deploy and edge switches in `plan` except a guarded one-shot deployment after exact-head GREEN.
- RED → GREEN → exact-head CI → guarded staging deploy → fresh runtime/browser verification → switches back to `plan`.

---

### Task 1: Landing-page content contract and section shell

**Files:**
- Create: `src/app/(marketing)/landing-page.test.tsx`
- Create: `src/components/marketing/landing-section-heading.tsx`
- Modify: `src/app/(marketing)/page.tsx`

**Interfaces:**
- Consumes: `getPublicVisitorActions(Boolean(viewer))`, existing `Card`, `RouteLine`, design tokens.
- Produces: semantic landing-page shell with approved section headings and no legacy generic/development copy.

- [ ] Write a failing test rendering the marketing page with mocked auth/actions and asserting:
  - heading contains `The all-in-one professional ecosystem for the maritime industry.`
  - sections include `Maritime Passport`, `Built for every side of maritime`, `Professional conversations built around the work`, `Find the people you need across maritime`, `Why Sea N Shore exists`, and `Your maritime network should move with your career.`
  - legacy strings `Product preview`, `part of the next product phase`, and `still in development` are absent.
- [ ] Run the focused test and confirm RED.
- [ ] Add `LandingSectionHeading` for consistent eyebrow/title/body treatment using existing colors and typography.
- [ ] Refactor `page.tsx` into the approved section shell using semantic `<section>` elements while retaining current visitor-aware CTA links.
- [ ] Run focused test to GREEN and commit.

### Task 2: Product-native hero and community proof

**Files:**
- Create: `src/components/marketing/maritime-ecosystem-hero.tsx`
- Create: `src/components/marketing/maritime-ecosystem-hero.test.tsx`
- Create: `src/components/marketing/community-proof-strip.tsx`
- Modify: `src/app/(marketing)/page.tsx`

**Interfaces:**
- `MaritimeEcosystemHero` props: `{ primary: { href: string; label: string }; secondary: { href: string; label: string } }`.
- `CommunityProofStrip` has no external data dependencies and uses only truthful audience labels.

- [ ] Write failing hero tests requiring a Maritime Passport card, `Onboard / Ashore`, rank/sea-service cues, CoC/certification cue, feed/network cues and both visitor actions.
- [ ] Run focused tests and confirm RED.
- [ ] Implement responsive hero using existing `Card`, `RouteLine`, navy/ocean/teal colors and no `Product preview` label.
- [ ] Implement the proof strip with audience categories only: Seafarers, Shore Professionals, Recruiters & Crewing Teams, Maritime Companies.
- [ ] Wire into the marketing page, run tests GREEN, commit.

### Task 3: Ecosystem capabilities and Maritime Passport showcase

**Files:**
- Create: `src/components/marketing/ecosystem-capabilities.tsx`
- Create: `src/components/marketing/ecosystem-capabilities.test.tsx`
- Create: `src/components/marketing/maritime-passport-showcase.tsx`
- Create: `src/components/marketing/maritime-passport-showcase.test.tsx`
- Modify: `src/app/(marketing)/page.tsx`

**Interfaces:**
- Both components are presentational and have no backend dependencies.
- Passport showcase uses only features confirmed in the current profile implementation.

- [ ] Write failing tests requiring six capability labels: Maritime Passport, Professional Network, Maritime Feed, Career Visibility, Knowledge & Learning, Opportunities.
- [ ] Write failing Passport showcase test requiring Rank / role, Sea service, Vessel types, Cargo / engine experience, Trading areas, Onboard / Ashore, CoC & certificates, Career timeline, QR profile and Downloadable CV.
- [ ] Confirm RED.
- [ ] Implement capability cards with truthful copy; do not claim jobs marketplace/academy/verification are live.
- [ ] Implement product-style Passport panel resembling current profile cards.
- [ ] Wire page, run tests GREEN, commit.

### Task 4: Audience, feed, discovery and opportunities sections

**Files:**
- Create: `src/components/marketing/maritime-audiences.tsx`
- Create: `src/components/marketing/maritime-feed-showcase.tsx`
- Create: `src/components/marketing/professional-discovery-showcase.tsx`
- Create: `src/components/marketing/opportunities-showcase.tsx`
- Create: `src/components/marketing/maritime-ecosystem-sections.test.tsx`
- Modify: `src/app/(marketing)/page.tsx`

**Interfaces:**
- All components are static presentational sections.
- Feed examples are explicitly examples and contain no fake member names, photos or engagement counts.

- [ ] Write failing tests for four audiences: Seafarers, Shore Professionals, Recruiters & Crewing Teams, Maritime Companies.
- [ ] Require example professional discussions covering pilotage/bridge teamwork, purifier troubleshooting and SIRE 2.0 competency poll.
- [ ] Require discovery categories including Master Mariners, Chief Engineers, Marine Superintendents, Technical Superintendents, Crewing Managers and DPA / CSO.
- [ ] Require opportunities copy for sea careers, shore transitions, collaborations and talent discovery without a live-marketplace claim.
- [ ] Confirm RED.
- [ ] Implement the four sections using current card styles and responsive grids.
- [ ] Run tests GREEN, commit.

### Task 5: Why Sea N Shore, ecosystem journey and final CTA

**Files:**
- Create: `src/components/marketing/why-sea-n-shore.tsx`
- Create: `src/components/marketing/ecosystem-journey.tsx`
- Create: `src/components/marketing/final-ecosystem-cta.tsx`
- Create: `src/components/marketing/ecosystem-story.test.tsx`
- Modify: `src/app/(marketing)/page.tsx`

**Interfaces:**
- `FinalEcosystemCta` receives the same visitor-aware primary and secondary link objects as the hero.
- `EcosystemJourney` uses `RouteLine` decoratively to show Maritime Passport → Network → Knowledge → Opportunity.

- [ ] Write failing tests for fragmentation/sea-to-shore/knowledge/networking problem copy and the exact four-stage ecosystem journey.
- [ ] Require final headline `Your maritime network should move with your career.` and visitor-aware actions.
- [ ] Confirm RED.
- [ ] Implement the three sections, preserving semantic headings and mobile stacking.
- [ ] Run tests GREEN, commit.

### Task 6: Footer, responsive/accessibility contract and final page cleanup

**Files:**
- Create: `src/components/navigation/public-footer.tsx`
- Create: `src/components/navigation/public-footer.test.tsx`
- Modify: `src/app/(marketing)/layout.tsx`
- Modify: `src/app/(marketing)/landing-page.test.tsx`

**Interfaces:**
- Footer uses `Wordmark` and current visitor-aware actions.
- Legal links are omitted unless valid existing routes are discovered before implementation.

- [ ] Inspect existing routes for valid privacy/terms pages; include links only when they exist.
- [ ] Write failing footer test requiring Wordmark/Sea N Shore descriptor and current visitor-aware join/sign-in behavior, with no dead legal links.
- [ ] Add accessibility assertions for one H1, semantic section headings, descriptive CTA names, and absence of horizontal-overflow-inducing fixed widths in known landing components.
- [ ] Implement footer and wire marketing layout.
- [ ] Run focused + full tests GREEN and commit.

### Task 7: Exact-head verification and guarded staging rollout

**Files:**
- Modify only `scripts/aws/staging-deploy-action.txt` temporarily for one-shot deployment.

**Interfaces:**
- Consumes completed landing-page implementation.
- Produces live staging landing page with deployment switch restored to `plan`.

- [ ] Run exact-head AWS Infrastructure CI; require lint, typecheck, tests, Docker, Terraform and guard jobs success.
- [ ] Confirm `scripts/aws/edge-recovery-action.txt` remains `plan` and do not change WAF.
- [ ] Change staging deploy action from `plan` to the existing one-shot value, commit, and wait for exact-head CI.
- [ ] Allow existing guarded staging deployment workflow to build immutable image and update ECS.
- [ ] Verify new PRIMARY ECS deployment reaches `COMPLETED`, `desired=1`, `running=1`, `pending=0`, failed tasks `0`.
- [ ] Verify `/api/health/phase4` and `/api/health/home` return 200/healthy.
- [ ] Run a browser-level landing-page verification against CloudFront checking hero headline, core section headings, CTAs, no console errors and mobile-safe rendering where existing tooling permits.
- [ ] Reset staging deploy action to `plan`, commit, and require final exact-head CI GREEN.
