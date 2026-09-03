# AWS-Native Phase 3 Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Sea N Shore Cognito email/password authentication and server-side session primitives in parallel with the existing Supabase runtime, without switching protected application pages away from Supabase until the Aurora repository/authorization layer is ready.

**Architecture:** Cognito becomes the new authentication provider, but Phase 3 is deliberately non-cutover. Server-side Cognito calls use the public Cognito User Pools JSON API through Node `fetch`, avoiding new npm dependencies while the existing npm/CI issue remains open. Cognito access/refresh tokens are stored only in HttpOnly cookies; server code validates an authenticated principal by calling Cognito `GetUser`, and the existing `identity_accounts` mapping remains the permanent bridge from Cognito `sub` to the existing Sea N Shore UUID. Main Home/Network/Profile data access remains Supabase-backed during this phase, so the existing Supabase session path stays intact as rollback until Phase 4 replaces Supabase data/RLS dependencies.

**Tech Stack:** Next.js 16.3.4, React 19.2.8, Node 22, Cognito User Pools, Aurora PostgreSQL, Terraform 1.10.5, Vitest 4.1.11, native `fetch`, Next.js HttpOnly cookies.

**Spec:** `docs/superpowers/specs/2026-09-03-aws-native-backend-migration-design.md`

## Global Constraints

- Preserve every existing Sea N Shore application UUID exactly.
- Cognito `sub` is an authentication-provider identifier only; it never replaces `profiles.id`.
- The seven existing Cognito users and seven `identity_accounts` rows are already provisioned and verified one-to-one.
- Existing users may complete Cognito `NEW_PASSWORD_REQUIRED`; do not migrate Supabase password hashes.
- Supabase remains live and available as rollback throughout this phase.
- Do not remove `@supabase/ssr`, `@supabase/supabase-js`, Supabase environment variables, Supabase proxy/session code, RLS, RPCs, or Supabase deployment configuration in Phase 3.
- Do not switch `requireUser()` or protected application layouts to Cognito in this phase; existing protected data queries still depend on Supabase RLS.
- Do not change `seaandshore.in` DNS.
- Do not enable Cognito Google federation until an approved HTTPS staging origin exists and CloudFront account verification is cleared.
- Passwords, Cognito challenge sessions, access tokens, refresh tokens, database credentials, and OAuth secrets must never be logged, committed, or pasted into chat.
- Browser cookies carrying Cognito credentials must be `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` whenever the site origin is HTTPS.
- No phase is complete solely because code compiles; unit tests and a real Cognito staging smoke test are required.

---

## File Structure Locked for This Plan

**Create**

- `src/lib/auth/cognito-api.ts` — minimal typed Cognito User Pools JSON API client using injected/native `fetch`.
- `src/lib/auth/cognito-api.test.ts` — API request/response/error mapping tests.
- `src/lib/auth/cognito-cookies.ts` — names/options/read/write/delete helpers for Cognito cookies.
- `src/lib/auth/cognito-cookies.test.ts` — cookie option and redaction-safe behavior tests.
- `src/lib/auth/cognito-session.ts` — server-side principal validation and refresh-token session helper.
- `src/lib/auth/cognito-session.test.ts` — session/principal tests with injected Cognito transport.
- `src/features/auth/cognito-actions.ts` — Cognito sign-in, new-password, sign-up confirmation, reset, and sign-out action primitives; not wired to the production auth pages yet.
- `src/features/auth/cognito-actions.test.ts` — action-level state transition tests.
- `scripts/aws/cognito-auth-smoke.sh` — operator smoke script that never prints passwords/tokens and verifies one real Cognito account.

**Modify**

- `src/lib/env.ts` — add a separate server-only Cognito environment schema/export while retaining all Supabase values.
- `.env.example` — document non-secret Cognito configuration and keep Supabase configuration.
- `infra/aws/app/main.tf` — add non-secret Cognito pool/client/region values to the Terraform-managed ECS task definition only; no auth-provider cutover flag.
- `docs/migration/aws-native-phase-0-1-runbook.md` — append the Phase 3 verification/rollback checkpoint.

**Do not modify in Phase 3**

- `src/features/auth/actions.ts`
- `src/features/auth/queries.ts`
- `src/lib/supabase/*`
- `src/proxy.ts`
- protected application layouts/pages

These stay on Supabase until Phase 4 can move authentication identity and database authorization together.

---

### Task 1: Cognito Server Environment Contract

**Files:**
- Modify: `src/lib/env.ts`
- Modify: `.env.example`
- Test: `src/lib/auth/cognito-api.test.ts` (environment-independent tests begin in Task 2)

**Interfaces:**
- Produces `cognitoEnvironment` with `AWS_COGNITO_REGION`, `AWS_COGNITO_USER_POOL_ID`, and `AWS_COGNITO_CLIENT_ID`.
- Existing `publicEnvironment` remains unchanged and continues requiring the Supabase values.

- [ ] **Step 1: Extend `src/lib/env.ts` without weakening existing Supabase validation**

Append a server-only schema after `publicEnvironment`:

```ts
const cognitoEnvironmentSchema = z.object({
  AWS_COGNITO_REGION: z.string().min(1),
  AWS_COGNITO_USER_POOL_ID: z.string().regex(/^[\w-]+_[0-9A-Za-z]+$/),
  AWS_COGNITO_CLIENT_ID: z.string().min(10),
})

export const cognitoEnvironment = cognitoEnvironmentSchema.parse({
  AWS_COGNITO_REGION: process.env.AWS_COGNITO_REGION,
  AWS_COGNITO_USER_POOL_ID: process.env.AWS_COGNITO_USER_POOL_ID,
  AWS_COGNITO_CLIENT_ID: process.env.AWS_COGNITO_CLIENT_ID,
})
```

Do not add `NEXT_PUBLIC_` prefixes: these values are server runtime configuration even though pool/client IDs are not secrets.

- [ ] **Step 2: Document the non-secret values in `.env.example`**

Add:

```dotenv
AWS_COGNITO_REGION=ap-south-1
AWS_COGNITO_USER_POOL_ID=ap-south-1_example
AWS_COGNITO_CLIENT_ID=exampleclientid
```

Keep the existing Supabase entries.

- [ ] **Step 3: Run typecheck after later Task 2 introduces the first importer**

Do not import `cognitoEnvironment` from existing production request paths yet; doing so would make local/test builds require the values before the Cognito module is exercised.

---

### Task 2: Typed Cognito JSON API Client

**Files:**
- Create: `src/lib/auth/cognito-api.test.ts`
- Create: `src/lib/auth/cognito-api.ts`

**Interfaces:**

```ts
export type CognitoAuthenticationResult = {
  accessToken: string
  idToken?: string
  refreshToken?: string
  expiresIn: number
}

export type CognitoSignInResult =
  | { kind: 'authenticated'; authentication: CognitoAuthenticationResult }
  | { kind: 'new-password-required'; session: string; username: string }

export type CognitoPrincipal = {
  sub: string
  email: string | null
  emailVerified: boolean
}

export function createCognitoApi(config, transport?): CognitoApi
```

`CognitoApi` provides `signIn`, `respondToNewPassword`, `refresh`, `getUser`, `signUp`, `confirmSignUp`, `forgotPassword`, `confirmForgotPassword`, and `globalSignOut`.

- [ ] **Step 1: Write failing API tests**

Cover these behaviors using an injected fake `fetch` transport so no live credentials are needed:

```ts
it('maps AuthenticationResult without exposing raw response shape')
it('maps NEW_PASSWORD_REQUIRED and preserves the opaque Cognito session')
it('maps GetUser attributes to sub/email/emailVerified')
it('throws CognitoApiError with only the AWS error code and safe message')
it('never includes password or token values in thrown errors')
```

The test transport must assert the request target header and body for each operation. It must never snapshot a real password/token.

- [ ] **Step 2: Run the test and verify RED**

```bash
npm test -- src/lib/auth/cognito-api.test.ts
```

Expected: FAIL because `./cognito-api` does not exist.

- [ ] **Step 3: Implement the minimal client with native `fetch`**

Use the regional endpoint:

```ts
const endpoint = `https://cognito-idp.${region}.amazonaws.com/`
```

POST JSON with:

```ts
headers: {
  'content-type': 'application/x-amz-json-1.1',
  'x-amz-target': `AWSCognitoIdentityProviderService.${operation}`,
}
```

Required operation mappings:

```text
InitiateAuth / USER_PASSWORD_AUTH -> signIn
RespondToAuthChallenge / NEW_PASSWORD_REQUIRED -> respondToNewPassword
InitiateAuth / REFRESH_TOKEN_AUTH -> refresh
GetUser -> getUser
SignUp -> signUp
ConfirmSignUp -> confirmSignUp
ForgotPassword -> forgotPassword
ConfirmForgotPassword -> confirmForgotPassword
GlobalSignOut -> globalSignOut
```

Error handling must parse only `__type`/`code` and a safe Cognito message. Never append request bodies, passwords, access tokens, refresh tokens, or challenge sessions to errors.

- [ ] **Step 4: Run tests and verify GREEN**

```bash
npm test -- src/lib/auth/cognito-api.test.ts
```

Expected: all Cognito API tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/cognito-api.ts src/lib/auth/cognito-api.test.ts src/lib/env.ts .env.example
git commit -m "feat: add Cognito server API client"
```

---

### Task 3: HttpOnly Cognito Cookie Primitives

**Files:**
- Create: `src/lib/auth/cognito-cookies.test.ts`
- Create: `src/lib/auth/cognito-cookies.ts`

**Interfaces:**

```ts
export const COGNITO_COOKIE_NAMES = {
  access: 'sns_cognito_access',
  refresh: 'sns_cognito_refresh',
  challenge: 'sns_cognito_challenge',
  challengeUser: 'sns_cognito_challenge_user',
} as const

export function cognitoCookieOptions(siteUrl: string): {
  httpOnly: true
  sameSite: 'lax'
  secure: boolean
  path: '/'
}
```

- [ ] **Step 1: Write failing cookie tests**

Test that:

```text
https site -> secure=true
http://localhost -> secure=false
all auth cookies -> HttpOnly, SameSite=Lax, Path=/
challenge cookies -> short lifetime (10 minutes maximum)
refresh cookie -> 30-day maximum age
cookie names contain no user identifiers
```

- [ ] **Step 2: Verify RED**

```bash
npm test -- src/lib/auth/cognito-cookies.test.ts
```

- [ ] **Step 3: Implement cookie helpers**

The helper may accept a Next.js cookie-store-like interface for testability. It must never expose tokens to client JavaScript and must provide one `clearCognitoCookies()` function that deletes access, refresh, challenge, and challenge-user cookies together.

- [ ] **Step 4: Verify GREEN**

```bash
npm test -- src/lib/auth/cognito-cookies.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/cognito-cookies.ts src/lib/auth/cognito-cookies.test.ts
git commit -m "feat: add Cognito secure cookie helpers"
```

---

### Task 4: Server-Side Cognito Session Verification

**Files:**
- Create: `src/lib/auth/cognito-session.test.ts`
- Create: `src/lib/auth/cognito-session.ts`

**Interfaces:**

```ts
export async function getVerifiedCognitoPrincipal(): Promise<CognitoPrincipal | null>
export async function requireVerifiedCognitoPrincipal(): Promise<CognitoPrincipal>
export async function refreshCognitoSession(): Promise<boolean>
```

- [ ] **Step 1: Write failing session tests**

Use injected cookie store and Cognito API boundaries. Cover:

```text
no access cookie -> null
valid access cookie + GetUser success -> CognitoPrincipal
invalid/expired access + valid refresh -> refresh returns true and rotates access cookie
invalid refresh -> clears all Cognito cookies and returns false
GetUser response missing sub -> reject as unauthenticated
```

- [ ] **Step 2: Verify RED**

```bash
npm test -- src/lib/auth/cognito-session.test.ts
```

- [ ] **Step 3: Implement minimal session behavior**

`getVerifiedCognitoPrincipal()` must call Cognito `GetUser` with the HttpOnly access token; do not trust decoded-but-unverified JWT claims. `refreshCognitoSession()` must use `REFRESH_TOKEN_AUTH`, set a new access token, retain the existing refresh token if Cognito does not return a replacement, and clear cookies on Cognito authorization failure.

Do not wire this into `src/proxy.ts` yet. The existing Supabase proxy remains the active application-session refresher until Phase 4.

- [ ] **Step 4: Verify GREEN**

```bash
npm test -- src/lib/auth/cognito-session.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/cognito-session.ts src/lib/auth/cognito-session.test.ts
git commit -m "feat: add Cognito server session verification"
```

---

### Task 5: Cognito Auth Action Primitives Without Production Wiring

**Files:**
- Create: `src/features/auth/cognito-actions.test.ts`
- Create: `src/features/auth/cognito-actions.ts`

**Interfaces:**

```ts
export type CognitoAuthActionState = {
  error?: string
  message?: string
  next?: 'new-password' | 'confirm-sign-up' | 'confirm-reset'
}

export async function cognitoSignIn(state, formData): Promise<CognitoAuthActionState>
export async function cognitoCompleteNewPassword(state, formData): Promise<CognitoAuthActionState>
export async function cognitoSignUp(state, formData): Promise<CognitoAuthActionState>
export async function cognitoConfirmSignUp(state, formData): Promise<CognitoAuthActionState>
export async function cognitoRequestPasswordReset(state, formData): Promise<CognitoAuthActionState>
export async function cognitoConfirmPasswordReset(state, formData): Promise<CognitoAuthActionState>
export async function cognitoSignOut(): Promise<void>
```

- [ ] **Step 1: Write failing action tests**

Cover:

```text
invalid sign-in schema -> generic validation error before Cognito call
NotAuthorizedException/UserNotFoundException -> same generic "Email or password is incorrect." copy
NEW_PASSWORD_REQUIRED -> challenge/session stored only in HttpOnly cookies and next=new-password
successful auth -> access/refresh cookies written
new-password completion -> challenge cookies cleared and auth cookies written
UsernameExistsException on sign-up -> non-enumerating "Check your email to continue." response
forgot-password request -> same generic success whether user exists or not
confirm-reset invalid code -> safe retry message
sign-out -> GlobalSignOut attempted, then cookies cleared even if remote sign-out fails
```

- [ ] **Step 2: Verify RED**

```bash
npm test -- src/features/auth/cognito-actions.test.ts
```

- [ ] **Step 3: Implement action primitives**

Reuse the existing Zod schemas where the field shape matches. For Cognito-specific confirmation-code forms, define local schemas with `z.string().trim().min(1)` and the same 12-character password rule already used by Sea N Shore.

Do not import these actions from the current `src/app/auth/*` pages yet. Main auth pages remain Supabase-backed until Phase 4.

- [ ] **Step 4: Verify GREEN and run all auth-unit tests**

```bash
npm test -- src/lib/auth/cognito-api.test.ts src/lib/auth/cognito-cookies.test.ts src/lib/auth/cognito-session.test.ts src/features/auth/cognito-actions.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/features/auth/cognito-actions.ts src/features/auth/cognito-actions.test.ts
git commit -m "feat: add Cognito auth action primitives"
```

---

### Task 6: ECS Non-Secret Cognito Runtime Configuration

**Files:**
- Modify: `infra/aws/app/main.tf`
- Modify: `docs/migration/aws-native-phase-0-1-runbook.md`

**Interfaces:**
- ECS receives pool/client/region identifiers from Terraform resource references.
- No database secret, Cognito token, OAuth secret, or password is added to plaintext task definition environment.

- [ ] **Step 1: Add Cognito values to the Terraform task definition environment**

Append to the existing container `environment` array:

```hcl
{ name = "AWS_COGNITO_REGION", value = var.aws_region },
{ name = "AWS_COGNITO_USER_POOL_ID", value = aws_cognito_user_pool.app.id },
{ name = "AWS_COGNITO_CLIENT_ID", value = aws_cognito_user_pool_client.web.id },
```

Do not add an `AUTH_PROVIDER=cognito` switch in this phase.

- [ ] **Step 2: Terraform verification**

```bash
cd infra/aws/app
terraform fmt
terraform validate
terraform plan -out=tfplan
terraform show -json tfplan > plan.json
node ../../../scripts/aws/check-terraform-plan.mjs plan.json
```

Expected: additive/in-place task-definition configuration plus the still-blocked CloudFront create; no delete/replace of VPC, ALB, ECS service, Aurora, Cognito pool, or user mappings.

Do not apply CloudFront while the AWS account-level CloudFront verification restriction remains.

- [ ] **Step 3: Append the rollback checkpoint to the runbook**

Record:

```text
Phase 3 does not change the active production/staging application auth pages or protected-page identity. Rollback is therefore to deploy the previous application image; Supabase Auth/data remains intact. Cognito users/mappings are preserved and must not be deleted during rollback.
```

- [ ] **Step 4: Commit**

```bash
git add infra/aws/app/main.tf docs/migration/aws-native-phase-0-1-runbook.md
git commit -m "chore: add Cognito runtime configuration"
```

---

### Task 7: Real Cognito Smoke Verification

**Files:**
- Create: `scripts/aws/cognito-auth-smoke.sh`

**Interfaces:**
- Operator supplies the test email/password only through `/dev/tty` prompts.
- Script prints statuses only, never credentials or returned tokens.

- [ ] **Step 1: Create a redaction-safe smoke script**

The script must:

1. Resolve the `sea-n-shore-staging-users` pool and `sea-n-shore-staging-web` client.
2. Prompt for an existing real Cognito user email and password through `/dev/tty`.
3. Run `USER_PASSWORD_AUTH`.
4. Accept either direct authentication or `NEW_PASSWORD_REQUIRED`; for the latter, prompt for the new password and complete the challenge.
5. Verify that an access token was returned without printing it.
6. Call `GetUser` with the access token and verify a `sub` exists without printing email/token values.
7. Query Aurora `identity_accounts` through the existing operator Data API path and require exactly one `provider='cognito'` row for that `sub`.
8. Unset all shell variables containing passwords/tokens before exit.
9. Print only `COGNITO AUTH SMOKE PASSED` on final success.

- [ ] **Step 2: Run against one real migrated account**

Expected final output:

```text
COGNITO AUTH SMOKE PASSED
identity mapping: 1
```

The already completed manual CLI flow may be recorded as evidence for this task once the repository script reproduces the same result.

- [ ] **Step 3: Commit**

```bash
git add scripts/aws/cognito-auth-smoke.sh
git commit -m "test: add Cognito auth smoke verification"
```

---

### Task 8: Phase 3 Verification Gate

- [ ] **Step 1: Run focused tests**

```bash
npm test -- src/lib/auth/cognito-api.test.ts src/lib/auth/cognito-cookies.test.ts src/lib/auth/cognito-session.test.ts src/features/auth/cognito-actions.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run repository quality gates**

```bash
npm run lint
npm run typecheck
npm test
```

If `npm install`/Docker CI still fails with the previously observed npm Arborist `edgesOut` error, stop and use the systematic-debugging skill; do not guess or alter dependency versions speculatively.

- [ ] **Step 3: Confirm active application remains Supabase-backed**

Verify these files are unchanged from the pre-Phase-3 baseline:

```text
src/features/auth/actions.ts
src/features/auth/queries.ts
src/lib/supabase/server.ts
src/lib/supabase/proxy.ts
src/proxy.ts
```

- [ ] **Step 4: Confirm AWS identity state**

Require:

```text
Cognito users = 7
identity_accounts(provider=cognito) = 7
unique profile_id = 7
unique provider_subject = 7
profile UUID digest = 844824116dc03e5512e8d4415a6737d9
```

One migrated real account may now be `CONFIRMED`; remaining not-yet-used migrated accounts may still be `FORCE_CHANGE_PASSWORD`.

- [ ] **Step 5: Stop before application cutover**

Do not switch the main auth pages, `requireUser()`, proxy, or protected application routes to Cognito until Phase 4 has replaced the affected Supabase data/RLS paths with Aurora repositories/services and the HTTPS staging origin is available.

---

## Google Federation Gate

Google federation remains part of the approved target architecture, but it is intentionally not enabled by this plan while CloudFront creation is blocked by the AWS account verification restriction. Once AWS clears CloudFront and an AWS-managed HTTPS staging hostname exists, create a small follow-up plan to:

- populate the existing Secrets Manager Google OAuth secret using an approved secret channel,
- enable `aws_cognito_identity_provider.google`,
- add OAuth code flow/callback/logout URLs to the existing Cognito client,
- test Cognito-hosted Google login on HTTPS,
- keep `seaandshore.in` untouched until final production cutover.

## Phase 3 Rollback

Phase 3 is parallel and reversible. If any Cognito application code fails verification, deploy the last known-good image and leave the existing Supabase-backed auth/data runtime unchanged. Do not delete Cognito users, `identity_accounts`, Aurora data, or Supabase data as a rollback action.
