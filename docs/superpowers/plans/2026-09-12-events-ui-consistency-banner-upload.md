# Events UI Consistency and Banner Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Sea N Shore top-level product pages visually consistent with the Events premium navy-to-teal hero, standardize primary CTAs on the sea-green palette, soften Events form focus states, and add authenticated direct event-banner image uploads.

**Architecture:** Extract the Events gradient hero treatment into a shared presentation component and reuse it in Events, ProductSurface-driven pages, Jobs, and Network. For banners, keep the existing `events.banner_url` column but allow it to store either a legacy HTTP(S) URL or an owned S3 object key; validate owned keys server-side, create presigned PUT URLs for direct uploads, verify uploaded metadata before event persistence, and resolve stored keys to short-lived signed read URLs when reading events.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, Vitest + Testing Library, AWS S3 presigned URLs, Aurora/Postgres.

**Spec:** User-approved UI consistency scope from 2026-09-12 conversation.

## Global Constraints

- Work only on `feat/aws-native-phase-0-1`; never touch `main`, merge, or create a PR.
- Re-fetch the live branch head before every write and reconcile concurrent changes rather than overwriting them.
- Keep AWS deployment guards in `plan` except for one explicitly armed staging deployment after exact-head CI passes.
- Preserve existing Events behavior, authorization, registration logic, and database schema.
- Banner uploads accept JPEG, PNG, and WebP only, enforce a bounded file size, require authentication, and persist durable storage references rather than expiring signed URLs.
- Follow red-green-refactor: add a failing product contract before production changes.

---

### Task 1: Lock the requested UI and media behavior with RED tests

**Files:**
- Create: `src/features/events/events-ui-consistency-contract.test.ts`

**Interfaces:**
- Consumes existing Events/ProductSurface/Jobs/Network source files.
- Produces a contract that requires a shared premium hero, teal primary CTA usage, subtle single focus treatment, and direct banner upload plumbing.

- [ ] **Step 1: Write the failing contract**

Create source-level assertions requiring:
- `src/components/product/premium-page-hero.tsx` to exist and contain the Events gradient classes.
- Events, ProductSurface, Jobs, and Network to consume `PremiumPageHero`.
- Jobs primary search CTA to use the teal palette.
- Event form focus styling to avoid `focus:ring-2`/double-outline styling.
- Event form to expose a file input for banner upload rather than a visible URL-only field.
- Event media policy/actions to exist and use `createMediaUploadUrl`, `headMediaObject`, and `createMediaReadUrl`.

- [ ] **Step 2: Run exact-head CI and verify RED**

Expected: the focused contract fails because the shared hero and event banner upload path do not exist yet.

- [ ] **Step 3: Commit the RED test separately**

Commit message: `test: require consistent heroes and event banner upload`

---

### Task 2: Extract and adopt the premium page hero and sea-green primary CTA

**Files:**
- Create: `src/components/product/premium-page-hero.tsx`
- Modify: `src/components/product/product-surface.tsx`
- Modify: `src/app/(app)/events/page.tsx`
- Modify: `src/app/(app)/jobs/page.tsx`
- Modify: `src/app/(app)/network/page.tsx`

**Interfaces:**
- `PremiumPageHero({ eyebrow, title, description?, children?, className? })` renders the rounded navy-to-teal gradient shell used by Events.
- Existing ProductSurface, Events, Jobs, and Network page content remains intact inside the shared shell.

- [ ] **Step 1: Implement the shared hero component**

Use the canonical classes `rounded-[2rem] bg-gradient-to-br from-navy-950 via-navy-900 to-teal-800 ... text-white shadow-xl` with teal eyebrow text.

- [ ] **Step 2: Replace solid/white top banners with the shared hero**

ProductSurface adoption automatically updates Community, Learn, and My Activities. Network keeps its search experience but moves it into the premium hero. Jobs keeps its search form and trust signal while using the same gradient.

- [ ] **Step 3: Align primary actions**

Use teal/sea-green for the prominent hero/search/filter CTA while preserving neutral tabs, secondary controls, and destructive actions.

- [ ] **Step 4: Run focused and full tests**

Expected: hero/CTA contract assertions pass with no existing regressions.

---

### Task 3: Add secure direct event-banner upload and clean form focus styling

**Files:**
- Create: `src/features/events/event-banner-media.ts`
- Create: `src/features/events/components/upload-event-banner.ts`
- Modify: `src/features/events/calendar-actions.ts`
- Modify: `src/features/events/calendar-validation.ts`
- Modify: `src/features/events/calendar-types.ts`
- Modify: `src/features/events/calendar-repository.ts`
- Modify: `src/features/events/components/event-form.tsx`
- Test: `src/features/events/events-ui-consistency-contract.test.ts`

**Interfaces:**
- `prepareEventBannerUpload(input: { profileId: string; mimeType: string; size: number })` returns `{ storagePath, uploadUrl }`.
- `verifyEventBannerReference(profileId, reference)` checks ownership plus S3 metadata for storage-key references and accepts legacy HTTP(S) URLs.
- `resolveEventBannerReference(reference)` signs owned storage keys for display while passing legacy URLs through.
- `createEventBannerUploadAction({ mimeType, size })` authenticates the user and returns a presigned direct upload.
- `uploadEventBannerFile({ uploadUrl, file, onProgress })` performs the browser PUT with progress.

- [ ] **Step 1: Add event-specific media policy and S3 helpers**

Allow `image/jpeg`, `image/png`, `image/webp`; cap banners at 8 MiB; construct owned keys under `events/<profileId>/banners/<uuid>.<ext>`; verify MIME and length with `HeadObject`.

- [ ] **Step 2: Update event validation and persistence semantics**

Allow `bannerUrl` to contain either HTTP(S) or an owned event-banner storage key. Before create/update persistence, verify storage-key references for the authenticated host. Resolve storage keys to signed display URLs on event reads while retaining the raw storage path on `CalendarEvent.bannerStoragePath` for edit forms.

- [ ] **Step 3: Replace Banner URL control with direct upload UI**

Use a polished click/drop style file control, local preview, upload progress, replace/remove actions, and a hidden `bannerUrl` field containing the durable storage reference. Edit mode uses `bannerStoragePath` as the persisted value and `bannerUrl` only as the display preview.

- [ ] **Step 4: Fix focus treatment**

Replace the current dark border + `ring-2` combination with one subtle teal focus border/ring treatment so focused fields do not look double-bold.

- [ ] **Step 5: Run focused and full tests**

Expected: contract, event validation, repository, and component tests pass.

---

### Task 4: Exact-head verification and one guarded staging deployment

**Files:**
- Modify temporarily: `scripts/aws/staging-deploy-action.txt`

**Interfaces:**
- Existing AWS guarded staging workflow only; no manual deployment path.

- [ ] **Step 1: Verify all mutation guards are `plan` before deployment**

Check staging deploy, onboarding E2E, organization hiring E2E, create-job probe, edge recovery, events migration, and events E2E guards.

- [ ] **Step 2: Run exact-head Infrastructure CI and Remote Verify**

Expected: all jobs pass at the exact implementation head.

- [ ] **Step 3: Arm exactly one staging deployment**

Change only `scripts/aws/staging-deploy-action.txt` from `plan` to `deploy-once`, verify the deployment targets AWS account `310356785722`, and wait for ECS rollout plus exact image digest verification.

- [ ] **Step 4: Restore staging deployment guard to `plan`**

Commit the guard restore and verify the restore workflow skips deployment.

- [ ] **Step 5: Perform final exact-head verification**

Confirm final branch SHA, all guards `plan`, exact-head CI/Remote Verify green, and the staging site serves the updated UI.