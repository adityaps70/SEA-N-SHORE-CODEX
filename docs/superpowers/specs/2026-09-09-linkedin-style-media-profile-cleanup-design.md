# LinkedIn-style media and profile cleanup design

Date: 2026-09-09
Branch: `feat/aws-native-phase-0-1`

## Goal

Make Sea N Shore's posting and profile experience feel closer to a modern professional network while keeping Sea N Shore's own visual identity.

The work has four user-visible outcomes:

1. Portrait, square, landscape and tall images display without destructive cropping.
2. Users can upload and publish videos that play inline in the feed.
3. My Profile becomes a simple professional profile rather than a stack of repeated passport/summary/activity sections.
4. The Maritime Network introduction is simplified by removing the requested descriptive sentence.

## Scope

### Included

- Photo rendering that preserves the complete uploaded image.
- Direct browser-to-S3 upload flow for post media.
- Video upload and inline playback.
- JPEG, PNG, WebP, MP4 and WebM post-media support.
- Initial 200 MB maximum video size.
- Upload progress and removable media preview in the composer.
- Additive database migration for video MIME types.
- Restricted media-bucket CORS needed for direct uploads.
- Simplified My Profile structure and consistent typography.
- Removal of duplicate Passport overview content from My Profile.
- Removal of the My Profile Posts & activity section.
- Removal of the decorative Sparkles icon and the `Sea N Shore professional identity` copy from My Profile through removal of the redundant Passport overview.
- Removal of the Maritime Network sentence requested by the user.
- Focused automated tests plus the repository's full CI and guarded staging deployment workflow.

### Not included

- Copying LinkedIn's branding, visual assets or exact UI.
- Multi-image carousel posts.
- Video transcoding, HLS/DASH adaptive streaming or AWS MediaConvert in this phase.
- Automatic video thumbnails.
- Video editing, trimming or caption generation.
- New recruiter/profile fields.
- Changing public profile semantics unless required for visual consistency.

## Design approach

### 1. Media upload architecture

Use direct-to-S3 uploads rather than sending large media through the Next.js server action.

The authenticated application will issue a short-lived presigned upload authorization for a validated media object. The browser uploads the file directly to the existing private media S3 bucket. After the upload succeeds, the normal post creation flow stores the uploaded object's storage path and MIME type in `post_media`.

This keeps large video bytes out of application memory and avoids increasing the current small server-action request limit to hundreds of megabytes.

The media bucket remains private. Read access continues through the existing signed-media URL pattern. The S3 CORS policy will be restricted to the application origin(s), required HTTP methods and headers only.

### 2. Upload validation

Supported post-media MIME types:

- `image/jpeg`
- `image/png`
- `image/webp`
- `video/mp4`
- `video/webm`

Initial limits:

- Images: retain the existing image size policy unless implementation review shows a lower direct-upload constraint elsewhere.
- Videos: maximum 200 MB.
- One media object per post, preserving the current one-to-one `post_media` model.

Validation occurs before issuing the upload authorization and is checked again when the post is finalized so a user cannot attach an arbitrary object key or unsupported MIME type.

Object keys are generated server-side and scoped to the authenticated user/post-media area rather than accepted as arbitrary client input.

### 3. Composer experience

The post composer presents a clear Photo / Video media action.

After choosing media:

- image: show a full, uncropped preview;
- video: show a playable preview using browser-native controls;
- show the selected file name/type where useful;
- show upload progress during direct upload;
- allow the user to remove/replace the media before publishing;
- disable publish while an upload is incomplete;
- show concise validation/upload errors inline.

If an upload succeeds but post creation fails, the application should make a best-effort cleanup of the orphaned S3 object. A cleanup failure must not expose the object publicly and should be observable in logs.

### 4. Feed media rendering

The post card chooses rendering based on `post_media.mime_type`.

#### Images

Images must never be forced into the current fixed 16:9 crop.

Rendering rules:

- use the media's natural aspect ratio;
- fit to available feed width;
- never use destructive `object-cover` cropping for normal post media;
- use `object-contain` where a bounded visual area is necessary;
- preserve rounded card treatment and responsive width;
- extremely tall images may have a reasonable viewport maximum, but the entire image must remain viewable rather than cropped.

#### Video

Videos render inline in the post card with native controls:

- play/pause;
- timeline/scrubbing;
- volume/mute where the browser exposes it;
- fullscreen where supported;
- mobile-native playback behavior.

Videos should not autoplay with sound. This phase does not require transcoding or adaptive bitrate streaming.

### 5. Database change

Create an additive migration that changes the `post_media` MIME constraint to allow the two approved video MIME types while preserving existing image values.

No existing media rows are rewritten.

The migration must use the repo's guarded one-shot migration workflow and be returned to `plan` after a successful staging application.

### 6. S3/infrastructure change

Add only the infrastructure necessary for direct post-media uploads:

- restricted CORS for the media bucket;
- IAM permissions only where the presigned-upload implementation needs them;
- no public bucket policy;
- no broad wildcard permissions beyond the existing post-media object scope.

Infrastructure changes must pass Terraform validation and the repository's AWS guard checks.

## My Profile redesign

Use one clear professional-profile hierarchy instead of the current repeated Passport presentation.

### Page hierarchy

1. Profile header
   - cover photo
   - profile photo
   - name
   - headline / primary professional identity
   - location/status where already supported
   - existing profile actions/edit controls

2. About

3. Maritime Experience
   - rank
   - current vessel
   - sailing experience
   - vessel types
   - trading areas
   - availability
   - shore-career preference
   - existing inline editing remains available

4. Experience

5. Licences & Credentials

### Remove from My Profile

- top eyebrow `Professional identity` if it creates a duplicate page label;
- redundant `My Maritime Passport` introductory framing where the profile header already establishes identity;
- the separate `ProfilePassportOverview` card;
- `Sea N Shore professional identity`;
- `Maritime Passport` duplicate heading from that overview;
- `Professional snapshot`;
- `What a maritime recruiter needs first`;
- decorative Sparkles icon in that overview;
- duplicate snapshot metrics already represented elsewhere;
- bottom `Posts & activity` section;
- the profile-page post query that exists solely for that removed section.

Posts, comments and job applications remain accessible through the dedicated My Activities page.

### Typography and visual consistency

My Profile should use a restrained shared hierarchy:

- one primary profile/name scale;
- one section-heading scale;
- one standard body-text scale;
- one muted/secondary-text scale;
- one consistent card radius, border and background treatment;
- consistent edit-button appearance;
- remove decorative uppercase eyebrow labels where they repeat the heading directly below;
- avoid decorative icons in section headings unless the icon performs or communicates an action.

The goal is a calm professional profile, not a dashboard made of many competing cards.

## Maritime Network cleanup

Keep the existing network title, search and tabs.

Remove this sentence completely:

`Build professional relationships across ships, shore offices, training, recruitment, mentoring, and the wider maritime ecosystem.`

No network-query or connection behavior changes are required.

## Data flow

### New media post

1. User selects a supported image/video.
2. Client performs basic type/size validation.
3. Client requests an authenticated presigned upload target from the application.
4. Server validates the request, generates a scoped object key and returns a short-lived signed upload authorization.
5. Browser uploads directly to private S3 and reports progress.
6. Client submits post data plus the server-issued media reference.
7. Server re-validates ownership/type/reference and creates `posts` + `post_media` transactionally where possible.
8. Feed query resolves the media to a short-lived signed read URL.
9. Post card renders image or video based on MIME type.

## Error handling

- Unsupported format: reject before upload and explain supported formats.
- Oversized video: reject before upload with the 200 MB limit.
- Presign failure: keep composer content intact and show retryable error.
- S3 upload failure: do not create the post; allow retry/remove.
- Post creation failure after upload: attempt object cleanup and keep a clear composer error.
- Expired read URL: rely on normal query/page refresh behavior to obtain a fresh signed URL.
- Browser cannot play a supported video codec inside an MP4/WebM container: show native browser fallback text; no transcoding promise in this phase.

## Testing strategy

Use TDD for implementation.

Focused tests should cover:

- post-media schema accepts approved video MIME types and rejects unsupported types;
- presigned upload authorization validates authentication, MIME type, size and object ownership/scoping;
- composer accepts image/video and surfaces limits;
- publish remains unavailable while upload is incomplete;
- image post cards no longer use fixed 16:9 destructive crop classes;
- portrait/tall media uses full-image rendering behavior;
- video MIME types render a `<video>` player with controls;
- existing image posts continue to render;
- My Profile no longer imports/renders `ProfilePassportOverview` or `ProfilePostsSection`;
- My Profile no longer performs the post query solely used by the removed activity section;
- My Profile retains About, Maritime Experience, Experience and Credentials sections;
- removed profile copy/icons do not appear in the own-profile experience;
- Maritime Network no longer renders the requested descriptive sentence.

Then run the repository's full lint, typecheck, test, Docker, Terraform and AWS guard verification on the exact implementation head.

## Rollout

1. Implement on `feat/aws-native-phase-0-1` only.
2. Do not touch `main`, merge or create a PR.
3. Keep staging deploy, migration and edge-recovery controls at `plan` during normal development.
4. Run exact-head CI before any staging mutation.
5. Apply the additive media MIME migration once through its guarded workflow.
6. Return the migration guard to `plan`.
7. Deploy the application once through the guarded staging workflow.
8. Return the deployment guard to `plan` immediately.
9. Run post-deploy AWS runtime/HTTP and browser verification.
10. Confirm the reset-head CI is green and no accidental second deployment occurred.

## Success criteria

The work is complete when:

- portrait posts are fully visible and no longer cropped into 16:9;
- existing square/landscape images remain visually correct;
- a signed-in user can upload an MP4/WebM video up to 200 MB without routing the file through the Next.js server body;
- uploaded videos play inline in feed post cards;
- private S3 access and signed reads remain intact;
- My Profile has one clear professional hierarchy with the duplicate Passport overview and Posts & activity removed;
- the requested profile labels/decorative icon are gone;
- the requested Maritime Network sentence is gone;
- all focused and full CI checks pass;
- staging is updated once and all one-shot guards are returned to `plan`.
