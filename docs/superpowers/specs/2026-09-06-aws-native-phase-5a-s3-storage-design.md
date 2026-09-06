# Sea N Shore AWS-Native Phase 5A S3 Storage Cutover Design

Date: 2026-09-06
Status: Approved design

## 1. Goal

Replace the remaining Supabase Storage dependency used by Sea N Shore post media with private Amazon S3 storage while preserving current post-composer behavior, existing database media paths, authorization boundaries, and rollback safety.

This phase must not change production DNS, remove Supabase packages globally, merge to `main`, or decommission Supabase. It prepares and validates the storage cutover on the existing AWS staging environment first.

## 2. Current State

The application is already running on ECS/Fargate with Aurora PostgreSQL and Cognito-backed protected application flows.

Post media is the remaining protected runtime storage dependency on Supabase. `src/features/feed/media.ts` currently:

- generates signed read URLs from the Supabase `post-media` bucket;
- uploads new JPEG, PNG, and WebP post images to Supabase Storage;
- deletes failed/rolled-back post image uploads from Supabase Storage.

The post composer limits images to 5 MiB and stores the returned storage path in Aurora as part of post media metadata.

AWS Terraform already defines three private S3 buckets:

- media;
- private documents;
- migration backups.

All are blocked from public access, use bucket versioning, and use server-side AES256 encryption.

The ECS task role does not yet have the S3 object permissions required by the application, and the current task definition does not provide a media-bucket environment variable.

## 3. Scope

### 3.1 In scope

- replace Supabase post-media upload with S3 `PutObject`;
- replace Supabase signed read URLs with short-lived S3 presigned GET URLs;
- replace Supabase post-media delete with S3 `DeleteObject`;
- preserve the existing storage key shape;
- add least-privilege S3 permissions to the ECS task role;
- expose the media bucket name to the ECS task as `AWS_MEDIA_BUCKET`;
- add automated tests for the storage adapter and infrastructure/runtime contract;
- inventory existing Supabase post-media objects;
- provide a repeatable migration path that copies existing objects to S3 under identical keys;
- verify object counts/keys before staging cutover;
- deploy the S3-backed application to AWS staging;
- perform upload/read/delete live smoke tests;
- remove `src/features/feed/media.ts` from the Supabase protected-runtime exception list after the S3 cutover passes.

### 3.2 Out of scope

- production `seaandshore.in` DNS cutover;
- CloudFront public media delivery;
- public S3 ACLs or public bucket policies;
- direct browser-to-S3 uploads;
- video uploads or files larger than the existing 5 MiB image limit;
- CV/resume or other private-document product flows not currently implemented in the application;
- global removal of Supabase packages/tooling;
- Supabase project deletion;
- SES implementation;
- Cognito Google federation cleanup;
- Vercel shutdown.

## 4. Approved Architecture

### 4.1 Upload path

```text
Authenticated browser
  -> Next.js server action
  -> requireAwsUser()
  -> validate media type/size
  -> ECS task IAM role
  -> Amazon S3 private media bucket
  -> Aurora post/media metadata
```

The browser does not receive AWS credentials.

The existing server-action upload flow remains unchanged from the user's perspective. This intentionally avoids introducing a multipart/presigned-browser-upload protocol while the supported upload size remains 5 MiB.

### 4.2 Read path

```text
Feed query
  -> Aurora storage paths
  -> S3 storage adapter
  -> presigned GET URLs
  -> PostCard image rendering
```

Signed read URLs should remain short-lived. The initial target is 3600 seconds to preserve the current Supabase behavior.

### 4.3 Delete path

If an S3 upload succeeds but Aurora post creation fails, the server removes the newly uploaded S3 object before returning the existing post-composer error.

Delete failures during compensation are best-effort and should not replace the original post-publication error. Such failures may be logged without exposing secrets or object contents.

## 5. Object-Key Compatibility

New S3 post-media keys must preserve the current application path shape:

```text
<profileId>/<postId>/<randomUUID>.<extension>
```

Example:

```text
10dc1a8c-.../82f0d0ee-.../0cd297c0-....jpg
```

The application database continues storing only the storage key/path rather than a provider-specific URL.

This compatibility is required so existing Aurora rows do not need a schema or data rewrite when the storage provider changes.

## 6. S3 Bucket Model

Phase 5A uses the existing Terraform media bucket:

```text
${project_name}-${environment}-${account_id}-media
```

For staging this resolves from Terraform rather than being duplicated as a hard-coded application constant.

The bucket remains:

- private;
- protected by S3 Block Public Access;
- versioned;
- encrypted with S3-managed AES256 encryption.

No public read policy is introduced in this phase.

## 7. Application Storage Boundary

Create a small AWS storage boundary so feed code does not construct AWS SDK clients inline throughout business logic.

Recommended shape:

```text
src/lib/aws/storage.ts
- getMediaBucketName()
- getS3Client()
- createMediaReadUrl(key, expiresInSeconds)
- putMediaObject({ key, body, contentType })
- deleteMediaObject(key)
```

`src/features/feed/media.ts` remains the feed-specific adapter and owns feed key generation plus feed-level error translation.

The feed layer should continue exporting the current interface:

```ts
resolveFeedMediaUrls(paths: string[]): Promise<Map<string, string>>
uploadFeedImage(input): Promise<string>
removeFeedImage(storagePath: string): Promise<void>
```

This keeps all existing callers unchanged.

## 8. AWS SDK Dependency

Use AWS SDK for JavaScript v3:

- `@aws-sdk/client-s3`;
- `@aws-sdk/s3-request-presigner`.

The ECS task uses its task-role credentials through the standard AWS credential-provider chain. No static AWS key or secret is added to application configuration.

## 9. ECS Runtime Configuration

The ECS task definition receives:

```text
AWS_MEDIA_BUCKET=<Terraform media bucket name>
```

The application should fail clearly at server runtime if the bucket name is missing when a media operation is attempted.

`AWS_REGION` may be supplied explicitly to the application if needed by the SDK boundary; otherwise the existing AWS runtime region/environment can be used. The implementation should prefer an explicit application-region configuration already used by the project rather than adding duplicate region sources.

## 10. IAM

Add least-privilege object permissions to the ECS task role for the media bucket only.

Required actions:

```text
s3:GetObject
s3:PutObject
s3:DeleteObject
```

Required resource scope:

```text
arn:aws:s3:::<media-bucket>/*
```

No wildcard S3 permissions across all buckets are permitted.

No bucket-administration permissions are required by the running application.

If migration verification tooling requires `ListBucket`, grant that only to the trusted migration/admin execution path, not the web task role unless runtime code genuinely requires it.

## 11. Existing Object Migration

Before the application stops reading Supabase post media, inventory the source `post-media` bucket.

Inventory output must record at minimum:

- total source object count;
- object keys;
- total bytes if available;
- migration timestamp;
- source bucket/project identifier;
- destination S3 bucket.

Existing objects are copied to S3 using exactly the same storage keys already stored in Aurora.

The migration must be idempotent. Re-running it must not create alternate keys or duplicate database records.

If the source bucket contains zero objects, record the zero-object result explicitly and continue; zero content is a valid migration state.

After copying, verify at minimum:

- every source key expected by the application exists in S3;
- destination count is at least the migrated source set;
- sampled object sizes match where source metadata is available;
- no Aurora media path requires path rewriting.

Supabase remains intact during this step and serves as rollback source until the storage validation window is complete.

## 12. Cutover Order

The safe staging order is:

1. Add tests for the S3 storage boundary and infrastructure/runtime contract.
2. Prove RED on the current branch.
3. Implement the S3 storage adapter.
4. Add AWS SDK dependencies.
5. Add ECS task-role S3 permissions.
6. Add `AWS_MEDIA_BUCKET` to the ECS task definition and deploy workflow task-definition mutation path.
7. Keep existing Supabase exception temporarily while migration/cutover work is still in progress.
8. Run exact-head lint, typecheck, unit tests, build, Terraform validation, and existing AWS CI guards.
9. Inventory and migrate existing Supabase `post-media` objects to S3.
10. Verify source/destination keys.
11. Apply required Terraform/runtime IAM changes in AWS staging.
12. Deploy the exact application SHA to ECS staging.
13. Verify `/api/health/phase4` and `/api/health/home` remain green.
14. Perform authenticated media smoke: publish image, load image in feed, refresh, confirm image still loads, and exercise a compensated delete path through automated tests.
15. Tighten `scripts/aws/check-phase4-supabase-runtime.sh` so `src/features/feed/media.ts` is no longer an allowed Supabase runtime dependency.
16. Re-run exact-head CI after removing that exception.

## 13. Deployment Workflow Requirement

The existing staging deploy workflow constructs a fresh task-definition revision from the current ECS task definition. It must preserve/add `AWS_MEDIA_BUCKET` when registering new revisions.

A storage cutover is not complete merely because Terraform source contains the variable. The running ECS revision must be inspected after deploy to confirm the variable is present and the task role has access to S3.

## 14. Error Handling

### Upload

- AWS SDK upload failure -> throw/translate to `feed_media_upload_failed` so the existing composer returns `We could not upload your image. Your post was not published.`
- Aurora post-create failure after upload -> best-effort S3 delete, then keep the existing composer error.

### Read

- Individual presign failure should not crash the entire feed page.
- `resolveFeedMediaUrls()` should return successfully with only the URLs it could resolve; unresolved media entries remain without a signed URL.
- Configuration/client failures should be visible to tests and logs without leaking credentials.

### Delete

- Explicit delete helper may throw for direct callers if needed, but compensating cleanup should remain best-effort at the action boundary.

## 15. Testing Strategy

### 15.1 Unit tests

Add focused tests for:

- correct S3 object key generation;
- upload passes the expected bucket, key, body, and content type;
- read signing uses the configured media bucket and 3600-second expiry;
- multiple keys produce the expected map;
- delete targets the exact key;
- missing media-bucket configuration fails predictably;
- feed action still compensates uploaded media when Aurora post creation fails.

AWS SDK calls must be injectable/mockable so unit tests do not contact AWS.

### 15.2 Infrastructure tests

Tests/guards must verify:

- ECS task role policy contains only the intended S3 object actions for the media bucket;
- task definition exposes `AWS_MEDIA_BUCKET`;
- staging deploy workflow preserves/injects `AWS_MEDIA_BUCKET` into new task revisions;
- Terraform validates.

### 15.3 Protected-runtime audit

During implementation, the Phase 4 audit may temporarily retain the current classified feed-media exception.

Final Phase 5A GREEN requires that exception to be removed and that protected runtime contains no Supabase Storage usage in `src/features/feed/media.ts`.

### 15.4 Live staging smoke

Authenticated smoke must verify:

1. sign in;
2. publish a JPEG/PNG/WebP post image under 5 MiB;
3. post publishes successfully;
4. feed renders the uploaded image;
5. hard refresh still renders the image;
6. another authenticated feed page using the same post can resolve the image;
7. CloudWatch/ECS logs show no repeating S3 authorization or signing errors.

If practical, inspect the new S3 key from the migration/admin path to confirm it exists in the private media bucket.

## 16. Rollback

Until Phase 5A is validated, do not delete or mutate the Supabase source objects.

Rollback options:

- redeploy the previous verified ECS task-definition revision using the Supabase-backed image;
- leave newly copied S3 objects in place for the next retry;
- restore the previous task definition/runtime variables if necessary;
- do not rewrite Aurora storage paths because the same key format is intentionally preserved.

The last known stable ECS revision before Phase 5A begins is revision 20, application SHA `bc2660fdf4b4d67e27c3ecd666978863e4a8300c`.

Any subsequent deploy must record its new ECS revision and preserve revision 20 as the pre-Phase-5A rollback reference until the new storage path is verified.

## 17. Security Requirements

- no public S3 bucket or object ACLs;
- no long-lived AWS access keys in GitHub or application environment;
- use ECS task-role credentials;
- restrict task-role access to the staging media bucket object ARN;
- do not log object contents, AWS credentials, signed URL query strings, session cookies, or personal data;
- preserve existing server-side authentication before upload actions;
- signed GET URLs are temporary access grants and must not be stored as permanent database values.

## 18. Success Criteria

Phase 5A is complete when all of the following are true:

1. New post images upload to S3 rather than Supabase Storage.
2. Feed media is read using S3 signed URLs.
3. Failed post creation compensates S3 uploads.
4. Existing Aurora media paths do not require rewriting.
5. Existing Supabase post-media objects have been inventoried and migrated, or a zero-object inventory has been recorded.
6. Source/destination storage verification passes.
7. ECS task role has only the required S3 object permissions.
8. The running ECS task has `AWS_MEDIA_BUCKET` configured.
9. Exact-head application and Terraform CI are green.
10. Authenticated staging upload/read smoke passes.
11. Protected-runtime audit no longer permits `src/features/feed/media.ts` to depend on Supabase.
12. Supabase remains available as rollback until the later full migration validation window.

## 19. Next Phase

After Phase 5A passes, continue with a separate approved implementation boundary for transactional email/SES, followed by the remaining Cognito/Google cleanup, HTTPS/CloudFront/WAF, full AWS staging certification, final data sync, production DNS cutover, and eventual Vercel/Supabase removal.