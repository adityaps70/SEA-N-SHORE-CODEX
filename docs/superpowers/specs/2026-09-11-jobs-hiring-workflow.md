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

## Non-goals for this slice

No ML/vector recommendation engine, messaging system, calendar interview scheduling, payment flow, ATS integration, or platform-admin verification console. Those can layer on later after the core Hiring workflow is proven.
