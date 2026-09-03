# Sea N Shore AWS-Native Backend Migration Design

Date: 2026-09-03
Status: Approved design, pending implementation plan

## 1. Goal

Migrate Sea N Shore from the current split architecture (AWS-hosted Next.js + Supabase backend) to an AWS-native platform while preserving all existing application data and every existing Sea N Shore UUID.

Supabase must be fully removable at the end of the migration. The final platform uses AWS for application hosting, authentication, relational data, storage, email, secrets, observability, and edge protection. Google remains only as an external identity provider federated through Amazon Cognito.

## 2. Current State

The application is a Next.js 16 / Node 22 service deployed to ECS/Fargate behind an ALB in ap-south-1. GitHub Actions builds immutable images into ECR and deploys them to ECS using GitHub OIDC.

The application still depends on Supabase for:

- PostgreSQL application data
- Supabase Auth
- RLS and auth.uid()-based authorization
- RPC/database functions
- Storage APIs
- Supabase-specific generated database types and client/server adapters

Existing application data is relational. Current records include profiles/users, posts, follows, connections, notifications, reactions, polls, maritime profiles, roles, and other related records. Existing UUID relationships must not be regenerated.

## 3. Approved Target Architecture

### 3.1 Core services

- Next.js application: Amazon ECS on Fargate
- Container registry: Amazon ECR
- Authentication: Amazon Cognito User Pools
- Google login: Google federated into Cognito
- Relational database: Amazon Aurora PostgreSQL Serverless v2
- Object storage: Amazon S3
- Transactional email: Amazon SES
- Secrets: AWS Secrets Manager
- Logs/metrics: Amazon CloudWatch
- Edge/CDN: Amazon CloudFront
- Edge protection/rate limiting: AWS WAF
- Load balancing: Application Load Balancer
- Infrastructure as code: Terraform
- CI/CD: GitHub Actions using AWS OIDC

### 3.2 Request flow

Browser -> CloudFront/WAF -> ALB -> ECS/Next.js

Authenticated requests are verified against Cognito in the server-side application. The application resolves the Cognito subject to the permanent Sea N Shore profile UUID, performs authorization, then accesses Aurora PostgreSQL.

The browser never receives database credentials and never connects directly to Aurora.

## 4. Permanent Identity Model

The current Sea N Shore profile UUID remains the permanent application identity.

Cognito's immutable `sub` is an authentication-provider identifier only and must not replace existing profile IDs.

Introduce an identity mapping table with a shape equivalent to:

```text
identity_accounts
- id
- profile_id -> profiles.id
- provider
- provider_subject
- email
- created_at
- updated_at
```

For Cognito accounts:

```text
provider = cognito
provider_subject = Cognito sub
profile_id = existing Sea N Shore UUID
```

If Google is used, Google authenticates through Cognito. The application still resolves the resulting Cognito identity to the existing profile UUID.

All existing relational references remain unchanged, including post authors, follows, connections, notifications, reactions, roles, blocks, maritime profiles, and other profile-linked records.

## 5. Existing User Migration

All existing application profiles and UUIDs are preserved.

Existing Supabase password hashes are not migrated into Cognito.

The existing users will be provisioned in Cognito and mapped to their existing Sea N Shore UUIDs. They will complete a one-time new-password flow when AWS authentication becomes active.

Google login remains available through Cognito federation.

No seamless password migration Lambda is required because the approved approach is to reset/set a new password once rather than keep Supabase Auth in the login path.

## 6. Database Design

### 6.1 Database platform

Use Aurora PostgreSQL Serverless v2 as the permanent relational database.

Staging should be configured for the lowest safe idle footprint supported by the chosen Aurora PostgreSQL engine version. Production should use a non-zero minimum capacity initially to reduce user-facing cold-start risk, with autoscaling enabled for growth.

### 6.2 Schema preservation

Preserve application-facing table structures, UUID primary keys, foreign keys, uniqueness rules, check constraints, indexes, and transactional invariants where they remain valid outside Supabase.

Do not migrate Supabase platform internals as application tables, including:

- auth.*
- storage.*
- realtime.*
- supabase_migrations.*
- vault.*

### 6.3 profiles and auth.users dependency

The current `profiles.id -> auth.users.id` foreign key cannot remain because `auth.users` belongs to Supabase.

In Aurora:

- `profiles.id` remains the existing application UUID primary key.
- authentication linkage moves to `identity_accounts`.
- application tables continue to reference `profiles.id`.

## 7. Authorization Model

Supabase RLS is replaced with server-side authorization in the Next.js/ECS application.

Approved principles:

- Cognito authenticates the user.
- Server-side code resolves Cognito `sub` to the Sea N Shore profile UUID.
- All data access runs through server-side repositories/services.
- The server enforces ownership, membership, relationship, privacy, block, role, and visibility rules before database reads/writes.
- Aurora is not publicly reachable.
- Only approved application infrastructure can connect to the database.

Examples of rules that must be enforced server-side:

- whether a user may edit/delete a post
- whether a blocked profile or relationship is visible
- whether a connection request may be sent/accepted/declined/cancelled
- whether a notification belongs to the requesting user
- whether a company member may perform company actions
- whether role-restricted actions are allowed

Database constraints remain a second line of integrity protection, but user-level authorization lives in the service layer rather than browser-issued SQL or Supabase RLS.

## 8. Network and Secret Security

Aurora must run in private subnets and must not expose a public endpoint for application traffic.

Database security groups should allow PostgreSQL connectivity only from the application-side security boundary required by the final ECS network design.

Store sensitive values in AWS Secrets Manager, including:

- database credentials or database connection secret material
- Google OAuth client secret
- application signing/encryption secrets where needed
- SES-related secret material if applicable

Do not place long-lived AWS access keys in GitHub. Continue using GitHub OIDC for AWS deployment access.

Use TLS for application-to-AWS service connections wherever supported.

## 9. Storage Migration

Supabase Storage is replaced with Amazon S3.

Intended S3 use cases include:

- profile photos
- CVs/resumes
- post media
- company logos
- course assets
- event assets
- future user-generated documents/media

Uploads should use short-lived pre-signed URLs or equivalent server-authorized flows. Browser clients must not receive AWS credentials.

Private objects such as CVs remain private and require authorization before access. Public/media content may be distributed through CloudFront where appropriate.

Existing Supabase storage content must be inventoried and migrated before Supabase Storage is retired. If the source bucket is empty at migration time, the migration step still records that validation explicitly.

## 10. Email

Use Amazon SES for transactional platform email.

Cognito may use its supported email-delivery integration for authentication-related flows, while Sea N Shore application emails are sent through SES.

Planned categories include:

- account verification
- one-time password/new-password flows
- password reset
- security notifications
- platform transactional notifications
- future job/community/event notifications

Production email sending must not be cut over until SES identity/domain configuration and sending status are verified.

## 11. Staging and HTTPS

The migration remains staging-first.

Do not change `seaandshore.in` production DNS during the migration.

Before Cognito is treated as production-ready, AWS staging should use HTTPS through the approved AWS edge/load-balancer design. CloudFront/WAF should be introduced without requiring production-domain cutover.

Authentication callback/logout URLs must use the final staging HTTPS origin used for Cognito testing.

## 12. Data Migration Strategy

Supabase remains the source of truth until AWS passes validation.

### 12.1 Initial migration

1. Inventory the Supabase public application schema and required PostgreSQL functions/triggers.
2. Export the application schema/data needed by Sea N Shore.
3. Transform Supabase-specific auth/RLS assumptions.
4. Create the Aurora-compatible schema.
5. Import all application records while preserving UUIDs exactly.
6. Create identity mappings for migrated users.
7. Validate row counts, keys, constraints, and relationship integrity.

### 12.2 Validation

Validation must include more than total row counts.

At minimum verify:

- exact profile UUID set
- post IDs and post author relationships
- follows and directionality
- connections, requester, pair identity, and status
- notifications and recipients/actors
- reactions
- polls/options/votes
- maritime profiles
- roles
- blocks
- companies/company memberships if populated
- uniqueness constraints
- orphan detection
- foreign-key validity

Known current approximate application counts should be used as one sanity check, but the final migration must query live source counts immediately before migration rather than depend on historical numbers.

### 12.3 Final cutover

Use a controlled final cutover:

1. AWS staging is already operating against Aurora/Cognito.
2. Critical smoke tests pass.
3. Enter a brief application write freeze or equivalent controlled maintenance window on the Supabase-backed source.
4. Capture and apply the final data delta.
5. Re-run integrity and count validation.
6. Switch the AWS application to the final AWS-native configuration.
7. Verify authentication and critical workflows again.
8. Keep Supabase preserved as rollback/read-only source during the validation window.

No Supabase deletion occurs during the cutover itself.

## 13. Application Refactor Boundaries

Supabase-specific application dependencies must be removed in stages.

Replace:

- `@supabase/ssr`
- `@supabase/supabase-js`
- Supabase server/client/proxy adapters
- `supabase.auth.*`
- `supabase.from(...)`
- `supabase.rpc(...)`
- Supabase-generated database API assumptions
- browser-driven database access

with explicit application boundaries:

- `auth` module for Cognito/session handling
- `db` module for Aurora connections/transactions
- repository layer for SQL persistence
- service layer for authorization/business behavior
- storage module for S3
- email module for SES

Pages/components should depend on application services rather than cloud-vendor-specific database calls wherever practical.

## 14. Migration Phases

### Phase 0 - Inventory and safety baseline

- snapshot current schema/data metadata
- inventory Supabase calls, RPCs, RLS policies, triggers, functions, storage usage, and auth flows
- capture baseline smoke tests
- ensure rollback artifacts/state are available

### Phase 1 - AWS platform foundation

- add private database subnets/security groups
- create Aurora PostgreSQL Serverless v2
- configure Secrets Manager
- create Cognito user pool/app client/domain configuration
- configure Google federation
- create S3 buckets/policies
- prepare SES
- add CloudFront/WAF/HTTPS staging path

No application cutover yet.

### Phase 2 - Database compatibility and initial copy

- create Aurora-compatible schema
- remove `auth.users` dependency
- add `identity_accounts`
- migrate initial application data preserving UUIDs
- run data verification

### Phase 3 - AWS auth implementation

- implement Cognito sign-up/sign-in/sign-out/session handling
- implement Google login through Cognito
- implement password reset/new-password flows
- provision/map existing users
- keep Supabase Auth available only as rollback until AWS auth passes testing

### Phase 4 - Server-side data/authorization layer

- replace Supabase queries/RPCs with repositories/services
- encode current RLS/business rules server-side
- preserve behavior for onboarding, profiles, Home, My Network, notifications, and other existing flows

### Phase 5 - Storage and email cutover

- replace Supabase Storage with S3 flows
- migrate any stored objects
- replace transactional email flows with Cognito/SES as designed

### Phase 6 - Full AWS staging smoke test

Test at minimum:

- sign-up
- sign-in
- Google login
- sign-out
- session persistence
- one-time password/new-password flow for existing users
- password reset
- onboarding
- profile reads/updates
- Home feed
- posts/reactions/comments/polls as implemented
- My Network tabs
- follow/unfollow
- connect/request/cancel/accept/decline/remove
- notifications
- block/unblock
- jobs/community/learn/events pages and all implemented data-dependent actions
- uploads/downloads
- desktop/mobile navigation
- authorization-negative tests
- CloudWatch error review

### Phase 7 - Final data sync and cutover

- brief write freeze
- final delta migration
- validation
- switch to AWS-native backend
- observe closely

### Phase 8 - Supabase removal

Only after the validation window:

- remove Supabase environment variables
- remove Supabase packages/dev tooling
- remove Supabase client/server/proxy code
- remove Supabase deployment assumptions from CI/CD
- archive migration records/backups
- decommission Supabase after explicit approval

## 15. Rollback Strategy

Until the final validation window is complete, Supabase remains intact.

Rollback before final cutover is straightforward: keep AWS staging isolated and continue using the existing source system.

If a problem appears immediately after cutover:

- stop or disable AWS writes if required to avoid divergence
- restore the previously verified application/backend routing
- use the preserved Supabase source/backup according to the cutover runbook
- reconcile any writes that occurred after the final sync before retrying

The implementation plan must define the exact rollback procedure for each phase before that phase is executed.

## 16. Testing Strategy

Every phase requires automated and manual verification before proceeding.

Required test layers:

- unit tests for authorization/business logic
- integration tests against PostgreSQL/Aurora-compatible database behavior
- auth tests for Cognito/session flows
- migration verification scripts
- data-integrity checks
- end-to-end smoke tests for critical user journeys
- negative authorization tests
- deployment health checks
- CloudWatch log review

No phase is considered complete solely because Terraform/app deployment succeeded.

## 17. Observability

Use CloudWatch for:

- ECS application logs
- authentication/application error logging
- ALB metrics
- ECS service/task health
- Aurora metrics
- migration-job logs
- alarms for repeated 5xx, unhealthy tasks, database saturation, and other critical conditions

Sensitive personal data, passwords, tokens, database credentials, and OAuth secrets must not be logged.

## 18. Explicit Non-Goals

This migration does not include:

- redesigning Sea N Shore product UI/UX
- replacing Google as an external identity provider
- changing existing application UUIDs
- migrating historical Supabase internal auth/session tables into Aurora as application tables
- directly exposing Aurora to browsers
- touching production `seaandshore.in` DNS before a separately approved production cutover
- deleting Supabase before AWS validation is complete

## 19. Success Criteria

The migration is successful when:

1. All current Sea N Shore application data exists in Aurora with the same application UUIDs and validated relationships.
2. Cognito supports email/password and Google sign-in without Supabase.
3. Existing users are mapped to their current Sea N Shore profile UUID and can complete the agreed new-password flow.
4. All implemented application workflows use AWS-native backend services.
5. Aurora is private and access-controlled.
6. User authorization no longer depends on Supabase RLS/auth.uid().
7. User media/document flows use S3 instead of Supabase Storage.
8. Transactional email uses Cognito/SES as designed.
9. AWS staging passes the critical smoke suite with no repeating runtime exceptions.
10. Supabase configuration and packages can be removed without breaking the application.
11. Supabase is decommissioned only after explicit approval following the validation window.

## 20. Implementation Planning Requirement

This is a multi-phase architectural migration. Implementation must be broken into reviewable, reversible phases with explicit verification and rollback checkpoints.

The first implementation plan should start with Phase 0 and Phase 1 only: inventory/safety baseline plus AWS platform foundation. It must not mutate or delete existing Supabase application data.
