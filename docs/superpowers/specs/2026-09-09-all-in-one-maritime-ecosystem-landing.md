# Sea N Shore All-in-One Maritime Ecosystem Landing Page

## Positioning

Position Sea N Shore as an **all-in-one maritime ecosystem** rather than a generic professional network or a clone of a mainstream social platform.

The landing page must make four things obvious within the first screenfuls:

1. Sea N Shore is built specifically for the maritime industry.
2. It serves seafarers, shore professionals, recruiters/crewing teams and maritime companies.
3. It connects professional identity, networking, knowledge and opportunity in one ecosystem.
4. The product already has real usable features; the page must not market unavailable features as if they are live.

## Visual language

Preserve the existing Sea N Shore application design system:

- Navy / ocean blue / teal palette.
- Mist/off-white page background.
- White cards with restrained borders.
- Existing typography and spacing rhythm.
- Existing Wordmark and public header.
- Existing RouteLine brand motif.
- Rounded 12-16px controls and cards.
- Professional, maritime, premium tone rather than flashy startup gradients or unrelated stock imagery.
- Motion should be restrained and optional; no interaction should depend on animation.

The landing page should feel like the public face of the same product users see after signing in.

## Information architecture

### 1. Hero — all-in-one ecosystem

Primary message:

**The all-in-one professional ecosystem for the maritime industry.**

Supporting copy should explain that members can build their Maritime Passport, connect across sea and shore, exchange practical industry knowledge and discover career/professional opportunities.

Primary CTA should use the existing visitor action helper and resolve to the current join/continue experience.
Secondary CTA should use the existing visitor action helper and resolve to the current explore/sign-in experience.

The hero visual should be a product-native composite showing:

- Maritime Passport identity card.
- Onboard/Ashore availability.
- Rank / role and sea service.
- Certification/CoC cue.
- Professional feed preview.
- Network/discovery cue.

Do not label this visual as “Product preview.” Present it as the product itself.

### 2. Community proof strip

Use only truthful, non-fabricated proof.

Allowed copy categories:

- “Maritime professionals across sea and shore.”
- “Seafarers.”
- “Shore professionals.”
- “Recruiters & crewing teams.”
- “Maritime companies.”

Do not hard-code community-size numbers unless they are represented by an approved source of truth in the application or configuration.

### 3. Core ecosystem capabilities

Replace the generic Network / Careers / Knowledge / Trust pillar grid with concrete capability cards:

- Maritime Passport.
- Professional Network.
- Maritime Feed.
- Career Visibility.
- Knowledge & Learning.
- Opportunities.

Copy must distinguish between currently usable features and ecosystem direction. Do not say a jobs marketplace, academy or verification workflow is live if it is not operational.

### 4. Maritime Passport showcase

Show the value of the current profile system as a major product differentiator.

Feature list may include:

- Rank / professional role.
- Sea service.
- Current vessel / company where available.
- Vessel types.
- Cargo / engine experience.
- Trading areas.
- Onboard / Ashore availability.
- CoC / certification wallet.
- Career timeline.
- Public profile sharing / QR.
- Downloadable CV.

The section must not show a formal verification badge unless a real verification state supports it.

### 5. Built for every side of maritime

Four role cards:

- Seafarers.
- Shore Professionals.
- Recruiters & Crewing Teams.
- Maritime Companies.

Each card should explain concrete value rather than generic community language.

### 6. Maritime feed showcase

Use static sample UI framed clearly as examples of the kinds of professional discussion supported by the platform, not as real member posts.

Examples should be maritime-specific, such as:

- Bridge-team behaviour / pilotage.
- Engineering troubleshooting / purifier alarms.
- SIRE 2.0 competency poll.

Do not attach real member names, photos or engagement counts to fabricated examples.

### 7. Professional discovery

Show how Sea N Shore helps members discover people across the industry.

Example professional categories:

- Master Mariners.
- Chief Engineers.
- Marine Superintendents.
- Technical Superintendents.
- Crewing Managers.
- DPA / CSO.
- Maritime trainers / consultants.
- Recruiters.

Do not claim advanced search filters that do not exist.

### 8. Opportunities

Frame opportunities broadly and truthfully:

- Sea careers.
- Shore transitions.
- Professional collaborations.
- Talent discovery.
- Knowledge / mentoring relationships.

Do not market the unfinished Jobs workflow as a fully live marketplace.

### 9. Why Sea N Shore exists

Explain the maritime-specific problem:

- Professional identity is fragmented across contracts and companies.
- Useful maritime knowledge is scattered.
- Career movement between sea and shore is difficult.
- Professional discovery and recruitment are relationship-heavy.
- Members often lose valuable industry connections between contracts.

Position Sea N Shore as the network connecting identity, people, knowledge and opportunity.

### 10. Ecosystem journey

Use the existing RouteLine motif to communicate:

**Maritime Passport → Network → Knowledge → Opportunity**

This should be a conceptual journey, not a promise of an automated workflow.

### 11. Testimonials / voices

Do not add fabricated testimonials. If no approved real testimonials are available in source, omit this section for this implementation.

### 12. Final CTA

Primary message:

**Your maritime network should move with your career.**

Support the idea that a member’s professional identity remains useful whether onboard, ashore, hiring, learning or sharing experience.

Use the existing visitor action helper for CTA behavior.

## Remove or replace

Remove:

- “Product preview” label.
- Generic four-card pillar presentation.
- Explicit marketing-page disclaimer that major features are “still in development.”
- Copy presenting Careers as only a future phase.
- Generic phrases that could apply to any professional social network.

Replace those with maritime-specific, truthful capability language.

## Header and footer

Keep the existing public header and its current visitor-aware actions.

A simple footer should be added if the marketing layout currently has none, containing:

- Sea N Shore Wordmark / short descriptor.
- Sign in / join links via existing visitor actions where appropriate.
- Privacy / terms links only if valid routes exist; do not create dead links.
- A short statement that Sea N Shore is a professional maritime community.

If valid legal routes are not present, omit those links in this phase.

## Responsive behavior

- Mobile-first.
- Hero stacks cleanly on small screens.
- Capability cards become one column on narrow devices.
- Product showcase should remain readable without horizontal scrolling.
- No text should overlap decorative RouteLine elements.
- CTAs maintain at least 44px touch height.

## Accessibility

- Semantic heading hierarchy.
- RouteLine/decorative icons hidden from screen readers when appropriate.
- Meaningful sections have `aria-labelledby` or readable headings.
- Buttons/links have descriptive names.
- Contrast stays within the existing design system.

## Technical constraints

- Repository: `adityaps70/SEA-N-SHORE-CODEX`.
- Branch only: `feat/aws-native-phase-0-1`.
- Do not touch `main`, merge or create a PR.
- Preserve existing auth/onboarding behavior and visitor action routing.
- No new database schema is required.
- No changes to Cognito, SES, production DNS, Vercel or Supabase.
- Keep staging deploy and edge action switches in `plan` except a guarded one-shot deployment when implementation is fully green.
- Follow RED → GREEN → exact-head CI → guarded staging deploy → fresh runtime/browser verification → return deploy switch to `plan`.
