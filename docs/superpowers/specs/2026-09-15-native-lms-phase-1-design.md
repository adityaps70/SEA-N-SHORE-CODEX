# Native Sea N Shore LMS Phase 1 Design

## Goal

Replace the current link-oriented learning experience with a native Sea N Shore LMS that behaves like a modern Edmingle-style course platform while retaining Sea N Shore branding, AWS-native infrastructure, mentor review workflows, and the existing learning domain.

Phase 1 is final and includes:

- Course → Sections → individual Materials model.
- Native in-app course player.
- Built-in video/audio playback with persistent resume.
- Native rendering/viewing for image, PDF, document/presentation, text/HTML, downloadable resource, external embed, quiz, assignment, and SCORM ZIP materials.
- SCORM 1.2 and SCORM 2004 package support.
- Mentor-configurable course navigation: free navigation or sequential prerequisites.
- Mentor-configurable completion rules per material.
- Mentor-configurable attempt limits per quiz, assignment, and SCORM material.
- Scheduled/drip release per material.
- Progress persistence and learner locking/unlocking.
- Existing mentor/admin approval and marketplace boundaries remain authoritative.

## Existing State

The existing learning domain already has mentors, courses, sections, lessons, enrollments, lesson progress, quizzes, quiz attempts, certificates, course review and an S3 media pipeline. The learner player currently renders a number of external resources as links and models each curriculum entry as a simple lesson row. The mentor editor similarly exposes lesson-type-specific fields rather than first-class material controls.

Phase 1 evolves `learning_lessons` into an Edmingle-style material record without destructive replacement. Existing courses remain compatible and continue to work.

## Product Model

### Course structure

The curriculum hierarchy is:

`Course → Section → Material`

`learning_lessons` remains the physical table in Phase 1 for backwards compatibility, but application terminology becomes **Material**. Each row is one learner activity/content item.

Supported material types:

- `video`
- `audio`
- `image`
- `pdf`
- `presentation_document`
- `article` (shown as Text / HTML in Mentor Studio)
- `external_embed`
- `downloadable_resource`
- `quiz`
- `assignment`
- `scorm`
- `live_session`

Existing material types are preserved and mapped without breaking published courses.

### Course navigation mode

Each course receives a `navigation_mode`:

- `free` — any currently released material may be opened.
- `sequential` — the first material is available; each following material requires the previous required material to be complete, unless a material-specific prerequisite is configured.

Default for existing courses is `free` to avoid surprising current learners.

### Material publication and release

Every material has an independent publish/release state:

- `is_published = false`: mentor draft; never visible to learners.
- `release_mode = immediate`: available as soon as course enrollment permits it.
- `release_mode = scheduled`: available at `release_at`.
- `release_mode = drip`: available at `enrolled_at + drip_delay_days`.

Learner queries must never expose unreleased material body/media URLs to the client.

### Prerequisites

A material may specify `prerequisite_lesson_id` within the same course. In sequential mode, if no explicit prerequisite exists, the previous published material is the prerequisite. A completed prerequisite unlocks the material. Release timing and prerequisite requirements are both required.

The UI shows locked materials in the curriculum with a lock icon and human-readable reason, but opening a locked material is also rejected server-side.

### Completion policies

Each material receives `completion_rule`:

- `manual`
- `view`
- `media_percentage`
- `quiz_pass`
- `assignment_submit`
- `scorm_completion`

Defaults:

- video/audio: `media_percentage`, threshold 90.
- article/image/PDF/document/external/download: `manual` unless mentor selects `view`.
- quiz: `quiz_pass`.
- assignment: `assignment_submit`.
- SCORM: `scorm_completion`.

For media, `completion_threshold` is 1–100 and defaults to 90. Completion is server-authoritative: the client reports progress, but the repository decides whether the material becomes complete.

## Attempts

`max_attempts` is nullable. `NULL` means unlimited. A positive integer limits attempts.

Attempt limits apply to:

- quizzes
- assignments
- SCORM

The server counts persisted attempts and refuses creation/submission once the limit is reached. The learner UI shows `attempts used / limit` and disables new attempts when exhausted. Completed/passed state remains visible.

## Native Player

The learner player becomes a two-pane LMS shell:

- Desktop: sticky curriculum sidebar + primary content workspace.
- Mobile: compact course header + slide/expand curriculum region above content.

The player renders material content inside Sea N Shore:

- Uploaded video/audio: signed S3 URL in native player.
- YouTube/Vimeo/external allowed embeds: sandboxed iframe after URL normalization/allowlist validation.
- Image: responsive in-page image from signed S3 URL.
- PDF: embedded browser PDF viewer with an optional download action only when mentor permits downloads.
- Presentation/document: embedded browser viewer where natively viewable; otherwise an in-page resource card with signed open/download action.
- Text/HTML: sanitized rich content container. Phase 1 stores mentor-authored HTML/text in the existing article field; executable scripts are not allowed.
- Quiz: existing native quiz activity with attempt-limit enforcement.
- Assignment: native instructions + learner submission area + attempt counting. Phase 1 supports text response and one uploaded file per attempt.
- Downloadable resource: in-page resource card; download permission honored.
- SCORM: sandboxed iframe launching an extracted package through a Sea N Shore route, with a JS API adapter communicating to the parent LMS runtime.

The player must never send the learner to an external tab for ordinary course consumption unless the material is explicitly a generic external link that cannot be embedded.

## SCORM Architecture

### Supported standards

- SCORM 1.2
- SCORM 2004 (2nd/3rd/4th edition compatible runtime subset)

### Package ingestion

A mentor uploads a ZIP as a `scorm` material. The system records the uploaded ZIP in S3 and creates a `learning_scorm_packages` row in `processing` state.

A guarded server-side package preparation path:

1. downloads the mentor-owned ZIP;
2. validates size and ZIP structure;
3. rejects path traversal, absolute paths, symlinks and executable server-side payload assumptions;
4. extracts under `learning/<mentor>/<course>/scorm/<material>/<package-version>/...`;
5. locates and parses `imsmanifest.xml`;
6. detects SCORM version;
7. resolves the launch resource;
8. persists manifest metadata and launch path;
9. marks package `ready`.

The extracted package is treated as untrusted web content and launched in a sandboxed iframe. It does not receive AWS credentials or raw S3 access.

### Runtime bridge

The SCORM launch shell exposes:

- SCORM 1.2 `window.API`
- SCORM 2004 `window.API_1484_11`

The adapter implements the common initialization/get/set/commit/terminate calls required by typical packages. Data is persisted server-side through authenticated routes/actions associated with the enrollment/material.

Tracked values include:

- completion/lesson status
- success status
- raw/scaled score where supplied
- location
- suspend data
- session/total time
- exit value
- attempt number

A SCORM attempt completes the material when package status indicates a terminal completion according to the configured completion rule. Passing scores are recorded when the package reports them, but completion and success remain distinct fields.

## Assignment Model

A new assignment definition table stores instructions and optional accepted extensions/max upload size. Each learner submission creates an attempt row containing text response and/or S3 attachment path. Phase 1 considers the material complete on valid submission when `completion_rule = assignment_submit`. Mentor grading workflows can be extended later; Phase 1 preserves submitted attempts for future grading.

## Data Model Changes

A new additive migration extends the learning schema.

### `learning_courses`

Add:

- `navigation_mode text not null default 'free'`

Constraint: `free | sequential`.

### `learning_lessons`

Add:

- new material types: `image`, `external_embed`, `scorm`
- `is_published boolean not null default true`
- `release_mode text not null default 'immediate'`
- `release_at timestamptz`
- `drip_delay_days integer`
- `prerequisite_lesson_id uuid references learning_lessons(id) on delete set null`
- `completion_rule text`
- `completion_threshold integer`
- `max_attempts integer`
- `embed_kind text`

Checks guarantee release fields match the selected release mode, max attempts are positive, thresholds are 1–100, and completion-rule values are recognized.

### `learning_progress`

Add:

- `viewed_at timestamptz`
- `media_percent integer not null default 0`
- `attempts_used integer not null default 0`

Quiz/assignment/SCORM attempt tables remain the source of truth for attempt history; `attempts_used` is a convenient projection updated transactionally by repository operations.

### SCORM tables

`learning_scorm_packages`

- one current package record per SCORM lesson
- source ZIP path
- extracted prefix
- manifest path
- launch path
- SCORM version
- processing status/error
- manifest metadata JSON

`learning_scorm_attempts`

- enrollment/material/learner association
- attempt number
- status/success/score
- location/suspend data
- session and total time
- initialized/completed timestamps

### Assignment tables

`learning_assignments`

- one definition per assignment material
- instructions
- accepted extensions
- max upload bytes

`learning_assignment_attempts`

- enrollment/material/learner
- attempt number
- response text
- attachment path
- submitted timestamp

## Mentor Studio

Mentor Studio changes from “lesson editor” language to **Curriculum / Materials** while retaining existing route structure.

A section has an `Add material` action. Material cards expose:

- title and material type
- upload/embed/body fields appropriate to type
- publish toggle
- learner preview toggle
- download toggle when applicable
- release: immediate / scheduled / drip
- prerequisite selector
- completion rule and threshold when applicable
- max attempts for quiz/assignment/SCORM
- duration

SCORM material authoring requires ZIP upload and displays package processing/ready/error state. A course cannot be submitted for admin review if a published SCORM material is not `ready`.

## Learner Availability Evaluation

Availability is determined on the server from:

1. enrollment status;
2. course published state and approved active mentor;
3. material `is_published`;
4. release rule/time;
5. course navigation mode;
6. explicit/implicit prerequisite completion.

The repository returns a safe curriculum projection containing available/locked state and lock reason. It does not return protected content fields for locked/unreleased materials.

## Backwards Compatibility

- Existing published lessons default to `is_published = true` and immediate release.
- Existing courses default to free navigation.
- Existing video/audio progress is retained.
- Existing quiz definitions/attempts remain valid.
- Existing SIRE course remains in its current review status unless an admin changes it.
- No direct database publication shortcuts are introduced.

## Security

- All writes require the authenticated Sea N Shore user and server-side ownership/enrollment checks.
- Signed S3 URLs are issued only after authorization and material availability checks.
- External embeds use a constrained allowlist for recognized providers; arbitrary URLs are rendered as links rather than trusted iframes.
- HTML/text material is sanitized before rendering; scripts and unsafe event attributes are not executed.
- SCORM packages are untrusted and always sandboxed.
- ZIP extraction rejects zip-slip paths, absolute paths and suspicious entries; package size and extracted-file limits are enforced.
- SCORM runtime updates are scoped to the active learner, enrollment, material and current attempt.

## Testing Strategy

All production behavior follows RED → GREEN TDD.

Required automated coverage:

- migration/schema contract
- release policy evaluation
- prerequisite/sequential locking
- completion-rule evaluation
- media percentage completion
- quiz attempt exhaustion
- assignment attempt exhaustion/submission completion
- SCORM runtime normalization and completion
- repository content redaction for locked materials
- Mentor Studio material settings
- learner player inline rendering for supported material types
- route/action authorization
- regression coverage for existing videos, articles, quizzes and certificates

The exact branch head must pass the full `AWS Infrastructure CI` six-job gate before any staging write or deployment.

## Staging Migration and Deployment

The schema change uses a dedicated commit-driven one-shot migration guard, following the repository’s existing AWS migration discipline:

1. migration guard is `plan` by default;
2. exact-head Infrastructure CI must pass;
3. arm `migrate-once` on an exact commit;
4. GitHub OIDC assumes staging role in account `310356785722`;
5. migration runs through the bootstrap/SSM path;
6. verify schema markers;
7. immediately restore guard to `plan`;
8. run exact-head CI again;
9. arm normal staging deploy guard only after migration is proven;
10. deploy the exact application commit;
11. verify ECS image/task/runtime and HTTP health;
12. restore deploy guard to `plan` and run final exact-head verification.

No writes use account `992382634586`.

## Out of Scope for Phase 1

- Paid checkout/payment gateway.
- Mentor assignment grading/rubrics beyond submission capture.
- Discussion forums per lesson.
- Full cohort scheduling/attendance engine.
- Advanced xAPI/cmi5.
- SCORM authoring; Sea N Shore consumes packages only.
- Replacing the existing admin course approval workflow.
