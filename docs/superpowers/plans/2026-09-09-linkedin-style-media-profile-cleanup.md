# LinkedIn-style Media and Profile Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve complete image aspect ratios, add secure direct photo/video uploads with inline video playback, simplify My Profile, and remove the requested Maritime Network copy.

**Architecture:** Keep the existing private S3 + signed-read model, but replace server-buffered post-media upload with authenticated presigned PUT plus S3 HEAD verification before Aurora finalization. Generate the future post UUID server-side when issuing the upload target so every object key is scoped to the authenticated profile and exact future post. Isolate variable-aspect-ratio rendering in a `PostMedia` component, make one additive MIME-constraint migration, and simplify only the own-profile composition while preserving existing professional editors and public-profile behavior.

**Tech Stack:** Next.js 16.3.4, React 19.2.8, TypeScript 5, Zod 4, Vitest 4, Testing Library, AWS SDK v3 S3, Aurora PostgreSQL, Terraform 1.10.5, GitHub Actions, AWS SSM/RDS Data API/ECS.

**Spec:** `docs/superpowers/specs/2026-09-09-linkedin-style-media-profile-cleanup-design.md`

## Global constraints

- Work only on `feat/aws-native-phase-0-1`; do not touch `main`, merge, or create a PR.
- Post media remains one object per post.
- Supported MIME types are exactly `image/jpeg`, `image/png`, `image/webp`, `video/mp4`, `video/webm`.
- Image limit remains 5 MiB; video limit is 200 MB.
- Do not increase the current Next.js Server Action body limit. Large file bytes must go browser-to-S3.
- Keep the media bucket private and preserve signed read URLs.
- Do not add MediaConvert, HLS/DASH, autoplay-with-sound, carousels, thumbnails, video editing, or unrelated profile fields.
- Public profile semantics remain unchanged; simplify the signed-in member's own `/profile` composition only.
- Use TDD for each behavior change: add a focused failing test, confirm RED, then implement the smallest production change that makes it green.
- During normal development keep `scripts/aws/staging-deploy-action.txt`, `scripts/aws/edge-recovery-action.txt`, the existing jobs migration action, and the new media migration action at `plan`.
- Apply the new DB migration only after exact-head CI is green, once, then immediately return its action to `plan`.
- Deploy staging only after exact-head CI is green, once, then immediately return the deploy action to `plan`.

---

## Task 1: Define and test the shared post-media policy

**Files:**
- Create: `src/features/feed/media-policy.ts`
- Create: `src/features/feed/media-policy.test.ts`

**Interfaces:**

```ts
export const POST_IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const POST_VIDEO_MAX_BYTES = 200 * 1024 * 1024

export const POST_MEDIA_MIME_EXTENSION = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
} as const

export type PostMediaMime = keyof typeof POST_MEDIA_MIME_EXTENSION

export type PostMediaMetadataValidation =
  | { ok: true; mimeType: PostMediaMime; extension: string }
  | { ok: false; error: string }

export function validatePostMediaMetadata(input: {
  mimeType: string
  size: number
}): PostMediaMetadataValidation

export function isVideoPostMediaMime(value: string): value is 'video/mp4' | 'video/webm'

export function buildPostMediaStoragePath(input: {
  profileId: string
  postId: string
  mimeType: PostMediaMime
  objectId?: string
}): string

export function isOwnedPostMediaStoragePath(input: {
  profileId: string
  postId: string
  storagePath: string
  mimeType: PostMediaMime
}): boolean
```

- [ ] **Step 1: Write failing media-policy tests**

Cover all boundaries before writing production code:

```ts
expect(validatePostMediaMetadata({ mimeType: 'image/jpeg', size: 5 * 1024 * 1024 }).ok).toBe(true)
expect(validatePostMediaMetadata({ mimeType: 'image/jpeg', size: 5 * 1024 * 1024 + 1 })).toEqual({
  ok: false,
  error: 'Images must be 5 MiB or smaller.',
})
expect(validatePostMediaMetadata({ mimeType: 'video/mp4', size: 200 * 1024 * 1024 }).ok).toBe(true)
expect(validatePostMediaMetadata({ mimeType: 'video/mp4', size: 200 * 1024 * 1024 + 1 })).toEqual({
  ok: false,
  error: 'Videos must be 200 MB or smaller.',
})
expect(validatePostMediaMetadata({ mimeType: 'video/quicktime', size: 1024 }).ok).toBe(false)
expect(validatePostMediaMetadata({ mimeType: 'image/gif', size: 1024 }).ok).toBe(false)
```

Also reject zero, negative, non-finite, and non-integer sizes. Test that a path created for one profile/post cannot validate for another profile/post or a mismatched extension.

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
npm test -- src/features/feed/media-policy.test.ts
```

Expected: FAIL because `media-policy.ts` does not exist.

- [ ] **Step 3: Implement the shared policy**

Use exact MIME matching. Generate keys in the existing shape:

```text
<profileId>/<postId>/<objectUuid>.<extension>
```

`isOwnedPostMediaStoragePath` must validate the complete prefix and expected extension, not merely use `includes`.

- [ ] **Step 4: Re-run the focused test**

```bash
npm test -- src/features/feed/media-policy.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```text
feat: add post media policy
```

---

## Task 2: Add presigned PUT and HEAD primitives at the AWS storage boundary

**Files:**
- Modify: `src/lib/aws/storage.ts`
- Modify: `src/lib/aws/storage.test.ts`

**Interfaces:**

```ts
export async function createMediaUploadUrl(
  input: { key: string; contentType: string },
  expiresInSeconds?: number,
): Promise<string>

export async function headMediaObject(key: string): Promise<{
  contentType: string | null
  contentLength: number | null
}>
```

- [ ] **Step 1: Extend the storage tests first**

Mock `HeadObjectCommand` alongside the existing S3 commands. Add tests that prove:

- presigned PUT uses the configured private media bucket;
- key and `ContentType` are included in the signed command;
- upload URL expires in 300 seconds by default;
- HEAD returns `ContentType` and `ContentLength` without downloading object bytes.

- [ ] **Step 2: Run and confirm RED**

```bash
npm test -- src/lib/aws/storage.test.ts
```

Expected: FAIL because the new functions/command do not exist.

- [ ] **Step 3: Implement storage primitives**

Add `HeadObjectCommand` and reuse the existing S3 client. Do not change `putMediaObject`, `createMediaReadUrl`, or bucket privacy behavior.

- [ ] **Step 4: Re-run tests**

```bash
npm test -- src/lib/aws/storage.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```text
feat: add direct media upload storage primitives
```

---

## Task 3: Secure the server-side presign and finalization flow

**Files:**
- Modify: `src/features/feed/media.ts`
- Create or modify: `src/features/feed/media.test.ts`
- Modify: `src/features/feed/repository.ts`
- Modify: `src/features/feed/repository.test.ts`
- Modify: `src/features/feed/actions.ts`
- Modify: `src/features/feed/actions.test.ts`
- Modify: `src/features/feed/schemas.ts`
- Create or modify: `src/features/feed/schemas.test.ts`

**Interfaces:**

```ts
export type PendingPostMedia = {
  postId: string
  storagePath: string
  mimeType: PostMediaMime
  size: number
}

export async function createPendingPostMediaUpload(input: {
  profileId: string
  mimeType: PostMediaMime
  size: number
}): Promise<PendingPostMedia & { uploadUrl: string }>

export async function verifyPendingPostMedia(input: {
  profileId: string
  postId: string
  storagePath: string
  mimeType: PostMediaMime
  size: number
}): Promise<void>

export type PostMediaUploadRequestResult =
  | { ok: true; upload: PendingPostMedia & { uploadUrl: string } }
  | { ok: false; error: string }

export async function requestPostMediaUpload(input: {
  mimeType: string
  size: number
}): Promise<PostMediaUploadRequestResult>

export async function discardPendingPostMedia(input: {
  postId: string
  storagePath: string
  mimeType: string
}): Promise<FeedActionResult>
```

Repository addition:

```ts
isPostMediaAttached(storagePath: string): Promise<boolean>
```

- [ ] **Step 1: Add failing repository test**

Assert `isPostMediaAttached` runs a single `select exists (...) from public.post_media where storage_path = $1` query and returns the boolean.

- [ ] **Step 2: Add failing media/server tests**

Test that `createPendingPostMediaUpload`:

- uses a server-generated UUID post ID;
- generates an owned path tied to that exact profile/post;
- signs PUT for the exact MIME;
- never receives a client-provided storage path.

Test that `verifyPendingPostMedia` rejects:

- another profile's path;
- another post's path;
- MIME/extension mismatch;
- missing object;
- object `ContentType` mismatch;
- object length mismatch;
- an object that exceeds the policy even if client metadata was tampered with.

- [ ] **Step 3: Add the media-reference Zod schema first**

The post form no longer receives `File`. It receives only metadata from a completed direct upload:

```ts
export const postMediaReferenceSchema = z.object({
  postId: z.string().uuid(),
  storagePath: z.string().min(1).max(500),
  mimeType: z.enum([
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/webm',
  ]),
  size: z.coerce.number().int().positive(),
  altText: z.string().trim().max(300).optional().default(''),
})
```

A partial media reference must be invalid. A poll plus media reference must be rejected as `Technical polls cannot include media.`

- [ ] **Step 4: Rewrite action tests for metadata finalization**

Remove the old expectation that `createPost` receives/uploads a `File` through the server action. Add tests for:

- `requestPostMediaUpload` authenticates and returns only a server-scoped upload target;
- invalid type/size returns a safe error before signing;
- `createPost` with a completed media reference calls verification before Aurora;
- caller-provided post ID from the presign phase is passed to `createStandardPostWithAurora`;
- video MIME metadata persists just like image metadata;
- Aurora failure triggers best-effort deletion of the verified pending object;
- cleanup failure does not replace the original publish error;
- `discardPendingPostMedia` refuses to delete a path already attached in `public.post_media`;
- `discardPendingPostMedia` only deletes an authenticated user's correctly scoped pending path.

- [ ] **Step 5: Run focused tests and record RED**

```bash
npm test -- src/features/feed/media.test.ts src/features/feed/repository.test.ts src/features/feed/actions.test.ts src/features/feed/schemas.test.ts
```

Expected: FAIL on the new direct-upload/finalization contracts.

- [ ] **Step 6: Implement the production flow**

Important rules:

1. `requestPostMediaUpload` validates metadata and then uses `requireAwsUser()`.
2. The server generates `postId` and object path; the client cannot select either.
3. `createPost` receives no media `File` and never calls `arrayBuffer()`.
4. Before Aurora insertion, `verifyPendingPostMedia` HEAD-checks both `ContentType` and exact `ContentLength`.
5. The authenticated profile ID + presigned post ID + storage path + MIME extension must all agree.
6. `createStandardPostWithAurora` receives the exact presigned post ID.
7. If Aurora create fails after successful verification, delete the orphan object best-effort.
8. Revalidate `/home`, `/activities`, `/posts/[id]`, and other already-relevant feed paths without adding unrelated invalidations.

- [ ] **Step 7: Re-run focused tests**

```bash
npm test -- src/features/feed/media.test.ts src/features/feed/repository.test.ts src/features/feed/actions.test.ts src/features/feed/schemas.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```text
feat: secure direct post media finalization
```

---

## Task 4: Add client-side direct upload with progress and preview

**Files:**
- Create: `src/features/feed/components/upload-post-media.ts`
- Create: `src/features/feed/components/upload-post-media.test.ts`
- Modify: `src/features/feed/components/post-composer.tsx`
- Modify: `src/features/feed/components/post-composer.test.tsx`

**Interfaces:**

```ts
export function uploadPostMediaFile(input: {
  uploadUrl: string
  file: File
  onProgress: (percent: number) => void
}): Promise<void>
```

Composer pending-media state should represent:

```ts
type ComposerMedia = {
  file: File
  localUrl: string
  postId: string | null
  storagePath: string | null
  mimeType: PostMediaMime
  size: number
  progress: number
  status: 'requesting' | 'uploading' | 'ready' | 'error'
  error?: string
}
```

- [ ] **Step 1: Test the XHR uploader first**

Use a fake `XMLHttpRequest` and assert:

- request method is `PUT` to the presigned URL;
- `Content-Type` matches the file;
- progress callback receives computable upload percentage;
- only 2xx resolves;
- network/non-2xx rejects with a safe `media_upload_failed` error.

- [ ] **Step 2: Update composer tests before implementation**

Mock `requestPostMediaUpload`, `discardPendingPostMedia`, `createPost`, and `uploadPostMediaFile`.

Add tests for:

- visible control label is `Photo / Video`;
- file input accepts all five MIME types;
- selecting a portrait image requests a target, uploads directly, and renders an uncropped local preview;
- selecting MP4 renders a `<video controls>` preview;
- while the upload promise is unresolved, Post is disabled and progress state is visible;
- only a ready upload contributes hidden `mediaPostId`, `mediaStoragePath`, `mediaMimeType`, `mediaSize` inputs;
- remove clears the preview and best-effort discards a completed pending object;
- switching to Technical Poll clears/discards pending media;
- oversized image/video is rejected before requesting an upload target;
- successful post clears/revokes the local preview without deleting the now-attached object.

- [ ] **Step 3: Run and confirm RED**

```bash
npm test -- src/features/feed/components/upload-post-media.test.ts src/features/feed/components/post-composer.test.tsx
```

Expected: FAIL because direct client upload is not implemented.

- [ ] **Step 4: Implement the XHR uploader**

Use `XMLHttpRequest` specifically because upload progress is required. Do not send credentials or custom headers beyond the signed request's required `Content-Type`.

- [ ] **Step 5: Refactor the composer**

Key implementation rules:

- File input must not submit the binary file with the form; omit the old `name="media"` behavior.
- `accept` is exactly `image/jpeg,image/png,image/webp,video/mp4,video/webm`.
- Perform shared metadata validation before presign.
- Use `URL.createObjectURL(file)` for local preview and always revoke old URLs on replace/remove/success/unmount.
- Image preview uses natural ratio with `object-contain`, not a fixed aspect crop.
- Video preview uses native controls and `preload="metadata"`.
- Disable Post while requesting/uploading or while the Server Action itself is pending.
- Preserve the user's body/poll text when upload errors occur.

- [ ] **Step 6: Re-run focused tests**

```bash
npm test -- src/features/feed/components/upload-post-media.test.ts src/features/feed/components/post-composer.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```text
feat: add photo and video direct uploads
```

---

## Task 5: Render full images and inline videos in every PostCard

**Files:**
- Create: `src/features/feed/components/post-media.tsx`
- Create: `src/features/feed/components/post-media.test.tsx`
- Modify: `src/features/feed/components/post-card.tsx`
- Modify: `src/features/feed/components/post-card.test.tsx`

**Interface:**

```tsx
export function PostMedia({
  media,
  authorName,
}: {
  media: FeedMedia
  authorName: string
})
```

- [ ] **Step 1: Write failing rendering tests**

For an image, assert:

- a normal `<img>` is rendered from the signed URL;
- it has `h-auto`, responsive width, a reasonable viewport maximum, and `object-contain`;
- no wrapper/component contains `aspect-[16/9]` or destructive `object-cover` for post media.

For a video, assert:

- `<video>` is rendered;
- `controls` is enabled;
- `preload="metadata"` is present;
- it uses the signed URL;
- fallback text is present;
- it does not autoplay with sound.

- [ ] **Step 2: Run and confirm RED**

```bash
npm test -- src/features/feed/components/post-media.test.tsx src/features/feed/components/post-card.test.tsx
```

Expected: FAIL because PostCard still forces 16:9 + `object-cover` and has no video rendering.

- [ ] **Step 3: Implement `PostMedia`**

Recommended image treatment:

```tsx
<div className="mt-4 flex justify-center overflow-hidden rounded-2xl border border-mist-100 bg-mist-50">
  <img
    src={media.signedUrl}
    alt={media.altText ?? `Image attached to ${authorName}'s post`}
    className="block h-auto max-h-[80vh] max-w-full object-contain"
  />
</div>
```

Recommended video treatment:

```tsx
<div className="mt-4 overflow-hidden rounded-2xl border border-mist-100 bg-black">
  <video
    controls
    preload="metadata"
    src={media.signedUrl}
    className="block max-h-[80vh] w-full bg-black"
    aria-label={media.altText ?? `Video attached to ${authorName}'s post`}
  >
    Your browser does not support this video.
  </video>
</div>
```

The maximum height scales very tall media to fit the viewport; it must never crop the image.

- [ ] **Step 4: Replace PostCard's fixed Next Image block with `PostMedia`**

Do not alter likes, saves, comments, polls, deletion, share behavior, or author presentation.

- [ ] **Step 5: Re-run tests**

```bash
npm test -- src/features/feed/components/post-media.test.tsx src/features/feed/components/post-card.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```text
feat: render uncropped post media and video
```

---

## Task 6: Add the additive video MIME migration and its one-shot guard

**Files:**
- Create: `infra/aws/database/migrations/0008_post_media_video.sql`
- Create: `scripts/aws/post-media-video-schema.test.mjs`
- Create: `scripts/aws/post-media-video-migration.sh`
- Create: `scripts/aws/post-media-video-migration-action.txt`
- Create: `.github/workflows/aws-post-media-video-migration.yml`
- Modify: `.github/workflows/aws-infra-ci.yml`

- [ ] **Step 1: Write the schema/guard contract first**

The test must assert the migration changes only `post_media_mime_check` and contains exactly the approved five MIME values. It may allow the necessary `drop constraint post_media_mime_check`, but must reject table drops, truncation, row deletes, data updates, unrelated constraint drops, or unrelated tables.

Expected migration:

```sql
alter table public.post_media
  drop constraint post_media_mime_check;
-- statement-breakpoint
alter table public.post_media
  add constraint post_media_mime_check check (
    mime_type in (
      'image/jpeg',
      'image/png',
      'image/webp',
      'video/mp4',
      'video/webm'
    )
  );
```

- [ ] **Step 2: Confirm RED before adding migration/workflow**

```bash
node --test scripts/aws/post-media-video-schema.test.mjs
```

Expected: FAIL because the migration does not exist.

- [ ] **Step 3: Add the migration**

Do not rewrite existing rows and do not rename `post_media`.

- [ ] **Step 4: Add the guarded migration script**

Follow the proven jobs/profile migration security pattern:

- branch must be `feat/aws-native-phase-0-1`;
- exact expected SHA required;
- exact GitHub repository remote required;
- AWS account/region/staging Aurora checks;
- action accepts only `plan|apply-once`;
- verify exact branch remote head before applying;
- use RDS Data API transaction;
- verify resulting constraint contains all five values and no extra unsupported values;
- emit non-sensitive evidence only.

- [ ] **Step 5: Add workflow**

`.github/workflows/aws-post-media-video-migration.yml` must:

- trigger only from the feature branch on its own migration/guard files or manual dispatch;
- wait for exact-head `AWS Infrastructure CI` success;
- use staging OIDC;
- discover exactly one `sea-n-shore-bootstrap` instance;
- clone/check out the exact triggering SHA and execute the guarded script through SSM;
- surface SSM status/evidence.

- [ ] **Step 6: Add CI contract step**

In `.github/workflows/aws-infra-ci.yml` remote-execution-contract add:

```yaml
- name: Verify post media video schema contract
  run: node --test scripts/aws/post-media-video-schema.test.mjs
```

- [ ] **Step 7: Ensure new action file starts at `plan`**

`script/aws/post-media-video-migration-action.txt` is invalid; the exact required path is:

```text
scripts/aws/post-media-video-migration-action.txt
```

Its complete content must be:

```text
plan
```

- [ ] **Step 8: Run contract tests**

```bash
node --test scripts/aws/post-media-video-schema.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Commit**

```text
infra: allow video post media
```

---

## Task 7: Add restricted S3 CORS for browser-to-S3 PUT

**Files:**
- Modify: `infra/aws/app/storage.tf`
- Create: `scripts/aws/post-media-upload-cors.test.mjs`
- Modify: `.github/workflows/aws-infra-ci.yml`

- [ ] **Step 1: Add failing Terraform contract test**

Read `infra/aws/app/storage.tf` and assert:

- `aws_s3_bucket_cors_configuration` targets `aws_s3_bucket.app["media"].id`;
- allowed method is PUT;
- allowed origin resolves to the existing CloudFront application domain, not `*`;
- allowed header is limited to `Content-Type`/required signed-upload headers;
- no GET/DELETE browser CORS expansion is introduced;
- public access block remains intact.

- [ ] **Step 2: Run and confirm RED**

```bash
node --test scripts/aws/post-media-upload-cors.test.mjs
```

Expected: FAIL because media-bucket CORS does not exist.

- [ ] **Step 3: Add restricted CORS**

Use the existing CloudFront distribution domain already defined in the app Terraform rather than hard-coding a second public origin where possible:

```hcl
resource "aws_s3_bucket_cors_configuration" "media" {
  bucket = aws_s3_bucket.app["media"].id

  cors_rule {
    allowed_methods = ["PUT"]
    allowed_origins = ["https://${aws_cloudfront_distribution.app.domain_name}"]
    allowed_headers = ["Content-Type"]
    max_age_seconds = 300
  }
}
```

Do not add public ACL/policy changes. Existing ECS `s3:PutObject`, `s3:GetObject`, and `s3:DeleteObject` permissions remain narrowly scoped to the private media bucket; HEAD uses `s3:GetObject` authorization.

- [ ] **Step 4: Add CI contract step**

```yaml
- name: Verify direct media upload CORS contract
  run: node --test scripts/aws/post-media-upload-cors.test.mjs
```

- [ ] **Step 5: Run static and Terraform checks**

```bash
node --test scripts/aws/post-media-upload-cors.test.mjs
terraform fmt -check -recursive infra/aws
```

The exact GitHub CI will run `terraform init -backend=false` and `terraform validate` for the app module.

- [ ] **Step 6: Commit**

```text
infra: allow restricted direct media upload cors
```

---

## Task 8: Simplify the signed-in My Profile hierarchy

**Files:**
- Modify: `src/app/(app)/profile/page.tsx`
- Modify: `src/app/(app)/profile/page.test.tsx`
- Modify: `src/features/profiles/components/profile-about.tsx`
- Modify: `src/features/profiles/components/maritime-profile-card.tsx`
- Modify: `src/features/profiles/components/profile-career-timeline.tsx`
- Modify: `src/features/profiles/components/profile-career-timeline.test.tsx`
- Modify: `src/features/profiles/components/profile-credential-wallet.tsx`
- Modify: `src/features/profiles/components/profile-credential-wallet.test.tsx`
- Modify existing Maritime/About tests if present; otherwise create focused tests beside those components only where needed.

- [ ] **Step 1: Change own-profile page test first**

The page test must assert:

- profile header remains;
- existing View public profile action remains available through the toolbar/actions placement;
- About remains;
- Maritime Experience remains;
- Experience remains;
- Licences & Credentials remains;
- `Professional identity` is absent;
- `My Maritime Passport` is absent;
- `Sea N Shore professional identity` is absent;
- `Posts & activity` is absent;
- no `getPostsByAuthor` mock/query is needed.

- [ ] **Step 2: Change section-heading tests first**

Update expected top-level section headings to the approved hierarchy:

- `About`
- `Maritime Experience`
- `Experience`
- `Licences & Credentials`

Keep existing editor-behavior assertions intact.

- [ ] **Step 3: Run and confirm RED**

```bash
npm test -- 'src/app/(app)/profile/page.test.tsx' src/features/profiles/components/profile-career-timeline.test.tsx src/features/profiles/components/profile-credential-wallet.test.tsx
```

Expected: FAIL because the old Passport/posts layout and heading labels still render.

- [ ] **Step 4: Simplify `OwnProfilePage`**

Target composition:

```tsx
<section className="grid gap-4 py-2 sm:py-5">
  <ProfileHeader
    profile={profile}
    editHref="inline"
    contactVisibility={profile.contactVisibility}
    mediaControls={<ProfileMediaControls kind="cover" hasImage={Boolean(profile.coverPath)} />}
    avatarControls={<ProfileMediaControls kind="avatar" hasImage={Boolean(profile.avatarPath)} />}
    actions={<ProfilePassportToolbar slug={profile.slug} />}
  />
  <ProfileAbout profile={profile} editHref="inline" />
  <MaritimeProfileCard profile={profile} editHref="inline" />
  <ProfileCareerTimeline experiences={portfolio.experiences} editable />
  <ProfileCredentialWallet credentials={portfolio.credentials} editable />
</section>
```

Remove:

- `getPostsByAuthor` import/call;
- `ProfilePostsSection` import/render;
- `ProfilePassportOverview` import/render;
- the separate `Professional identity / My Maritime Passport` page introduction.

Do not delete `ProfilePassportOverview` globally because public profile behavior is out of scope.

- [ ] **Step 5: Standardize section headers**

Use the same card baseline and H2 class where practical:

```text
border border-mist-100 p-5 sm:p-7
text-xl font-semibold tracking-tight text-navy-950
```

Specific cleanup:

- `ProfileAbout`: keep `About`; change decorative uppercase `Expertise` to a normal body-level `Skills` label.
- `MaritimeProfileCard`: remove `Professional record` eyebrow; heading becomes `Maritime Experience`; preserve edit controls and professional fields.
- `ProfileCareerTimeline`: remove decorative `Professional history` eyebrow/icon and explanatory duplicate line; heading becomes `Experience`; preserve record metadata/action icons and editor behavior.
- `ProfileCredentialWallet`: remove decorative `CoC & credentials` eyebrow/icon and explanatory duplicate line; heading becomes `Licences & Credentials`; preserve verification status and editing functionality.

Do not indiscriminately remove semantic icons inside actual record rows or action buttons; the approved cleanup targets competing section-heading decoration and duplicate hierarchy.

- [ ] **Step 6: Re-run profile tests**

```bash
npm test -- 'src/app/(app)/profile/page.test.tsx' src/features/profiles/components/profile-career-timeline.test.tsx src/features/profiles/components/profile-credential-wallet.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```text
refactor: simplify own professional profile
```

---

## Task 9: Remove the requested Maritime Network description

**Files:**
- Create: `src/app/(app)/network/page.test.tsx`
- Modify: `src/app/(app)/network/page.tsx`

- [ ] **Step 1: Write failing page test**

Mock `getNetworkHub` with a valid empty discover result. Assert:

- `People worth knowing at sea and ashore.` remains;
- the search input remains;
- network tabs remain;
- this exact sentence is absent:

```text
Build professional relationships across ships, shore offices, training, recruitment, mentoring, and the wider maritime ecosystem.
```

- [ ] **Step 2: Run and confirm RED**

```bash
npm test -- 'src/app/(app)/network/page.test.tsx'
```

Expected: FAIL because the sentence is currently rendered.

- [ ] **Step 3: Remove only the requested paragraph**

Do not change network queries, recommendations, requests, tabs, or search behavior.

- [ ] **Step 4: Re-run test**

```bash
npm test -- 'src/app/(app)/network/page.test.tsx'
```

Expected: PASS.

- [ ] **Step 5: Commit**

```text
chore: simplify maritime network intro
```

---

## Task 10: Run the complete implementation verification before any staging mutation

**Files:** none unless failures reveal a genuine implementation defect.

- [ ] **Step 1: Run focused media/profile/network suites**

```bash
npm test -- src/features/feed/media-policy.test.ts src/lib/aws/storage.test.ts src/features/feed/media.test.ts src/features/feed/repository.test.ts src/features/feed/actions.test.ts src/features/feed/components/upload-post-media.test.ts src/features/feed/components/post-composer.test.tsx src/features/feed/components/post-media.test.tsx src/features/feed/components/post-card.test.tsx 'src/app/(app)/profile/page.test.tsx' src/features/profiles/components/profile-career-timeline.test.tsx src/features/profiles/components/profile-credential-wallet.test.tsx 'src/app/(app)/network/page.test.tsx'
```

- [ ] **Step 2: Run repository-wide application checks**

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

- [ ] **Step 3: Run static AWS contracts**

```bash
node --test scripts/aws/post-media-video-schema.test.mjs
node --test scripts/aws/post-media-upload-cors.test.mjs
node --test scripts/aws/staging-deploy-guard.test.mjs
```

- [ ] **Step 4: Confirm every one-shot action is still `plan`**

Required before continuing:

```text
scripts/aws/staging-deploy-action.txt = plan
scripts/aws/edge-recovery-action.txt = plan
scripts/aws/jobs-activities-migration-action.txt = plan
scripts/aws/post-media-video-migration-action.txt = plan
```

- [ ] **Step 5: Wait for exact-head `AWS Infrastructure CI`**

Do not apply the DB migration or deploy until all jobs on the exact implementation head succeed:

- Application verify: lint, typecheck, full tests;
- Docker build;
- Terraform validate for bootstrap and app;
- Terraform plan guard tests;
- remote execution/security contracts including the new media migration/CORS tests.

If CI fails, use the failing job logs to fix the root cause, add/adjust a regression test where appropriate, and repeat exact-head verification. Do not weaken tests/guards to obtain green status.

---

## Task 11: Apply the post-media MIME migration exactly once, then reset its guard

**Precondition:** exact-head AWS Infrastructure CI is fully green.

- [ ] **Step 1: Arm only the new migration**

Change:

```text
scripts/aws/post-media-video-migration-action.txt
```

from `plan` to:

```text
apply-once
```

Keep staging deploy and edge recovery at `plan`.

Commit:

```text
chore: arm post media video migration
```

- [ ] **Step 2: Wait for exact-head CI and migration workflow**

The guarded workflow must wait for exact-head CI, then run through SSM. Require successful after-state evidence that `post_media_mime_check` contains exactly the five approved MIME types.

- [ ] **Step 3: Reset the migration guard immediately**

Change the new action file back to:

```text
plan
```

Commit:

```text
chore: reset post media video migration guard
```

- [ ] **Step 4: Verify the reset does not reapply**

The reset-head migration workflow must resolve as plan/no mutation. Confirm no second schema application occurred.

- [ ] **Step 5: Wait for reset-head AWS Infrastructure CI**

Require full green before deployment.

---

## Task 12: Deploy staging exactly once, reset the deploy guard, and verify runtime

**Preconditions:**

- media migration succeeded;
- media migration action is back to `plan`;
- edge recovery is `plan`;
- exact reset-head AWS Infrastructure CI is green.

- [ ] **Step 1: Arm one staging deployment**

Change:

```text
scripts/aws/staging-deploy-action.txt
```

from `plan` to:

```text
deploy-once
```

Commit:

```text
chore: arm staging media profile deployment
```

- [ ] **Step 2: Wait for exact-head CI and the guarded staging deploy**

Require the deploy workflow to report:

- exact image built from the triggering SHA;
- Docker push digest evidence;
- new ECS task definition;
- one PRIMARY deployment;
- rollout state `COMPLETED`;
- desired/running/pending counts healthy;
- exact task-definition image equals the expected immutable image.

- [ ] **Step 3: Reset staging deployment guard immediately**

Return:

```text
scripts/aws/staging-deploy-action.txt = plan
```

Commit:

```text
chore: reset staging deploy guard
```

- [ ] **Step 4: Verify no second deployment**

The reset-triggered staging workflow must skip its deploy job because the action is `plan`.

- [ ] **Step 5: Run/inspect post-deploy AWS verification**

Use existing AWS Remote Verify evidence for:

- staging HTTP health;
- home/feed hydration/media adapter health;
- ECS/Aurora runtime shape;
- current PRIMARY deployment CloudWatch strong-error scan.

For browser verification, use the repository's existing public Chromium verification where it applies. Do not claim an authenticated live My Profile/video-post walkthrough unless the automation actually has a signed-in staging session. Authenticated behavior is proven by focused component/action tests, production build, schema migration, exact deployed image, and healthy runtime when no authenticated browser fixture exists.

- [ ] **Step 6: Final reset-head verification**

Require the final branch head to have fully green `AWS Infrastructure CI` and confirm all controls are:

```text
staging deploy = plan
post media video migration = plan
jobs activities migration = plan
edge recovery = plan
```

- [ ] **Step 7: Completion report**

Report only evidence actually observed: final branch SHA, CI run conclusion, migration workflow result, deployed ECS task definition/image evidence, remote verify result, and guard values. Reiterate that `main` was untouched, nothing was merged, and no PR was created.

---

## Expected final user-visible behavior

- Portrait, square, landscape, and tall post images are fully visible without 16:9 cropping.
- Existing image posts continue to work from their signed S3 URLs.
- A signed-in member can select JPEG/PNG/WebP up to 5 MiB or MP4/WebM up to 200 MB.
- Media bytes upload directly from the browser to private S3 with progress rather than through the Next.js Server Action body.
- Video posts play inline with native browser controls.
- My Profile starts with the professional profile header, then About, Maritime Experience, Experience, and Licences & Credentials using a consistent hierarchy.
- `Sea N Shore professional identity`, duplicate Passport framing, decorative Sparkles overview, and bottom Posts & activity are absent from My Profile.
- Posts/comments/job applications remain available through My Activities.
- The requested Maritime Network descriptive sentence is absent while network search/tabs/relationships continue unchanged.
