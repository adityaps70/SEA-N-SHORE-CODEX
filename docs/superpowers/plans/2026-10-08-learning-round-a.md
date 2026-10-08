# Learning round A: make what we have work

Started 8 October 2026 from feature head `f4c7ecfc` (after #151 and #152). Rounds B, C and D are separate.

Ship plan: PR 1 = A1 + A2 + the round's migration; PR 2 = A3 + A4 + A5; PR 3 = A6 + A7. Then one guarded
migration run (0069–0070) and one deploy for all three. Owner merges every arm PR.

## Step 0 findings (verified against the code on 8 October)

| Item | Status before this round |
|---|---|
| A1 edit after publishing | Broken: published courses read-only; no revisions; quiz re-save deleted and re-created questions; archive one-way and locked out enrolled learners |
| A2 assignment uploads | Broken: written answers only, "a later media slice" shown to learners; points and pass mark stored but not editable |
| A3 public pages | Broken: /learn and course pages sign-in only; trailer and free-preview flag stored but unused; no sitemap, Open Graph or JSON-LD |
| A4 rich text | Broken: plain textarea, pre-wrapped text, no sanitizer |
| A5 quiz attempts | Broken: no "attempts left", "Try again" shown at the limit, generic error |
| A6 notifications | Broken: no learning notifications, no notification settings, no digest scheduler |
| A7 player polish | Partly done: lock icons and type labels exist; big header, no section %, no Complete & Next, no speed/PiP/captions/transcript; Edmingle copy and free-text currency remain |

SIRE 2.0 quiz: the seed has no quiz; the attempt limit lives only in Aurora. The round A migration's plan run
prints it (`SIRE_QUIZ ...` and `SIRE_ATTEMPT_WORDING ...` lines).

Quality switching: skipped. Only the original MP4/WebM upload is stored; there are no renditions.

## Migration (one guarded runner for the round)

- [x] `0069_learning_round_a_notification_types.sql`: learning notification types (own file: enum values)
- [x] `0070_learning_round_a.sql`: revisions, soft delete, attachments, max files, 20 MB default for new
      assignments, captions, watched time, article format, email preferences, email queue, release notices
- [x] `aws-learning-round-a-migration.yml` + `learning-round-a-migration.sh` + guard (plan) + contract test
- [x] Applies cleanly to every earlier migration in PGlite (`src/lib/db/test-database.ts`)
- [ ] Plan run on the merged head (reports SIRE quiz setting)
- [ ] Arm PR (owner merges and approves), migrate-once, rearm to plan

## PR 1: A1 + A2

A1 — edit a published course
- [x] Draft revision: a private copy of the published course, edited with the normal editor
- [x] Learners keep the live course while the trainer edits
- [x] Submit through the existing review; the reviewer sees every change compared with the live course
- [x] Approval applies the revision in place: lesson, section, question and option ids never change
- [x] Changes requested: the revision goes back to the trainer; the trainer can also discard it
- [x] Removed materials are retired (hidden, unpublished, history kept), never deleted
- [x] Quiz saves keep question and option ids (attempts survive)
- [x] New materials follow the course's drip and sequence rules (same rules as every material)
- [x] Learners whose only unfinished material was removed complete the course and get the certificate
- [x] Certificates are never revoked; price changes affect new purchases only; the live slug never changes
- [x] Archive: off the catalogue, closed to new learners, enrolled learners keep full access; admins can unarchive
- [x] Tests on real SQL: 10 learners' % before and after, removed material completion, every diff field
- [x] Media saved in a revision (or by a second manager) is accepted when the course already uses it

A2 — assignment file uploads
- [x] Presigned upload under `learning-submissions/<enrollment>/<lesson>/<submission>/`
- [x] Server checks: type allow-list and assignment extensions, size limit, stored type and size, file signature
- [x] Up to the assignment's file count (default 5; 20 MB default for new assignments)
- [x] Downloads via an access-checked route and five-minute URLs: learner, course trainers, platform admins only
- [x] Points and pass mark editable; learners see the grade and pass/fail
- [x] Developer text removed
- [x] Tests: wrong type and oversized refused; another learner can't download; the mentor and admins can

## PR 2: A3 + A4 + A5
- [ ] A3 public catalogue and course pages, free preview, trailer, SEO
- [ ] A4 rich-text lessons with server-side sanitizing
- [ ] A5 quiz attempts left and limit messages

## PR 3: A6 + A7
- [ ] A6 learning notifications (email + in-app, digests, Learning settings, unsubscribe)
- [ ] A7 learner player polish and Studio copy fixes

## Release
- [ ] One guarded migration, one deploy, rearm, Remote Verify green
- [ ] Checks on seanshore.in
