# AWS-Native Phase 4 Data and Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Sea N Shore's Supabase database/RLS/RPC application path with Cognito-backed server authorization and Aurora PostgreSQL repositories while preserving existing UUIDs and behavior.

**Architecture:** Browser requests remain routed to Next.js on ECS. Server-side Cognito session verification resolves the immutable Cognito `sub` through `identity_accounts` to the permanent Sea N Shore `profile_id`; all database reads/writes then go through explicit PostgreSQL repository/service boundaries. Supabase remains untouched as rollback/source-of-truth until final cutover; this phase does not delete Supabase or change production DNS.

**Tech Stack:** Next.js 16, Node 22, TypeScript 5, React 19, Amazon Cognito, Aurora PostgreSQL 16, `pg`, Terraform, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-09-03-aws-native-backend-migration-design.md`

## Global Constraints

- Preserve all existing Sea N Shore application UUIDs.
- Cognito `sub` is never used as an application primary key; resolve through `identity_accounts`.
- Browser code never receives database credentials and never connects to Aurora.
- Aurora remains private; only ECS may reach TCP 5432.
- Supabase remains live and unchanged as rollback until final cutover.
- Do not touch `seaandshore.in` DNS in this phase.
- Do not remove Supabase packages/environment variables yet; removal belongs to Phase 8.
- Keep current user-facing behavior and error copy unless a security requirement requires a safe generic error.
- Server services must enforce ownership, block, relationship, notification-recipient, and role rules formerly supplied by RLS/RPCs.
- Every production behavior change uses TDD: failing test first, then minimal implementation, then full regression verification.
- Never log passwords, Cognito tokens, DB credentials, OAuth secrets, or personal data unnecessarily.

---

### Task 1: Aurora Runtime Connection Contract

**Files:**
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `src/lib/env.ts`
- Create: `src/lib/db/config.test.ts`
- Create: `src/lib/db/config.ts`
- Create: `src/lib/db/client.test.ts`
- Create: `src/lib/db/client.ts`
- Modify: `infra/aws/app/main.tf`
- Modify: `docs/migration/aws-native-phase-0-1-runbook.md`

**Interfaces:**
- Produces `getDatabaseEnvironment(): { host: string; port: number; database: string; user: string; password: string; ssl: boolean }`.
- Produces `query<T>(text: string, values?: readonly unknown[]): Promise<T[]>` and `withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>`.
- ECS receives Aurora host/database/user/password only server-side; password is injected from the RDS-managed Secrets Manager secret.

- [ ] **Step 1: Write failing config tests**

Test lazy validation, numeric port parsing, required host/database/user/password, and production SSL default without importing environment at module evaluation time.

- [ ] **Step 2: Run config tests and verify RED**

Run: `./node_modules/.bin/vitest run src/lib/db/config.test.ts`
Expected: FAIL because `src/lib/db/config.ts` does not exist.

- [ ] **Step 3: Implement minimal DB config**

Add the Aurora environment contract to `src/lib/env.ts` or the focused DB config module. Keep validation lazy so test/build imports do not require live AWS values.

- [ ] **Step 4: Write failing DB-client tests**

Test parameter forwarding, one shared pool per process, transaction `BEGIN/COMMIT`, and `ROLLBACK` on callback failure using an injected pool factory.

- [ ] **Step 5: Run DB-client tests and verify RED**

Run: `./node_modules/.bin/vitest run src/lib/db/client.test.ts`
Expected: FAIL because the DB client is absent.

- [ ] **Step 6: Implement the minimal `pg` pool wrapper**

Use bounded pool sizing appropriate for Fargate/Aurora Serverless staging, parameterized queries only, and TLS configuration from the server environment. Do not expose a generic browser-accessible API route.

- [ ] **Step 7: Wire ECS runtime secret safely**

Add non-secret host/port/database environment values from Aurora resources. Inject the RDS-managed master secret fields through ECS `secrets`, and grant the ECS execution role only the required `secretsmanager:GetSecretValue`/KMS access for that secret. Preserve the existing Supabase runtime variables during parallel migration.

- [ ] **Step 8: Verify Task 1**

Run focused tests, `terraform fmt -check`, `terraform validate`, `npm run typecheck`, and `npm run lint`. Do not apply a Terraform plan that includes unrelated blocked CloudFront changes; if required, deploy a reviewed task-definition revision independently as done in Phase 3.

- [ ] **Step 9: Commit**

Commit only Task 1 files with a focused message such as `feat: add Aurora application database client`.

**Rollback:** No application code consumes the DB client yet. Revert the commit/task definition; current Supabase application path remains functional.

---

### Task 2: Cognito Subject to Permanent Profile Identity

**Files:**
- Create: `src/features/auth/identity-repository.test.ts`
- Create: `src/features/auth/identity-repository.ts`
- Create: `src/features/auth/aws-queries.test.ts`
- Create: `src/features/auth/aws-queries.ts`

**Interfaces:**
- Consumes `requireCognitoPrincipal()` from `src/lib/auth/cognito-session.ts` and `query()` from Task 1.
- Produces `resolveProfileIdForCognitoSub(sub: string): Promise<string | null>`.
- Produces `getAwsVerifiedUser(): Promise<{ id: string; cognitoSub: string; email: string | null } | null>` and `requireAwsUser()`.

- [ ] **Step 1:** Write RED repository tests for exactly-one mapping, zero mappings, and duplicate-mapping fail-closed behavior.
- [ ] **Step 2:** Implement parameterized `identity_accounts` lookup (`provider='cognito'`).
- [ ] **Step 3:** Write RED server-query tests for missing Cognito session, missing identity map, and successful permanent UUID resolution.
- [ ] **Step 4:** Implement `getAwsVerifiedUser`/`requireAwsUser` without changing current `auth/queries.ts` yet.
- [ ] **Step 5:** Run focused tests, typecheck and lint; commit.

**Rollback:** Parallel-only module. Current protected application remains on Supabase.

---

### Task 3: Profile Repository and Read Path

**Files:**
- Create: `src/features/profiles/repository.test.ts`
- Create: `src/features/profiles/repository.ts`
- Create: `src/features/profiles/aws-queries.test.ts`
- Create: `src/features/profiles/aws-queries.ts`
- Reuse: `src/features/profiles/mappers.ts`, `types.ts`

**Interfaces:**
- Repository methods cover own profile, profile by slug/id, public profiles by IDs, and network candidate profiles.
- Read services consume the permanent viewer profile UUID from Task 2.

- [ ] **Step 1:** Characterize current profile query outputs and block visibility behavior in tests.
- [ ] **Step 2:** Implement SQL joins to `profiles`, `maritime_profiles`, `profile_skills`, roles/company membership only where current views require them.
- [ ] **Step 3:** Enforce block visibility server-side: blocked pairs must not expose profiles through discovery/public-profile data paths according to current behavior.
- [ ] **Step 4:** Add AWS parallel query functions returning existing app types.
- [ ] **Step 5:** Run profile/network mapper tests, typecheck, lint; commit.

**Rollback:** AWS profile reads remain parallel and are not routed from pages yet.

---

### Task 4: Network Repository and RPC Replacement

**Files:**
- Create: `src/features/network/repository.test.ts`
- Create: `src/features/network/repository.ts`
- Create: `src/features/network/service.test.ts`
- Create: `src/features/network/service.ts`
- Modify later in task after tests: `src/features/network/queries.ts`, `src/features/network/actions.ts`

**Interfaces:**
- Replace Supabase RPC semantics for follow/unfollow, send/cancel/accept/decline/remove connection, block/unblock.
- Service owns authorization and transactions; repository owns SQL persistence only.

- [ ] **Step 1:** Translate the existing Supabase RPC/RLS invariants into explicit service tests: no self-interaction, no blocked-pair interaction, no duplicate request, accepted connection uniqueness, only requester can cancel, only recipient can accept/decline, either accepted member can remove, owner-only unblock.
- [ ] **Step 2:** Implement transaction-safe SQL using canonical `user_low_id/user_high_id` ordering and existing database constraints.
- [ ] **Step 3:** Implement notifications generated by follow/request/accept inside the same transaction where appropriate.
- [ ] **Step 4:** Replace `loadViewerGraph` Supabase reads with repository reads while preserving recommendation and relationship mapping logic.
- [ ] **Step 5:** Replace `supabase.rpc(...)` in network actions with service calls and preserve current safe UI error mapping.
- [ ] **Step 6:** Run all network/feed tests plus new negative authorization tests; commit.

**Rollback:** Revert network commit; Supabase source is still intact. Do not dual-write.

---

### Task 5: Notifications Repository and Authorization

**Files:**
- Create: `src/features/notifications/repository.test.ts`
- Create: `src/features/notifications/repository.ts`
- Modify: `src/features/notifications/queries.ts`
- Modify: `src/features/notifications/actions.ts`

**Interfaces:**
- Reads always filter by authenticated `recipient_id` server-side.
- Mark-read/mark-all-read actions must never mutate another user's notifications.

- [ ] **Step 1:** Write recipient-isolation RED tests.
- [ ] **Step 2:** Implement recent list/unread count and mark-read operations with parameterized SQL.
- [ ] **Step 3:** Preserve existing notification copy/destination mapping.
- [ ] **Step 4:** Run notification/network tests, typecheck, lint; commit.

**Rollback:** Revert task; no schema changes required.

---

### Task 6: Feed/Post Repository and Mutating Actions

**Files:**
- Create: `src/features/feed/repository.test.ts`
- Create: `src/features/feed/repository.ts`
- Create: `src/features/feed/service.test.ts`
- Create: `src/features/feed/service.ts`
- Modify: `src/features/feed/queries.ts`
- Modify: `src/features/feed/actions.ts`

**Interfaces:**
- Preserve current feed cursor semantics `(created_at DESC, id DESC)`, category filter, author hydration, polls, reaction/comment counts, viewer liked/saved/vote state.
- Ownership checks for edit/delete operations and viewer-scoped reaction/save/vote/comment writes.

- [ ] **Step 1:** Add RED tests for feed pagination/order and blocked-author exclusion.
- [ ] **Step 2:** Implement SQL feed/post hydration without Supabase nested-select syntax.
- [ ] **Step 3:** Add RED service authorization tests for create/react/comment/save/vote and ownership-sensitive actions currently implemented.
- [ ] **Step 4:** Implement transaction-safe mutations and idempotent toggles matching existing behavior.
- [ ] **Step 5:** Keep media URL generation behind an abstraction; until Phase 5 S3 cutover, do not create new Supabase storage dependencies. Existing empty post-media source state means media path handling must remain nullable.
- [ ] **Step 6:** Replace feed query/action Supabase calls; run feed/network tests, typecheck, lint; commit.

**Rollback:** Revert task; Supabase source remains untouched.

---

### Task 7: Onboarding/Profile Writes and Remaining Application Data Calls

**Files:**
- Modify: `src/features/auth/queries.ts`
- Modify: `src/features/profiles/actions.ts`
- Modify: `src/features/profiles/queries.ts`
- Add focused tests beside changed feature files.
- Audit remaining `createServerSupabaseClient`, `.from(` and `.rpc(` usages.

**Interfaces:**
- Protected server data operations use `requireAwsUser()` and Aurora only.
- Existing profile UUID and slug/onboarding invariants remain unchanged.

- [ ] **Step 1:** Characterize onboarding/profile mutation authorization in RED tests.
- [ ] **Step 2:** Implement Aurora writes with viewer ownership enforced server-side.
- [ ] **Step 3:** Switch protected auth query surface to Cognito/Aurora identity, only after Home/Profile/Network/Notifications have Aurora implementations.
- [ ] **Step 4:** Audit all server-side Supabase data/RPC calls and migrate any remaining implemented product flows.
- [ ] **Step 5:** Run full tests, typecheck, lint, build; commit.

**Rollback:** Roll back the application image/task definition to the pre-switch revision; Supabase remains preserved.

---

### Task 8: Protected Route Session Cutover

**Files:**
- Modify: `src/proxy.ts`
- Modify auth pages/actions only as required to route login/logout through Phase 3 Cognito primitives.
- Add proxy/session routing tests.

**Interfaces:**
- Protected routes use Cognito cookies/session verification.
- Public auth routes remain reachable without an authenticated session.

- [ ] **Step 1:** Write RED routing/session tests.
- [ ] **Step 2:** Replace Supabase session refresh dependency in protected routing with Cognito session behavior.
- [ ] **Step 3:** Wire existing Cognito auth actions into the current auth forms without redesigning UI.
- [ ] **Step 4:** Deploy to staging and verify login -> Home -> Profile -> Network -> Notifications with Aurora reads/writes.
- [ ] **Step 5:** Verify no protected user journey requires a Supabase auth session; commit.

**Rollback:** Redeploy previous ECS task definition/image; no source deletion or DNS change.

---

### Task 9: Phase 4 Verification Gate

**Files:**
- Create/update migration runbook verification section.
- Optional: create `scripts/aws/phase4-smoke.sh` if repeatable server/database checks benefit from automation.

- [ ] **Step 1:** Run `npm run lint`.
- [ ] **Step 2:** Run `npm run typecheck`.
- [ ] **Step 3:** Run `npm test` and require zero failures.
- [ ] **Step 4:** Run `npm run build` using the known-good npm/toolchain path; if npm 10 `edgesOut` recurs, debug/fix CI separately rather than bypassing verification.
- [ ] **Step 5:** Search application source for remaining server data dependencies: `createServerSupabaseClient`, `supabase.from`, `supabase.rpc`, `auth.uid`. Any remaining occurrence must be explicitly classified as rollback/migration tooling or a Phase 5/8 dependency.
- [ ] **Step 6:** Staging smoke with real Cognito user: sign in, Home feed read, profile read/update, follow/unfollow, connection lifecycle, notification read, post mutation supported by current UI. Confirm Aurora changes directly and confirm no corresponding Supabase write is required.
- [ ] **Step 7:** Run negative authorization tests for cross-user notification mutation, connection ownership, blocked interactions, and post/profile ownership.
- [ ] **Step 8:** Review CloudWatch application errors after smoke test; no repeating 5xx/auth/database errors.
- [ ] **Step 9:** Record the exact AWS application revision and retain the previous Supabase-backed revision for rollback.

**Phase 4 completion criterion:** The AWS staging application's protected data flows authenticate with Cognito, resolve the permanent profile UUID through `identity_accounts`, read/write Aurora through server-side repositories/services, and do not depend on Supabase DB/RLS/RPC/session behavior. Supabase remains preserved for final migration rollback and Phase 7 delta sync.
