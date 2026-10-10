# Learning round C: trainer operations and selling

Started 10 October 2026 from feature head `59f067a4` (after round B was released: web :240, outbox :122,
notification :121, every guard at plan).

Ship plan: PR 1 = C0 + C1 + C2 + C3 + the round's migrations (0074–0075, which also hold the C5 and C7 schema);
PR 2 = C5 + C6 + C7 + C8. Then one guarded migration run and one deploy. C4 (GST invoices) waits for the owner's
answers. Owner merges every arm PR.

## Step 0 findings (verified against the code on 10 October)

| Item | Before this round |
|---|---|
| C0.1 teach form | Topics are split on commas, trimmed, blanks, trailing commas and duplicates dropped (client and server). The action returns zod's first raw message into one box under the form; typed values are kept. No per-field messages. An unparseable LinkedIn URL makes the schema throw. |
| C0.1 raw messages | No global zod error map. About 15 member-facing actions return `issues[0].message` with zod's defaults for some rules (sign-up name/email, job limits, report reason, community visibility, studio material and lesson limits, assignment response, quiz settings, certificate settings, organisation access request, username); profile media upload can return internal codes. |
| C0.2 certificates | `verification_code` is `uuid` (0018), so a non-UUID code makes Postgres throw and the page answers 500. |
| C0.3 digest | `sweepSubmissionsToGrade` counts `learning_assignment_attempts` only. |
| C0.4 Docker | `# syntax=docker/dockerfile:1.7` and three `FROM node:22-bookworm-slim` come from Docker Hub; nothing uses ECR Public. |
| C1 roster | None. Trainers see learner names only in grading and sales. No way to enrol someone else; no course invitations. Audit events are inline inserts; CSV helper `csvCell`. |
| C2 promo codes | None. The order check `amount_minor = coalesce(discount, list)` must widen. The fee is charged on the amount paid (integer basis points, half-up), hold and payouts are separate. |
| C3 plans and expiry | None. Enrolments never expire (one row per learner and course); access checks are `status in ('active','completed')`. |
| C4 GST | Nothing. `BUSINESS.gstin` is empty (owner to-do); My Learning shows payment records only. |
| C5 | No ratings, reviews or announcements. Moderation is report-driven (`content_reports`). The player has no tabs. The Learning email opt-out exists. |
| C6 | My Learning: a card grid and a purchases list; next-lesson logic exists only in the player. |
| C7 | `community_groups` (public/private) and memberships exist; nothing links a course. |
| C8 | Studio analytics show totals only, with no charts; the data for drop-off, item difficulty and time series exists. |

Also found, not changed (payments are limited to this round's list): Razorpay webhooks confirm event orders only, so
a Razorpay course payment is confirmed only by the buyer's return page.

Owner decisions (10 October):
- A promo code never brings the price below the gateway minimum (₹1 / $1): every order still goes through the gateway.
- A code applies to the current price (the sale price when one is set), so the two discounts add up.
- Community membership granted through a course stays when the course access ends.
- The migration may relax exactly five checks: the order amount (minus the promo discount), the enrolment source
  ('trainer'), the content report and moderation action target types ('course_review'), and the Learning email kind
  ('announcement').

## Migrations (one guarded runner for the round, from the template)

- [x] `0074_learning_round_c_notification_types.sql`: in-app type for course announcements
- [x] `0075_learning_round_c.sql`: plans, enrolment plan/expiry/enrolled_by, invitations, promo codes and
      redemptions, order plan and promo columns, reviews, announcements, course community link, quiz digest column,
      the five approved relaxations, and the Standard plan backfill (inserts only)
- [x] `aws-learning-round-c-migration.yml` + runner + guard (plan) + contract test, rendered from
      `scripts/aws/templates/guarded-migration/`; round checks after apply (tables, columns, the five checks, no paid
      course without a plan)
- [x] Applies cleanly after every earlier migration in PGlite
- [x] Plan run on the merged head (run 38035159195 on 17580b6f: ADDITIVE, 33-statement preview rolled back, PLAN_ONLY_NO_APPLY)
- [x] Arm PR #185 (owner merged), migrate-once run 38041336747: 0074 and 0075 applied, APPLY_VERIFIED=true, 1 Standard plan backfilled, 0 paid courses without a plan; rearmed to plan (cb50b601)

## PR 1: C0 + C1 + C2 + C3

C0 — small fixes
- [x] Teach form: plain message under "Proposed course topics", field highlighted, values kept, same message from the server
- [x] Raw validation messages mapped to plain field messages across member-facing forms, with tests
- [x] `/certificates/<non-UUID>`: "Certificate not verified" with 404, with a test
- [x] Trainer digest counts written quiz answers awaiting grading, with a test
- [x] Base images from Amazon ECR Public (no Docker Hub in the deploy path, no new paid service)
- [x] The round's runner comes from the guarded-migration template

C1 — learner roster
- [x] Studio → course → Learners: name, rank, enrolled, progress, last active, quiz scores, certificate status
- [x] Enrol by email: a member is enrolled now ("enrolled by trainer"); a non-member gets an invitation and is enrolled on sign-up
- [x] CSV export, recorded in audit_events (who, course, rows; no personal data)
- [x] "Message all learners" posts a C5 announcement, rate limited

C2 — promo codes
- [x] Per course or all of a trainer's courses; percent or fixed; maximum discount; total and per-member limits; window
- [x] Validated and applied on the server at checkout; usage reserved atomically; never below ₹1/$1; fee on the paid amount
- [x] Redemptions and revenue per code in Studio
- [x] Real-SQL tests: expired, exhausted, per-member reuse, race on the last use

C3 — pricing plans and access expiry
- [x] Several plans per course (price, sale price, INR/USD, 6 / 12 months or lifetime)
- [x] Expired access is read-only with "Renew"; progress and certificates kept
- [x] Existing courses: one "Standard" lifetime plan; nothing changes for current buyers

## PR 2: C5 + C6 + C7 + C8

- [x] C5 Rate this course (1–5 stars + review, ≥20% progress, one per learner, editable), moderated, average and
      approved reviews on the course page; announcements tab in the player + Learning email
- [x] C6 resume card ("Continue: course · lesson X of Y") and Courses / Certificates / Purchases tabs
- [x] C7 link a course to one community the trainer runs; "Ask the trainer / Discuss" in the player; private
      communities open to enrolled learners
- [x] C8 Studio charts: per-lesson drop-off, quiz item difficulty, enrolments and revenue over time

## C4 — GST invoices and payout tax (owner answers, confirmed with the CA)

Issuer on every invoice: Beaufort Marine Services LLP (Sea N Shore), GSTIN 27AASFB2030K1ZE (Regular), Panvel,
Maharashtra 410206. Sea N Shore supplies every course (not a marketplace, no TCS). SAC 999293, GST 18% included in
the price. Owner decisions (10 Oct): rules apply to course earnings of all course sellers (mentors and organisations),
event payouts unchanged; the seller-invoice period is the calendar month (IST); TDS uses the catch-up rule; PDFs print
"INR" instead of the rupee sign.

- [x] Migration 0076 (additive) + guarded runner `gst-tax-migration` from the template
- [x] Billing state (required), optional company + GSTIN (format + check character + same state) at checkout
- [x] GST worked out of the price per invoice (half-up to the paisa; parts always equal the price paid); CGST/SGST for
      Maharashtra, IGST elsewhere; USD buyers abroad: zero-rated export under LUT
- [x] Invoice SNS/YY-YY/000001 issued in the payment transaction (counter row per financial year, no gaps or reuse);
      credit note SNC/YY-YY/000001 on refund; issued documents can't be changed or deleted (database triggers)
- [x] USD purchases off until an LUT ARN is saved for the current financial year (checkout and course page)
- [x] Admin → Payments → Tax: GST details, LUT ARN per financial year, TDS section/rate/threshold
- [x] Invoice/credit-note PDF, email with the PDF, download in My Learning → Purchases, monthly GST CSV
- [x] Seller monthly invoices (upload, admin approval), PAN, TDS deduction on course payouts, statement, TDS CSV
- [x] Invoice PDF screenshot to the owner before the deploy arm
- [ ] Backfill of past paid orders: only if the owner asks (none issued automatically)
- [x] C4 release: code PR #187 (merge 28743fa3); migration arm #188 → run 38055649597 applied 0076
  (APPLY_VERIFIED, tables=8 columns=11 triggers=2), guard rearmed (2da76276); deploy arm #189 → run 38057426457
  (web :243, outbox :125, notification :124), guard rearmed (8bae7ec5); Remote Verify 38058306547, Google auth and
  logo checks green; signed-out live checks: home, /learn, course page 200; invoice, GST/TDS export and seller invoice
  routes 401; admin tax and earnings pages redirect to sign-in
- [ ] Owner: save the LUT ARN for 2026-27 (USD purchases stay off until then) and set the TDS rate/threshold
  (course payouts hold until then)

## Decisions made while building

- Expired access: the outline, progress, quiz results and certificate stay visible; lessons are locked and nothing
  new is recorded until the learner renews. Renewing early extends from the current end date.
- A refund ends access, renewals included. A refunded purchase keeps its promo-code use counted.
- "All my courses" codes cover a trainer's own courses. Organisation courses get per-course codes owned by the
  organisation.
- Trainer enrolment by email: a verified member email is enrolled at once (source `trainer`, `enrolled_by` set,
  in-app notification). Ended or revoked access is reopened as lifetime access. Limit: 30 an hour and 200 a day per
  person, counted from their own `learning.roster_enrolled` audit rows. Invitations stay open for 60 days and are
  claimed on My Learning and by the outbox worker every minute. The identity sign-up code is not changed.
- Reviews: approved by a moderator before they appear. Reported reviews go through the existing moderation queue.
  Approve and reject decisions are recorded in `audit_events`.
- Announcements: 3 per course per 24 hours. Recipients are active and completed learners, including those whose access
  has ended. The trainer is not sent their own announcement.
- Shipping: one code PR carries C0–C3 and C5–C8 together, because the work was merged on one branch; the migration
  and the deploy arm PRs are the other two. This keeps within 2–3 PRs and one deploy.

## Release

- [x] One guarded migration (0074–0075), one deploy, rearm, Remote Verify green
  - The round's code went live in the owner's jobs-feed deploy (#184, run 38036424831, `deploy-once 17580b6f`) at 08:15 UTC,
    70 minutes before the migration applied at 09:27 UTC. No separate round C deploy was needed. Task definitions:
    web :240 → :241, outbox worker :122 → :123, notification worker :121 → :122. Deploy guard rearmed to plan (2e739345).
  - Remote Verify 38037221357 green right after the deploy. The re-run after the migration (38042373553) failed on
    2 `database_query_failed` lines logged before the migration (its log window starts at the deployment, 08:06 UTC).
    The re-run at 10:57 still showed only those 2 lines after 539 more events (no new errors after the migration).
  - Round C deploy: arm PR #186 (owner merged and approved), run 38046770266 on 0514179b: web :241 → :242, outbox worker
    :123 → :124, notification worker :122 → :123. Remote Verify 38047592414 green; logo and Google sign-in checks green.
    Deploy guard rearmed to plan (ee40e6c2).
- [x] Live checks on seanshore.in (signed out: home, /learn, course page 200; /certificates/abc 404 with the not-verified page; signed-in checks are for the owner)
- [x] Report
