# LinkedIn-style media and profile cleanup design

Date: 2026-09-09
Branch: `feat/aws-native-phase-0-1`

## Goal

Make Sea N Shore's posting and profile experience feel like a modern professional network while preserving Sea N Shore's own brand.

Success means:

1. Portrait, square, landscape and tall images are fully visible instead of being cropped into 16:9.
2. Users can upload MP4/WebM videos and play them inline in feed posts.
3. My Profile becomes one clean professional profile instead of repeated Passport, snapshot and activity blocks.
4. The requested Maritime Network description is removed.

## Scope

Included:

- Direct browser-to-S3 post-media uploads.
- JPEG, PNG, WebP, MP4 and WebM.
- Existing image limit of 5 MiB.
- Initial video limit of 200 MB.
- Upload progress, media preview and remove/replace before publish.
- Inline video playback.
- Additive `post_media` MIME migration.
- Restricted CORS for the private media S3 bucket.
- My Profile hierarchy/typography cleanup.
- Removal of duplicate Passport overview and Posts & activity from My Profile.
- Removal of the requested profile copy/decorative icon.
- Removal of the requested Maritime Network sentence.
- TDD, full CI, guarded migration and guarded staging deployment.

Not included:

- Copying LinkedIn branding or exact UI.
- Multi-image/carousel posts.
- MediaConvert, HLS/DASH or adaptive bitrate transcoding.
- Automatic video thumbnails, editing, trimming or captions.
- New profile/recruiter fields.
- A redesign of public profile behavior beyond changes needed to keep shared components visually consistent.

## Media architecture

### Direct upload

Large media must not flow through the current Next.js server action. The authenticated app issues a short-lived presigned upload authorization after validating media metadata. The browser uploads directly to the existing private S3 media bucket. Post creation then stores the server-issued storage path and MIME type in `post_media`.

The bucket remains private. Feed reads continue to use short-lived signed read URLs. CORS is restricted to the application origin(s), required methods and headers only.

Object keys are generated server-side and scoped to the authenticated user/media namespace; arbitrary client-supplied object keys are never trusted.

### Validation

Allowed MIME types:

- `image/jpeg`
- `image/png`
- `image/webp`
- `video/mp4`
- `video/webm`

Limits:

- Images: 5 MiB maximum, preserving the current image policy.
- Videos: 200 MB maximum.
- One media object per post, preserving the current one-to-one `post_media` model.

Validation occurs before presigning and again when finalizing the post so an unsupported file or unrelated S3 object cannot be attached by tampering with client state.

### Composer

The composer exposes a clear Photo / Video media action. After selection it shows an uncropped image preview or playable video preview, upload progress, and a remove/replace control. Publish stays disabled while the direct upload is incomplete. Validation and upload errors appear inline without discarding the user's post text.

If S3 upload succeeds but post creation fails, the server performs best-effort orphan cleanup and logs cleanup failure without exposing the object publicly.

### Feed rendering

Rendering is selected from `post_media.mime_type`.

Images:

- remove the fixed 16:9 `object-cover` treatment;
- preserve the natural aspect ratio;
- fit to the post width;
- never destructively crop normal post media;
- use `object-contain` if a bounded area is required;
- for extremely tall images, a viewport-height maximum may be used only if the whole image remains viewable rather than cropped.

Videos:

- render an inline `<video>` player;
- use browser-native controls for play/pause, scrub, volume and fullscreen where supported;
- do not autoplay with sound;
- use mobile-native playback behavior where appropriate.

This phase intentionally does not promise transcoding. If a browser cannot decode a codec inside an otherwise accepted MP4/WebM container, native fallback text is shown.

## Database and AWS changes

Create an additive migration that replaces the current image-only `post_media` MIME constraint with the five approved MIME values. Existing rows are not rewritten.

Add only the AWS changes required for direct uploads: restricted media-bucket CORS and any narrowly scoped task permissions required to issue/validate presigned uploads. The bucket stays private and no broad public policy is introduced.

The migration is applied once through the repository's guarded migration workflow and returned to `plan` immediately afterward.

## My Profile redesign

My Profile becomes a single calm professional profile rather than a dashboard of repeated summaries.

Page order:

1. Profile header — cover, avatar, name, headline, existing location/status and actions.
2. About.
3. Maritime Experience — rank, current vessel, sailing experience, vessel types, trading areas, availability, shore-career preference, with existing inline editing.
4. Experience.
5. Licences & Credentials.

Remove from the own-profile page:

- the introductory `Professional identity` eyebrow;
- the separate `My Maritime Passport` introductory heading/copy above the actual profile header;
- `ProfilePassportOverview` entirely;
- `Sea N Shore professional identity`;
- duplicate `Maritime Passport`, `Professional snapshot`, and `What a maritime recruiter needs first` headings;
- the decorative Sparkles icon shown in that overview;
- duplicate snapshot metrics already represented by the profile header/Maritime Experience;
- the bottom `Posts & activity` section;
- the `getPostsByAuthor` query that exists only to populate that removed section.

Posts, comments and job applications remain in the dedicated My Activities page.

Typography is normalized to one primary profile/name scale, one section-heading scale, one standard body scale and one muted-secondary scale. Profile sections use a consistent white-card/border/radius treatment and consistent edit controls. Decorative uppercase eyebrow labels and decorative heading icons are removed when they repeat information rather than communicate an action.

## Maritime Network

Keep the title, search and tabs. Remove this sentence completely:

`Build professional relationships across ships, shore offices, training, recruitment, mentoring, and the wider maritime ecosystem.`

No network query, connection or search behavior changes.

## Data flow

1. User selects supported media.
2. Client validates basic MIME and size.
3. Client requests an authenticated presigned upload target.
4. Server validates, generates a scoped key and returns short-lived upload authorization.
5. Browser uploads directly to private S3 and reports progress.
6. Client submits post data plus the server-issued media reference.
7. Server verifies ownership/reference/type and creates the post/media records.
8. Feed query resolves the media to a signed read URL.
9. Post card renders image or video according to MIME type.

## Error handling

- Unsupported format: reject before upload with supported formats.
- Image over 5 MiB or video over 200 MB: reject before upload with the applicable limit.
- Presign failure: preserve composer state and allow retry.
- S3 upload failure: do not create the post; allow retry/remove.
- Post creation failure after upload: attempt object cleanup and preserve a clear composer error.
- Expired read URL: normal page/query refresh obtains a new signed URL.
- Unsupported browser codec: native video fallback text; no fake transcoding promise.

## Testing

Implementation uses TDD. Focused tests cover:

- migration accepts approved video MIME types and rejects unsupported values;
- presign authorization checks authentication, MIME, size and scoped object ownership;
- composer supports image/video, preview/progress and media limits;
- publish cannot complete while upload is incomplete;
- image post cards no longer contain the fixed 16:9 destructive crop behavior;
- portrait/tall images remain fully visible;
- video media renders `<video controls>`;
- existing image posts still render;
- My Profile no longer imports/renders `ProfilePassportOverview` or `ProfilePostsSection`;
- My Profile no longer executes its removed posts query;
- About, Maritime Experience, Experience and Credentials remain present/editable;
- removed profile labels/decorative icon are absent from My Profile;
- Maritime Network no longer renders the requested sentence.

Then run the full repository lint, typecheck, tests, Docker build, Terraform validation and AWS guard checks on the exact implementation head.

## Rollout constraints

1. Work only on `feat/aws-native-phase-0-1`.
2. Do not touch `main`, merge or create a PR.
3. Keep staging deploy, migration and edge-recovery controls at `plan` during development.
4. Require exact-head green CI before staging mutation.
5. Apply the media migration exactly once, then reset its guard to `plan`.
6. Deploy staging exactly once, then reset deploy guard to `plan`.
7. Run post-deploy AWS runtime/HTTP and browser verification.
8. Confirm reset-head CI is green and the reset did not trigger a second deployment.

## Completion criteria

The feature is complete only when portrait/tall images are fully visible, image regressions are absent, a signed-in user can directly upload and publish MP4/WebM video up to 200 MB, videos play inline, S3 remains private, My Profile has the simplified hierarchy without duplicate Passport/activity blocks, the requested Network copy is gone, all focused/full checks are green, staging is updated once, and every one-shot guard has been returned to `plan`.
