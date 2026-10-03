# Sea N Shore AWS-Native Phase 5A S3 Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the remaining protected-runtime Supabase Storage dependency for post images with private Amazon S3 while preserving current media keys, post-composer behavior, Aurora rows, and rollback safety.

**Architecture:** Keep the existing authenticated Next.js server-action upload path and feed interfaces. Add a small AWS S3 boundary under `src/lib/aws/storage.ts`, keep `src/features/feed/media.ts` as the feed-specific adapter, grant the ECS task role least-privilege access to only the media bucket, inject `AWS_MEDIA_BUCKET` into runtime task definitions, and migrate existing Supabase `post-media` objects to the same keys before the final staging cutover.

**Tech Stack:** Next.js 16.3.4, Node 22+, TypeScript 5, Vitest 4, AWS SDK for JavaScript v3, Amazon S3, ECS/Fargate, Terraform >= 1.9.0 with AWS provider ~> 6.0, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-06-aws-native-phase-5a-s3-storage-design.md`

## Global Constraints

- Work only on `feat/aws-native-phase-0-1`; do not touch `main`, merge, or create a PR.
- Do not change production `seaandshore.in` DNS.
- Do not decommission or mutate Supabase source objects during Phase 5A.
- Preserve post-media keys exactly as `<profileId>/<postId>/<randomUUID>.<extension>`.
- Keep the media S3 bucket private; no public ACLs or public bucket policies.
- Running application permissions are limited to `s3:GetObject`, `s3:PutObject`, and `s3:DeleteObject` on the media bucket object ARN.
- Browser clients receive no AWS credentials.
- Existing image limits remain JPEG/PNG/WebP and <= 5 MiB.
- Signed GET URLs expire after 3600 seconds.
- Preserve ECS revision 20 / SHA `bc2660fdf4b4d67e27c3ecd666978863e4a8300c` as the pre-Phase-5A rollback reference until S3 live smoke passes.
- TDD order is RED -> GREEN -> exact-head CI -> staging deploy -> live smoke.

---

### Task 1: Add the AWS S3 storage boundary

**Files:**
- Create: `src/lib/aws/storage.test.ts`
- Create: `src/lib/aws/storage.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: standard ECS task-role credentials and `AWS_MEDIA_BUCKET`.
- Produces:
  - `getMediaBucketName(): string`
  - `createMediaReadUrl(key: string, expiresInSeconds?: number): Promise<string>`
  - `putMediaObject(input: { key: string; body: Uint8Array | Buffer; contentType: string }): Promise<void>`
  - `deleteMediaObject(key: string): Promise<void>`

- [ ] **Step 1: Write failing storage-boundary tests**

Create `src/lib/aws/storage.test.ts` with AWS SDK modules mocked before importing the module under test. Verify:

```ts
it('fails predictably when AWS_MEDIA_BUCKET is missing', async () => {
  delete process.env.AWS_MEDIA_BUCKET
  expect(() => getMediaBucketName()).toThrow('aws_media_bucket_missing')
})

it('uploads to the configured private media bucket', async () => {
  process.env.AWS_MEDIA_BUCKET = 'sea-n-shore-staging-310356785722-media'
  await putMediaObject({ key: 'profile/post/image.jpg', body: Buffer.from('image'), contentType: 'image/jpeg' })
  expect(send).toHaveBeenCalledWith(expect.objectContaining({
    input: expect.objectContaining({
      Bucket: 'sea-n-shore-staging-310356785722-media',
      Key: 'profile/post/image.jpg',
      ContentType: 'image/jpeg',
    }),
  }))
})

it('signs reads for 3600 seconds by default', async () => {
  await createMediaReadUrl('profile/post/image.jpg')
  expect(getSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.anything(), { expiresIn: 3600 })
})

it('deletes the exact object key', async () => {
  await deleteMediaObject('profile/post/image.jpg')
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ Key: 'profile/post/image.jpg' }) }))
})
```

- [ ] **Step 2: Prove RED**

Run through GitHub CI after committing only the test and dependency expectations. Expected failure: missing `src/lib/aws/storage.ts` exports and/or missing AWS SDK modules.

- [ ] **Step 3: Add dependencies**

Add:

```json
"@aws-sdk/client-s3": "^3.0.0",
"@aws-sdk/s3-request-presigner": "^3.0.0"
```

Regenerate `package-lock.json` using the same npm version used by project CI.

- [ ] **Step 4: Implement minimal storage boundary**

`src/lib/aws/storage.ts` should use `S3Client`, `PutObjectCommand`, `GetObjectCommand`, `DeleteObjectCommand`, and `getSignedUrl`.

```ts
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

let client: S3Client | null = null

export function getMediaBucketName(): string {
  const bucket = process.env.AWS_MEDIA_BUCKET?.trim()
  if (!bucket) throw new Error('aws_media_bucket_missing')
  return bucket
}

function getS3Client(): S3Client {
  client ??= new S3Client({ region: process.env.AWS_REGION || process.env.AWS_COGNITO_REGION || 'ap-south-1' })
  return client
}

export async function createMediaReadUrl(key: string, expiresInSeconds = 3600): Promise<string> {
  const command = new GetObjectCommand({ Bucket: getMediaBucketName(), Key: key })
  return getSignedUrl(getS3Client(), command, { expiresIn: expiresInSeconds })
}

export async function putMediaObject(input: { key: string; body: Uint8Array | Buffer; contentType: string }): Promise<void> {
  await getS3Client().send(new PutObjectCommand({
    Bucket: getMediaBucketName(),
    Key: input.key,
    Body: input.body,
    ContentType: input.contentType,
  }))
}

export async function deleteMediaObject(key: string): Promise<void> {
  await getS3Client().send(new DeleteObjectCommand({ Bucket: getMediaBucketName(), Key: key }))
}
```

- [ ] **Step 5: Run focused tests and commit**

Run: `npx vitest run src/lib/aws/storage.test.ts`
Expected: PASS.

Commit: `feat: add S3 media storage boundary`

---

### Task 2: Replace the feed Supabase Storage adapter with S3

**Files:**
- Create: `src/features/feed/media.test.ts`
- Modify: `src/features/feed/media.ts`
- Modify: `src/features/feed/actions.test.ts`

**Interfaces:**
- Consumes Task 1 storage functions.
- Preserves existing public feed interface:
  - `resolveFeedMediaUrls(paths: string[]): Promise<Map<string, string>>`
  - `uploadFeedImage(input: { profileId: string; postId: string; file: File; extension: string }): Promise<string>`
  - `removeFeedImage(storagePath: string): Promise<void>`

- [ ] **Step 1: Write failing feed-media tests**

Mock `@/lib/aws/storage` and assert:

```ts
it('preserves the existing object key shape', async () => {
  vi.spyOn(crypto, 'randomUUID').mockReturnValue('cccccccc-cccc-4ccc-8ccc-cccccccccccc')
  const path = await uploadFeedImage({
    profileId: '11111111-1111-4111-8111-111111111111',
    postId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    file: new File(['image'], 'image.jpg', { type: 'image/jpeg' }),
    extension: 'jpg',
  })
  expect(path).toBe('11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-8ccc-cccccccccccc.jpg')
})

it('resolves each readable key without failing the entire feed', async () => {
  mockedCreateMediaReadUrl
    .mockResolvedValueOnce('https://signed.example/one')
    .mockRejectedValueOnce(new Error('missing'))
  expect(await resolveFeedMediaUrls(['one.jpg', 'missing.jpg'])).toEqual(new Map([['one.jpg', 'https://signed.example/one']]))
})
```

Also assert upload converts `File` to bytes and passes the original MIME type, and delete forwards the exact key.

- [ ] **Step 2: Prove RED in CI**

Expected failure: `media.ts` still imports Supabase and does not call the S3 boundary.

- [ ] **Step 3: Implement the S3 feed adapter**

Replace the Supabase client import with:

```ts
import { createMediaReadUrl, deleteMediaObject, putMediaObject } from '@/lib/aws/storage'
```

For upload:

```ts
const bytes = new Uint8Array(await input.file.arrayBuffer())
await putMediaObject({ key: storagePath, body: bytes, contentType: input.file.type })
```

Translate upload failures to `new Error('feed_media_upload_failed')`. Resolve each signed URL independently so one failed key does not fail the full map.

- [ ] **Step 4: Strengthen compensation test**

In `actions.test.ts`, mock `uploadFeedImage` / `removeFeedImage`; force `createStandardPostWithAurora` to reject after a successful upload and assert the S3-backed `removeFeedImage(storagePath)` is called while the existing UI error copy remains unchanged.

- [ ] **Step 5: Run focused tests and commit**

Run:

```bash
npx vitest run src/features/feed/media.test.ts src/features/feed/actions.test.ts
```

Expected: PASS.

Commit: `feat: move feed media adapter to S3`

---

### Task 3: Wire least-privilege S3 access into ECS and staging deploys

**Files:**
- Modify: `infra/aws/app/storage.tf`
- Modify: `infra/aws/app/main.tf`
- Modify: `.github/workflows/aws-staging-deploy.yml`
- Modify: `scripts/aws/remote-execution-config.test.mjs`

**Interfaces:**
- Produces runtime environment `AWS_MEDIA_BUCKET=<aws_s3_bucket.app["media"].bucket>`.
- Produces ECS task-role policy with only `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` against `${aws_s3_bucket.app["media"].arn}/*`.

- [ ] **Step 1: Add failing infrastructure/runtime contract assertions**

Add assertions to `scripts/aws/remote-execution-config.test.mjs` for:

```js
assert.match(storageTerraform, /s3:GetObject/)
assert.match(storageTerraform, /s3:PutObject/)
assert.match(storageTerraform, /s3:DeleteObject/)
assert.match(storageTerraform, /aws_s3_bucket\.app\["media"\]\.arn/)
assert.match(mainTerraform, /AWS_MEDIA_BUCKET/)
assert.match(deploy, /AWS_MEDIA_BUCKET/)
assert.match(deploy, /\{\"name\":\"AWS_MEDIA_BUCKET\",\"value\":\$AWS_MEDIA_BUCKET\}/)
```

Also assert no `s3:*` appears in the task-role policy.

- [ ] **Step 2: Prove RED**

Run: `node --test scripts/aws/remote-execution-config.test.mjs`
Expected: FAIL because the runtime does not expose the media bucket and the task role lacks S3 permissions.

- [ ] **Step 3: Add ECS task-role policy**

In `infra/aws/app/storage.tf` add an inline policy attached to `aws_iam_role.ecs_task`:

```hcl
resource "aws_iam_role_policy" "ecs_task_media" {
  name = "${local.name_prefix}-ecs-task-media"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "PostMediaObjects"
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
      Resource = "${aws_s3_bucket.app["media"].arn}/*"
    }]
  })
}
```

- [ ] **Step 4: Add Terraform runtime environment**

In `infra/aws/app/main.tf` add:

```hcl
{ name = "AWS_MEDIA_BUCKET", value = aws_s3_bucket.app["media"].bucket },
```

Do not add bucket credentials or public URLs.

- [ ] **Step 5: Preserve the variable in manual staging deploys**

In `.github/workflows/aws-staging-deploy.yml` add staging env:

```yaml
AWS_MEDIA_BUCKET: sea-n-shore-staging-310356785722-media
```

Validate it before ECS deployment. In the `jq` task-definition rewrite, remove any existing `AWS_MEDIA_BUCKET` entry and append:

```json
{"name":"AWS_MEDIA_BUCKET","value":$AWS_MEDIA_BUCKET}
```

- [ ] **Step 6: Run infrastructure tests and Terraform validation**

Run:

```bash
node --test scripts/aws/remote-execution-config.test.mjs
terraform -chdir=infra/aws/app fmt -check
terraform -chdir=infra/aws/app validate
```

Expected: PASS.

Commit: `feat: grant ECS media bucket access`

---

### Task 4: Add repeatable Supabase-to-S3 post-media migration tooling

**Files:**
- Create: `scripts/aws/migrate-post-media-to-s3.mjs`
- Create: `scripts/aws/migrate-post-media-to-s3.test.mjs`
- Modify: `package.json` only if a dedicated script entry is useful; otherwise invoke with `node`.

**Interfaces:**
- Inputs: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` only in the trusted migration execution context, `AWS_MEDIA_BUCKET`, AWS task/admin credentials, optional `DRY_RUN=true`.
- Output: JSON summary containing `sourceBucket`, `destinationBucket`, `sourceObjectCount`, `sourceBytes`, `copiedCount`, `verifiedCount`, `timestamp`.
- Must never print the Supabase service-role key or signed URLs.

- [ ] **Step 1: Write failing pure-function tests**

Structure the migration script so listing/copying/verification orchestration can be tested with injected source/destination adapters. Verify zero-object inventory, identical-key copy, idempotent destination-existing behavior, and mismatched-size verification failure.

- [ ] **Step 2: Prove RED**

Run: `node --test scripts/aws/migrate-post-media-to-s3.test.mjs`
Expected: FAIL because migration functions do not exist.

- [ ] **Step 3: Implement source inventory and copy**

Use Supabase Storage admin APIs only in this migration script, not application runtime. Enumerate `post-media` recursively, download each object, then `PutObject` to `AWS_MEDIA_BUCKET` with the same key. For an existing S3 key with the same size, treat it as already migrated.

- [ ] **Step 4: Implement verification summary**

After copy, verify every source key expected by the migration exists in S3 and compare source/destination size where available. Exit nonzero on any missing key or size mismatch. Record an explicit zero-object result when source count is zero.

- [ ] **Step 5: Run tests and commit**

Run: `node --test scripts/aws/migrate-post-media-to-s3.test.mjs`
Expected: PASS.

Commit: `feat: add post media S3 migration tool`

---

### Task 5: Remove the feed-media Supabase runtime exception

**Files:**
- Modify: `scripts/aws/check-phase4-supabase-runtime.sh`

**Interfaces:**
- Produces a stricter protected-runtime guard where only the legacy auth callback may remain classified for later Cognito cleanup.

- [ ] **Step 1: Change the audit expectation**

Remove `src/features/feed/media.ts` from the `grep -vE` exception and remove the Phase 5 classification output.

The allowed exception becomes only:

```bash
grep -vE '^(src/app/auth/callback/route\.ts):'
```

- [ ] **Step 2: Run the guard**

Run: `bash scripts/aws/check-phase4-supabase-runtime.sh`
Expected: PASS and no feed-media Supabase classification.

- [ ] **Step 3: Commit**

Commit: `chore: close Supabase storage runtime exception`

---

### Task 6: Exact-head verification and staging infrastructure apply

**Files:**
- No new application source required unless CI exposes a defect.

**Interfaces:**
- Exact branch head after Tasks 1-5 becomes the only deployable SHA.
- Pre-cutover rollback remains ECS revision 20.

- [ ] **Step 1: Run exact-head CI**

Verify on the exact current branch SHA:

- protected Supabase runtime audit;
- lint;
- typecheck;
- all Vitest tests;
- production Docker build;
- Terraform plan guard tests;
- Terraform validate for app/bootstrap;
- remote execution contract tests.

Do not proceed if any job is red.

- [ ] **Step 2: Inventory and migrate existing post media**

Run the migration tool from a trusted context with source Supabase service-role access and AWS S3 access. Preserve the resulting JSON inventory/verification summary in migration records. Do not delete source objects.

- [ ] **Step 3: Apply Terraform app changes to staging**

Apply the app Terraform change from a trusted admin path so the ECS task role receives the new S3 object policy and the canonical task definition receives `AWS_MEDIA_BUCKET`.

Also apply the previously source-only bootstrap CloudWatch permission if it is still pending; it is independent from the app storage policy but required for the final log gate.

- [ ] **Step 4: Verify AWS state before application deploy**

Confirm:

```text
media bucket exists and remains private
ECS task role has GetObject/PutObject/DeleteObject only on media bucket objects
AWS_MEDIA_BUCKET is present in the canonical task definition
```

---

### Task 7: Deploy exact Phase 5A SHA and complete live storage smoke

**Files:**
- No source changes unless live verification exposes a defect.

**Interfaces:**
- Deploy only the exact GREEN SHA from Task 6.
- Record new ECR digest, ECS task-definition revision, and rollback revision 20.

- [ ] **Step 1: Dispatch `AWS Staging Deploy` with `deploy_to_ecs=true`**

Use branch `feat/aws-native-phase-0-1`. Verify workflow `head_sha` equals the exact GREEN SHA.

- [ ] **Step 2: Verify service stability and runtime shape**

Require:

```text
desiredCount=1
runningCount=1
pendingCount=0
rolloutState=COMPLETED
failedTasks=0
AWS_MEDIA_BUCKET present
```

- [ ] **Step 3: Verify health endpoints**

Require HTTP 200 from `/api/health/phase4` and `/api/health/home`, preserving database, identity, content/network, feed, hydration, and media health.

- [ ] **Step 4: Authenticated live media smoke**

In the signed-in staging browser:

1. publish a JPEG/PNG/WebP image under 5 MiB;
2. confirm the post publishes;
3. confirm the image renders in Home;
4. hard refresh;
5. confirm the same image still renders;
6. navigate away/back or load another authenticated feed surface and confirm the image resolves again.

- [ ] **Step 5: Review CloudWatch errors**

Require no repeating `AccessDenied`, S3 signing, missing-bucket, or upload failures during the smoke window.

- [ ] **Step 6: Record closeout**

Record deployed SHA, image digest, new ECS revision, rollback revision 20, migration source/destination counts, health results, and live smoke result. Keep Supabase source storage intact for rollback until the later full migration validation window.

Phase 5A is complete only when all steps above are green.