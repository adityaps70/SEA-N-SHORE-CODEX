# Sea N Shore Organization Hiring Approval Design

Date: 2026-09-11
Branch: `feat/aws-native-phase-0-1`

## Goal

Make Hiring an organization-controlled capability without creating a second registration system. A user who selects **Organisation** during Sea N Shore onboarding should flow directly into organization setup and verification. Existing individual users can later create an organization, join an existing organization, or request recruiter access from `/hiring`.

Only users attached to an **approved organization** with an **approved hiring-capable membership** may create or manage jobs.

## Core Product Rule

Job posting authorization is server-enforced and requires all of the following:

1. authenticated Sea N Shore user;
2. organization exists in `public.companies`;
3. organization is approved by a Sea N Shore platform administrator (`companies.is_verified = true`);
4. user's `company_members` row has `approved_at is not null`;
5. membership role is `owner`, `administrator`, or `recruiter`.

A profile type or self-declared recruiter identity alone never grants job-posting permission.

## Registration and Hiring Relationship

Organization registration and Hiring are connected but remain separate concepts:

- **Organization** is the verified entity and membership boundary.
- **Hiring** is a workspace/capability unlocked by approved organization membership.

The existing onboarding already offers `Professional` and `Organisation`. When a user completes onboarding with `identityRoot = organisation`, the success redirect changes from `/home` to the organization setup flow. The user does not need to return to `/hiring` and click `Create Company Profile` again.

### Organisation signup flow

`Signup / Login -> Onboarding: Organisation -> Organization Setup -> Submit for Sea N Shore Review -> Pending -> Approved -> Hiring Dashboard -> Post Job`

Until approval, the user remains able to use the wider Sea N Shore product, but job posting stays locked.

## `/hiring` State Machine

`/hiring` becomes context-aware.

### 1. Approved hiring user

If the user has an approved owner/administrator/recruiter membership in an approved organization, show the existing Hiring Dashboard and `Post a job` action.

### 2. Pending organization application

Show:

- organization name;
- `Verification in progress` state;
- submitted date;
- current review status;
- edit/resubmit action when permitted;
- explanation that Hiring activates after approval.

### 3. Changes requested

Show administrator review notes and a clear `Update application` / `Resubmit` action.

### 4. Rejected or suspended

Show the decision state and administrator message. Posting remains locked. A rejected application can be resubmitted only through the explicit resubmission path; a suspended organization cannot self-reactivate.

### 5. No organization relationship

Replace the current dead-end `Hiring access` card with:

**Start Hiring on Sea N Shore**  
Post maritime vacancies, find matching seafarers and manage applicants.

- **Create Company Profile**
- **Join Existing Company**
- **Request Recruiter Access**

`Already approved? Your Hiring workspace will appear automatically.`

## Organization Application

### Organization setup fields

The first version collects the information needed to review a genuine maritime employer:

- organization name;
- organization type;
- website;
- official/company email;
- office location;
- description;
- fleet summary, where relevant;
- vessel types;
- applicant's relationship/role;
- optional registration/reference number;
- verification notes / supporting context.

Logo upload can reuse the project's existing media/storage patterns, but lack of a logo must not block submission.

### Persistence

Add a dedicated organization application table rather than trying to encode review workflow only in `companies.is_verified`.

`organization_applications` stores:

- application id;
- company id;
- submitted by user id;
- status: `pending`, `changes_requested`, `approved`, `rejected`, `suspended`;
- official email;
- registration/reference number;
- applicant role statement;
- supporting notes;
- submitted/updated timestamps;
- reviewed by administrator;
- reviewed timestamp;
- administrator review note.

`companies.is_verified` remains the compatibility/security flag used by Hiring. It becomes `true` only on approval and returns to `false` on suspension.

An owner membership is created in an unapproved state when the organization application is submitted. Approving the organization and its founding owner is one transaction.

## Join Existing Company / Recruiter Access

Use one membership-request model for both actions.

`company_access_requests` stores:

- request id;
- company id;
- user id;
- requested role (`member`, `recruiter`, or `administrator` where allowed);
- request type (`join_company` or `recruiter_access`);
- optional message;
- status: `pending`, `approved`, `rejected`, `cancelled`;
- requested / reviewed timestamps;
- reviewer id;
- reviewer note.

Rules:

- `Join Existing Company` defaults to `member`.
- `Request Recruiter Access` requests `recruiter` explicitly.
- duplicate pending requests for the same user/company/requested role are prevented.
- the target organization must already exist.
- recruiter access never self-approves.

### Hybrid approval model

- Sea N Shore platform administrators approve every new organization.
- Once an organization is approved, its approved `owner` or `administrator` may approve its own team/recruiter requests.
- Sea N Shore platform administrators can inspect and override all access requests.
- all approval/rejection/suspension actions write `audit_events`.

## Admin Center

Create a platform administrator area protected by `public.user_roles` with `role = 'administrator'`. No client-side flag or profile type may grant admin access.

### Routes

- `/admin` — dashboard
- `/admin/organizations` — organization review queue
- `/admin/organizations/[applicationId]` — full organization review
- `/admin/access-requests` — membership/recruiter request queue

The admin dashboard shows at minimum:

- Pending Organizations
- Changes Requested
- Approved Organizations
- Suspended Organizations
- Pending Access Requests

### Organization review screen

Show organization data, applicant identity, submitted details, current membership, and review history. Admin actions:

- **Approve**
- **Request Changes**
- **Reject**
- **Suspend** for an already-approved organization

Every decision requires/accepts a reviewer note as appropriate and is performed server-side in a transaction.

### How the admin receives applications

Submission itself is the notification mechanism for v1: every organization application and access request is persisted immediately into the admin queue. `/admin` shows live pending counters and `/admin/organizations` / `/admin/access-requests` show the actionable records ordered oldest-first for review. The global admin navigation should expose a visible pending badge when there is work to review.

This avoids relying on email delivery for a security-critical approval queue. Email/admin push can be added later without changing the approval model.

## Applicant Status Feedback

Applicants do not need to contact Sea N Shore to learn the result. The status is visible when they return to `/hiring` and on the organization setup page.

- `pending`: review in progress;
- `changes_requested`: show administrator note and resubmit action;
- `approved`: redirect/unlock Hiring Dashboard;
- `rejected`: show decision and note;
- `suspended`: show access suspended and keep posting disabled.

## Hiring Authorization Changes

The current Hiring repository already checks approved company memberships, but company verification is currently informational. All Hiring write/read authorization paths that manage employer data must also require `companies.is_verified = true`.

This applies to:

- Hiring dashboard;
- company vacancy list;
- create/edit job;
- applicant pipeline;
- candidate review;
- recruiter notes;
- application status changes.

The check must be done in SQL/server authorization, not only in page rendering.

## Organization-only Job Posting

The organization workflow becomes the only path to employer posting. Individual, seafarer, professional, mentor, trainer, or self-declared recruiter profiles do not gain direct posting rights.

A user may still be a professional profile and later join an approved company; their approved company membership is what grants Hiring access.

## Admin and Company Security

- platform admin checks use `user_roles`, never profile type;
- employer authorization is re-checked inside mutation transactions;
- applicants cannot approve their own organization or access request;
- organization owners/admins cannot approve requests for another company;
- approving an organization cannot silently grant recruiter access to unrelated users;
- suspension immediately disables Hiring writes because `companies.is_verified` becomes false;
- all decisions are auditable.

## Data Migration

Create a new additive migration after `0010_jobs_intelligence.sql` for:

- `organization_applications`;
- `company_access_requests`;
- indexes for admin pending queues and user/company lookup;
- any additive company fields needed for official email / reference metadata if they belong on the canonical company profile.

Use the same guarded AWS migration discipline already established for staging. Existing approved companies/memberships must remain valid; the migration must not revoke current data automatically.

## UX Entry Points

- Existing `Organisation` onboarding routes directly to organization setup after the personal/account activation step.
- `/hiring` shows the state-aware Start Hiring experience when the user lacks approved Hiring access.
- Approved owners/admins/recruiters go directly to the Hiring workspace.
- Admin users receive a clear Admin entry point when they have platform `administrator` role.

## Testing Strategy

Follow TDD and exact-head CI.

Tests cover:

1. organization signup redirects into organization setup;
2. organization application creates company + pending owner membership + application atomically;
3. non-admin cannot access admin routes/actions;
4. platform admin can approve/request changes/reject/suspend;
5. approval marks company verified and founding owner approved atomically;
6. suspension immediately blocks job posting;
7. individual profiles cannot post jobs without approved organization membership;
8. verified organization + approved recruiter can post jobs;
9. unverified organization cannot post even with an approved membership;
10. join/recruiter requests cannot self-approve;
11. company owner/admin can approve requests only for their own approved organization;
12. platform admin can override access requests;
13. `/hiring` renders correct states for no relationship, pending, changes requested, approved, rejected, and suspended;
14. audit events are written for review decisions.

## Deployment

Implementation stays only on `feat/aws-native-phase-0-1`. Do not touch `main`, merge, or create a PR.

After implementation:

1. exact-head CI must pass;
2. apply the additive migration using a guarded one-shot staging migration path;
3. restore migration guard to `plan`;
4. deploy one exact tested commit to AWS staging using the existing guarded deployment workflow;
5. restore staging deployment guard to `plan`;
6. run post-deploy health/runtime verification;
7. keep `scripts/aws/edge-recovery-action.txt` unchanged at `plan` unless an actual edge recovery is required.
