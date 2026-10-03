# Sea N Shore Website Quality Pass Spec

## Goal
Complete the approved 15-item website quality review on the AWS-native Sea N Shore staging branch without regressing existing LMS, messaging, hiring, onboarding, or profile behavior.

## Global constraints
- Repository: `adityaps70/SEA-N-SHORE-CODEX`.
- Branch: `feat/aws-native-phase-0-1` only.
- Re-fetch the live branch head before every repository write.
- Do not touch `main`, merge, create a PR, force-push, or reset.
- AWS account: `310356785722` only.
- Staging URL: `https://d3prih0q6jofyr.cloudfront.net`.
- Deploy role: `arn:aws:iam::310356785722:role/sea-n-shore-staging-github-deploy`.
- Media bucket: `sea-n-shore-staging-310356785722-media`.
- One-shot guards stay `plan` except during an explicitly armed one-shot action; restore immediately after terminal action.
- TDD for behavior changes and fresh verification before completion claims.

## Requirements
1. Preserve the already-implemented username onboarding flow: realtime availability while typing, `@username` in Profile, and at most two profile username edits. Add regression coverage.
2. Stop exposing raw staging S3 hostnames for feed media; keep storage private and serve browser reads through a first-party Sea N Shore/CloudFront path.
3. Make profile completeness reflect real profile sections; an empty experience or licences/credentials section must prevent 100% and the UI must identify remaining work.
4. Make unread notifications visibly and accessibly distinct from read notifications.
5. Upgrade global header search from people-only redirection to a retained-query search experience across People, Jobs, Courses, and Events.
6. Simplify network cards to one primary relationship action/state: Connect -> Pending -> Message. Move follow/unfollow, withdraw/disconnect, report, and block under More where appropriate.
7. Prevent demo/test identities from appearing as genuine professionals in public discovery/recommendations; use explicit non-public/test marking or safe filtering rather than name-only heuristics where possible.
8. Distinguish true empty states from filtered zero-result states in Jobs, Events, and Profile-related sections, and offer the single most useful next action.
9. Replace Jobs' manual Apply-filters flow with auto-applied URL-backed filters, active removable chips, `N filters · Clear all`, collapsed advanced filters, and live result count.
10. Fix Learn catalog count/category overflow and enrich cards with available lesson count, duration, level, certificate state, CTA, and course-specific imagery/fallback visual.
11. Add a compact LinkedIn-style trust/legal footer/site rail with About, How verification works, For employers, Help/FAQ, Contact, Terms, Privacy, and social links; create real destinations rather than dead links.
12. Upgrade post composer with audience selector, post type (Update / Question / Technical poll), topic tags, character count, and resilient local draft autosave/recovery.
13. Add a New message flow with recipient picker; conversation rows show participant avatar, maritime rank/company, last-message preview, and clear unread/read treatment.
14. Replace hard-coded Jobs result caption with explicit sort behavior/copy for Best match / Newest / Salary.
15. Keep automated E2E learning courses/mentors out of the public Learn catalog and harden the E2E fixture lifecycle so test content is non-public or cleaned up.

## Implementation boundaries
- Reuse current schema and repositories wherever possible.
- Introduce a bounded migration only when durable state cannot be represented safely with current columns/tables.
- Do not rerun already-applied migration `0023_profile_username.sql`.
- Prefer stable semantic markers for test/demo visibility and same-origin media URLs over brittle UI-only hiding.
- Preserve existing auth/authorization boundaries.

## Verification
- Unit/component/repository tests for each behavior slice.
- Exact-head full AWS Infrastructure CI must be green before staging deployment.
- Use the existing staging deploy one-shot guard only after CI is green.
- Restore `scripts/aws/staging-deploy-action.txt` to `plan` immediately after terminal deployment.
- Run bounded live staging checks for public/authenticated paths available through existing test-user/remote verification patterns; do not fabricate authenticated evidence where unavailable.
