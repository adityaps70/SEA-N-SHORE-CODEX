# Learning round E: LMS UI/UX and typography

The owner audited the live LMS on 11 October (desktop Chrome, signed in as the trainer/learner account). This round is
front end only. No database change is expected; if one turns out to be needed, work stops and the owner is asked.

Delivery: PR 1 = E1 + E2 + E4 + E5 (renderer) + E8. PR 2 = E3 + E6 + E7 + E9 + E10. One deploy. The SIRE article
conversion (E5) runs after the deploy and only creates a draft revision.

## Step 0: findings checked against the code (HEAD `4cd63d24`)

| # | Finding | Verdict | Evidence and notes |
| --- | --- | --- | --- |
| E1 | Curriculum always fully expanded | Still true | Built inline in the player page (`learn/page.tsx` L124-171). No accordion or collapse state. The same list feeds the phone sheet. |
| E1 | Sticky sidebar does nothing | Still true, and worse | `lg:sticky lg:top-6` with no max-height or overflow (L265). The fixed app header is 72 px, so `top-6` would also slide under it. At 768-1023 px the whole curriculum stacks above the lesson. |
| E1 | Phone "Curriculum n/N" | Mostly fixed | Opens a BottomSheet (`role=dialog`, `aria-modal`, Escape, focus return, closes on choose). Missing: a Tab focus trap. |
| E1 | Lock icons labelled | Partly fixed | In the player the row text says "· Locked". On the public page it is an `aria-label` on an svg without `role=img` (unreliable). |
| E1 | "What's inside" is one long list | Still true | `CourseCurriculum` in the public course page L255-308. Grouped by module but always fully expanded. |
| E2 | Everything is Inter | Worse than stated | Inter is never loaded. `globals.css:70` names it, but there is no `next/font` and no `@font-face`, so LMS pages render in the system font unless Inter is installed locally. There is no font token in `@theme`. Only the landing page loads Google Fonts (`<link>`). |
| E2 | Card section titles 14-16 px | Partly true | Most LMS h2-h4 are 18-24 px. Small ones: the player "Course curriculum" (14 px), quiz headings (16 px), and some Studio panels and the public module title (14 px). |
| E2 | Sidebar module titles 12 px uppercase grey, lesson rows 14 px | Still true | `learn/page.tsx:131` `text-xs font-semibold uppercase tracking-[0.16em] text-slate-500`. |
| E2 | Eyebrows everywhere | Still true | 92 `uppercase tracking` lines in 39 LMS files. "Quiz ·" was not found. |
| E2 | Muted text contrast | Partly true | `--muted #607481`: 4.87:1 on white and 4.64 on mist-50, but **4.38 on mist-100 (fails AA)**. |
| E2 | Dark mode | Not supported | No `dark:` classes and no theme switch. Dark checks are not applicable this round. |
| E3 | Native controls, Download in the menu | Still true | `resumable-lesson-media.tsx` uses `controls` with no `controlsList` or `disableRemotePlayback`. Round A speed (0.75-2×), PiP, transcript and the seek cap (furthest + 5 s) already exist around the native bar. |
| E3 | Presigned MP4 valid for 2 h, no inline disposition | Still true | `storage.ts` `createMediaReadUrl`: windowed signing with 7200 s, no `ResponseContentDisposition`. |
| E3 | No captions | Captions are supported | `<track>` comes from `learning_lessons.caption_path`, served same-origin by `/api/learn/captions/[lessonId]`, with a transcript panel. The SIRE videos simply have no `.vtt`. |
| E3 | Two trailer `<video>` on the course page | Still true | Public course page L178 (phone) and L413 (desktop), one hidden by CSS. Both load metadata. |
| E3 | Resume position | Storage exists | `learning_progress.last_position_seconds`, `furthest_position_seconds` and `watched_seconds`, saved every 15 s. **No migration needed.** |
| E3 | Member ID for the watermark | Does not exist | Profiles have only a UUID and a username slug. Plan: show a short code derived from the profile UUID (`SNS-` + 8 hex), with no name, email or username. No DB change. |
| E4 | Focus row, full-width header, then tabs | Still true | `player-focus-mode.tsx:46`, header card `learn/page.tsx:196-222`, tabs inside the lesson column. |
| E4 | Footer and Messaging in the player | Messaging already fixed; footer still true | The dock hides on `/learn/courses/*/learn` (`messaging-dock.tsx:42`). `AppFooter` has no route exclusion. The layout also nests `<main>` inside `<main>`. |
| E4 | Tab title "Sea N Shore" | Still true | The player has no `generateMetadata`. |
| E4 | "Open navigation is enabled." | Still true | `learn/page.tsx:269`. |
| E4 | Completed + "Continue to next" + "Next material", no Previous | Still true (Previous exists on desktop only) | `material-player.tsx:263-288` plus the `learn/page.tsx:308-326` lesson nav. Gate: the Round A completion rules on the server. |
| E4 | Focus mode | Hides only the header card and the sidebar | It does not hide the app header, the footer or the banners. Desktop only. |
| E5 | Plain articles in pre-wrap at 15/32 | Still true | `material-player.tsx:93-95`. HTML articles (`article_format='html'`) render through `.lesson-article`, also at 15/32. |
| E5 | About 110 characters per line | Still true | There is no max-width: about 806 px, and about 1150 px in Focus mode. |
| E5 | No reading time or progress | Still true | |
| E5 | Draft revision flow (A1) | Exists, with no programmatic entry | `startRevision(actorId, liveCourseId)` copies the course into a draft revision. Approval updates live rows in place, so **material IDs are stable**. The "diff" is only a list of changed field names on the admin queue. There is no text diff and no link for it. |
| E5 | Sanitiser | Exists | The allowlist has h2/h3/h4, lists, tables, blockquote and img (storage-path images only). It has no `figure` or `figcaption`. |
| E6 | One long page, no navigator or flag | Still true | `quiz-lesson-activity.tsx:674`. Server grading, autosave and sessions come from Round B. |
| E6 | "Times shown in UTC" | Still true | `quiz-lesson-activity.tsx:101-119`. The Round D helper `formatZonedTime` / `LocalSessionTime` exists but is not used here. |
| E6 | Options in fixed order | Settings exist | `learning_quizzes.shuffle_options` (off by default), applied per session. The list of SIRE quizzes with it off needs a production read. |
| E6 | Feedback after submit | Exists | `answer_policy` is one of never / after_each_attempt / after_pass / after_last_attempt, and the server withholds answers until the policy allows. |
| E7 | No filters; archived courses mixed in | Still true | The query includes archived and removed courses (for access) but does not return the status. Sorted by `enrollment.updated_at`. |
| E7 | `/learn/my` gives 404 | Still true | There is no route or redirect. |
| E8 | Chips cover the thumbnail text | Still true | Catalogue `CourseCard` (`(public)/learn/page.tsx:83-175`) overlays the category and price chips on the image. |
| E8 | Thumbnail guide in Studio | Missing | Only "JPEG, PNG, or WebP, 5 MB". |
| E9 | "← Trainer verification" link on Studio home | Still true on desktop | `studio/page.tsx:208`. |
| E9 | 7 mixed toolbar buttons that wrap | Still true | `studio/page.tsx:212-252`. |
| E9 | "recorded" in lowercase | Still true | `studio/page.tsx:79` (`replace('_',' ')`). |
| E9 | Archived courses mixed in, no status tabs | Still true | `listOwnedCourses` returns every status. Statuses: draft, submitted, changes_requested, approved, published, archived. |
| E9 | Editor is one long page | Still true | Details, media, pricing, certificate, curriculum, submit, announcements, community. No section nav. |
| E9 | Read-only shows "View course" under the "Edit course" tab title; thumbnail buttons visible | Still true | Static `metadata.title`. `LearningMediaUploadField` has no read-only mode; it is only disabled through the fieldset. |
| E9 | Collapsible modules and drag-and-drop | Neither exists | Up and down arrow buttons only (one server call each). |
| E9 | Save bar | Partly fixed | `CourseEditSession` has an unsaved-changes guard and dialog, but the sticky save bar covers course details only. Pricing, certificate and community changes are not tracked. |
| E10 | Skeletons | None for LMS | There is no Skeleton component. The only `loading.tsx` is for events. |
| E10 | Reduced motion | Handled globally | `globals.css:135`. |
| E10 | Focus rings | Weak | Global 1 px teal-500 outline (2.92:1, below 3:1). Overrides are mixed. |

Test courses: no seed creates placeholder titles. Candidates are leftovers from the E2E fixture ("E2E Learning Review
Course N") and anything an admin or trainer test account made. Production has to be read to list them. That read is
done by the round's read-only runner (below), and the output shows titles and slugs only.

## Decisions

- **Watermark ID**: there is no member ID, so the watermark uses `SNS-` plus the first 8 hex characters of the
  learner's profile UUID, and the date. It shows no name, email or username.
- **Fonts**: both faces are loaded through `next/font`, which self-hosts them. Inter is used for body and UI
  (`--font-sans`), and Plus Jakarta Sans 600/700 for headings (`--font-heading`). One variable swaps the heading face.
- **Dark mode**: not supported by the app, so the light theme only.
- **E5 conversion, the shuffle list and the test-course list**: these need a read of production, and the conversion
  also writes a draft revision. They run as one new guarded runner (`learning-round-e-content`). Its plan action is
  read only and prints the shuffle-off quizzes, the test-course candidates and a dry-run of the conversion. Its
  apply-once action creates the draft revision as the course's trainer. Nothing is published.
- **Revision diff link**: there is no text diff today. PR 2 adds a read-only page that compares a draft revision with
  the live course, material by material, so the owner can review the converted articles before submitting them.

## Checklist

- [x] Step 0 report
- [x] PR 1: E1 accordion curriculum (player, phone sheet, public "What's inside"), rail collapse, own scroll
- [x] PR 1: E2 fonts, type scale, sidebar titles, eyebrow cleanup (player, course page, catalogue; the rest in PR 2), muted contrast
- [x] PR 1: E4 player layout, footer hidden, one Previous / Complete & next bar, tab title, wording
- [x] PR 1: E5 article typography, reading time and progress
- [x] PR 1: E8 card chips and thumbnail guide
- [x] PR 2: E3 custom video controls, no download, 20-minute URLs with refresh, watermark, resume prompt, keys, one trailer
- [x] PR 2: E6 quiz navigator, local times, scroll to result
- [x] PR 2: E7 My Learning filters, `/learn/my` redirect
- [x] PR 2: E9 editor section nav, read-only view, Studio home tidy-up, status tabs
- [x] PR 2: E10 skeletons, focus rings, 390 px pass
- [x] PR 2: revision diff page and the `learning-round-e-content` runner (plan / apply-once)
- [x] Deploy, rearm, Remote Verify (run 38167020632; the second deploy, run 38170527805, carried the #217 slug fix)
- [x] Runner plan on the live course (run 38171703705): 9/9 quizzes have shuffle off; 1 test-course candidate;
  9 plain articles, all with the same words, but 8 refused (see the converter fix below)
- [x] Converter fix (#219) deployed (run 38265865402, web :252); plan re-run 38267963937: 9/9 articles safe
- [x] Apply-once (arm #221, run 38268921997): SIRE draft revision d0046d0b-2edd-48b7-9f94-cf5d1dc63e97 with 9
  converted articles, for the owner to review at
  https://seanshore.in/learn/studio/courses/d0046d0b-2edd-48b7-9f94-cf5d1dc63e97/changes (nothing submitted)
- [x] Content guard rearmed to plan; report sent

## PR 1 notes

- **Fonts**: Inter (body and UI) and Plus Jakarta Sans 600/700 (headings) come through `next/font/google`, which
  downloads them at build time and serves them from our origin. `--font-heading` in `globals.css` (from
  `headingFont` in `src/app/layout.tsx`) is the one place to swap the heading face. Learning pages opt in through
  the `lms` class on the `/learn` layouts.
- **Type scale tokens** (Tailwind): `text-page-title` 32/40, `text-section-title` 22/30, `text-card-title` 17/26,
  `text-body` 16/26, `text-article` 17/30, `text-meta` 13/20, `text-eyebrow` 12/16.
- **Muted text**: `#566a77` (was `#607481`). It reaches 4.5:1 or better on white, mist-50, mist-100 and mist-200.
- **Article styling**: hand-tuned `.lesson-article` rules instead of `@tailwindcss/typography`. They need no new
  dependency and the editor and admin review share them. Learners get a 68ch measure.
- **Completion signal**: the playback save now returns `completed`. The player announces it on the page and
  refreshes once, so "Complete & next" unlocks the moment a video crosses its threshold. Quizzes, assignments and
  "view" lessons already revalidate the page when they complete.
- **Local checks**: a local Postgres 16 with every migration, a fixture course shaped like the live SIRE course
  (9 modules, 37 items, fixture names only), and a Cognito GetUser stub outside the repository. Screenshots are in
  `docs/superpowers/plans/round-e/`.

## PR 2 notes

- **E3 video**: our own control bar (play, seek, time, volume and mute, speed 0.75-2×, captions, picture in picture,
  full screen) over a `<video>` with no `controls`, `controlsList="nodownload noremoteplayback"`,
  `disableRemotePlayback` and no context menu. Audio, previews and the trailer get `nodownload` too.
  - The refresh action uses no platform-admin authority (Round 15: such server actions must be MFA-gated), so an
    administrator viewing through admin access without being on the course team reloads the page after 20 minutes.
  - Lesson video and audio are signed for 20 minutes with `ResponseContentDisposition=inline`
    (`createLessonMediaUrl`). The player asks `refreshLessonMediaUrl` for a fresh URL 3 minutes before expiry, or
    after a playback error, and continues from the same second (playing if it was playing). The refresh runs the
    same access checks as the player.
  - Watermark: `SNS-` + 8 hex of the profile id and today's date, faint (25% white), drifting across the frame over
    90 seconds; static with reduced motion. Never a name, email or username.
  - Resume: a saved position of 5 s or more (and not the last 5 s) offers "Resume from m:ss" or "Start over".
  - Keys on the focused player: Space/K, J/L (±10 s), M, F, C, and ? for the list. The Round A seek cap is kept.
  - One trailer `<video>`: the course page renders it only in the slot that matches the screen.
  - Honest limit: hiding the button stops casual downloads only. Anyone can still save the file with developer tools
    while the URL is valid, or record the screen. The 20-minute URL and the watermark make that slower and traceable,
    not impossible.
- **E6 quiz**: one question at a time with a navigator (answered, unanswered, flagged), "Question N of M", Flag for
  review, and a "Before you submit" check listing unanswered and flagged questions. Grading, autosave and timers stay
  on the server as before. Attempt times show in the learner's zone with the zone named. The result is scrolled to
  and focused, and a pass unlocks the bottom bar at once.
- **E7 My Learning**: chips All / In progress / Completed / Archived (archived only when there is one). Under All,
  archived courses sit in a collapsed group with an "Archived" badge. Sorted by last activity (latest lesson progress
  or enrolment change). `/learn/my` is a 301 to `/learn/my-learning` (`next.config.ts`).
- **E9 Studio and editor**: Studio home loses the stray back link; the seven buttons become one "Tools" menu next
  to the primary "Create course"; "Recorded" and levels are capitalised; status tabs Live / Drafts / In review
  (submitted and approved) / Archived. The editor gets a sticky step nav (Details, Media, Pricing, Certificate,
  Curriculum, Learners & announcements, Community) with ✓ or "needs attention", and one sticky "Unsaved changes ·
  Save draft" bar that saves every editor (details, curriculum edits, pricing plans and certificate settings, which
  are now tracked too). Curriculum sections collapse (the first starts open) and sections and materials can be
  dragged into place within their section (a new reorder action; arrow buttons stay for keyboards and phones). The
  read-only view shows no edit, move, delete or upload controls, and the tab title matches the heading.
- **E10**: LMS loading skeletons (catalogue, course page, player, My Learning, Studio, editor) that pulse only when
  motion is welcome; on learning pages a 2px ocean-600 focus outline (5.3:1, was 1px teal-500 at 2.9:1) and a
  visible ring on text fields (the rest of the site keeps its pinned focus style); the remaining redundant eyebrows on
  these screens are gone.
- **Draft changes page** (`/learn/studio/courses/<draft id>/changes`): for the course team and platform
  administrators. Each changed material shows a word-by-word diff, a "Same words. Only the layout and heading
  capitals change." check, and the live and draft versions side by side.
- **`learning-round-e-content` runner**: the task is bundled into the image (`dist/workers/learning-round-e-content.mjs`)
  and started once as an ECS task with the web task definition, overriding only its command and two variables.
  `plan` reads only; `apply-once` opens the SIRE draft revision as its trainer through the Round A1 code and
  converts the plain-text articles in that draft only (refusing any article whose words would change). Nothing is
  submitted, published or deleted, and an already open draft is left alone. A push-triggered plan waits for a
  deployed image that contains the worker.
- **Converter fix after the live plan**: the plan refused 8 of 9 SIRE articles. Every one had the same words; the
  refusal came from the "sanitiser leaves it unchanged" check, because the converter wrote `"` as `&quot;` and the
  sanitiser writes a plain `"` (the one article without double quotes passed). Text is now escaped exactly as the
  sanitiser writes it (`&`, `<`, `>`). The same run showed heading-case slips, now fixed: "Why IT Had to Change"
  (IT, US, CO, CE and CAP are no longer treated as acronyms), "Pifs" and "Capa" (acronym plurals and CAPA, PIF,
  CVIQ added), "14-DAY" (digits keep only their own hyphen part), and a small word after a colon or dash ("Drill: the
  Three-Lens") now starts the subtitle with a capital.

