# Sea N Shore Jobs Hiring Workflow Design

## Goal

Extend Jobs Intelligence with a secure, premium company Hiring workspace without disturbing the already-green candidate Jobs experience or social feed.

## Security boundary

Hiring access is granted only by an approved `public.company_members` row whose role is `owner`, `administrator`, or `recruiter`. Profile type is never an authorization source. Every read and mutation remains company-scoped on the server, and mutations re-check authorization inside the transaction.

## Recruiter experience

The Hiring workspace uses these routes:

- `/hiring` — company selector/overview and funnel metrics.
- `/hiring/jobs` — company vacancies with state, applicant count and quick actions.
- `/hiring/jobs/new` — structured maritime vacancy composer.
- `/hiring/jobs/[jobId]/edit` — edit an authorized company vacancy.
- `/hiring/jobs/[jobId]/applicants` — applicant pipeline with match scores and status filters.
- `/hiring/applicants/[applicationId]` — candidate review, maritime match explanation, status progression and private recruiter notes.
- `/hiring/company` — company trust/profile summary and verification state.

## Vacancy model

Keep the additive `public.jobs` model from migration `0010_jobs_intelligence.sql`. Structured fields remain the source for discovery and matching: domain, department, rank, vessel types, experience, joining window, salary, sailing regions, urgent flag, Easy Apply, certificates and visas. `requirements` remains for backward-compatible narrative requirements.

Job creation and editing derive company name and company id from the authorized membership. Client input cannot override employer identity.

## Applicant pipeline

Recruiters can view only applications to jobs owned by their authorized company. Each applicant row includes candidate identity, maritime rank, sailing experience, vessel background, availability, current application status and a deterministic `scoreJobMatch` result. The pipeline supports the existing status vocabulary: `applied`, `under_review`, `shortlisted`, `interview`, `selected`, `rejected`, `withdrawn`.

Status mutations update the current application state and append an immutable `job_application_events` row in the same transaction. Private notes are stored in `job_recruiter_notes` and are never included in candidate-facing application queries.

## Candidate review

The review page combines the applicant professional profile, the full vacancy, deterministic match result, immutable status history and company-private recruiter notes. It highlights matched rank/vessel/experience/certificates/visas and missing requirements so recruiters can understand why a candidate ranks strongly or weakly.

## UI direction

Use the existing Sea N Shore app shell and premium Jobs visual language: navy/off-white surfaces, restrained teal accents, rounded cards, high information density without clutter, mobile-first responsive layouts, clear trust indicators and no LinkedIn-blue imitation.

## Round G: match v2, Jobs for you, job alerts and suggested candidates (13 October 2026)

> Added by algorithms round G (G3). Behind `ranking_settings.jobs` and `ranking_settings.job_alerts`. Off restores the
> round-12 behaviour within 30 s, with no deploy.

- **Match v2** (`src/features/ranking/job-scorer.ts`, weights in `job-weights.ts`):
  - Only the criteria a job specifies count, and the score is scaled for how specific the job is.
  - Matches show as Strong, Good or Partial, with no percentage.
  - A rank more than one step away or in another department, a missing or expired required COC, or a missing
    required visa makes the job "Not eligible: needs X". Such jobs are listed below every eligible job, never hidden.
- **Apply gate**: the employer's minimum-match gate keeps the round-12 score, which the server enforces. A job that
  gate refuses shows as "Not eligible: below this job's minimum match". Alerts and the digest leave it out.
- **Jobs for you**:
  - A SQL prefilter scores up to 300 open jobs, ranked by match × freshness, 20 per page.
  - Applied jobs move to an "Applied" section.
  - "Not interested" (with Undo) hides a job for 180 days.
- **Applicant pipeline**: applicants sort by Best match (the default; eligible first) or Newest, with reason chips.
- **Suggested candidates**: lists only members who turned on "Let recruiters find me as open to work". They are scored
  without their visas, and no contact details are shown.
- **Job alerts**:
  - Daily or weekly (Monday) emails from 02:00 UTC, with at most 10 new eligible matches; no email when nothing is new.
  - Each job is sent once per alert, and an in-app `job_alert_match` notification is added.
  - Sent through the existing email client with suppression, a "Job alerts" topic and one-click unsubscribe.

See `docs/superpowers/plans/2026-10-13-algorithms-round-g.md` (Release 2, PR 3).

## Non-goals for this slice

No ML/vector recommendation engine, messaging system, calendar interview scheduling, payment flow, ATS integration, or platform-admin verification console. Those can layer on later after the core Hiring workflow is proven.
