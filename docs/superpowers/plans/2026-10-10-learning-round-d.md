# Learning round D: batches, live sessions and company training

Started 10 October 2026 from feature head `f13dfe04` (after round C and C4 were released: web :243, outbox :125,
notification :124, every guard at plan).

Ship plan: PR 1 = D1 batches + the round's migrations (0077–0078, which also hold the D2 schema); PR 2 = D2 live
sessions. Then one guarded migration run and one deploy. D3 (company training) is a design for the owner; nothing is
built until the owner approves it. Owner merges every arm PR.

## Step 0 findings (verified against the code on 10 October)

| Area | Before this round |
|---|---|
| Live sessions | `live_session` is a lesson type (0019) with only an `external_url`; no start time, no attendance, and it cannot be published ("cannot be published until native attendance completion is connected"). The player shows a "Join live session" link. `course_format = 'live_cohort'` is a label with no behaviour. |
| Batches | None. Enrolment is one row per learner and course (`learning_enrollments`), drip is `enrolled_at + drip_delay_days` (`evaluateMaterialAvailability`, repeated inline in four SQL queries). The roster has no filters. |
| Who runs a course | `courseManagerAccessSql`: the course's active mentor, or an approved company member with role owner, administrator or lms_manager; platform admins see everything. No co-instructor table. |
| Companies | One table, `public.companies` (Jobs, course publisher, events, payouts, promo codes all use it), with `company_members` roles owner/administrator/recruiter/member plus lms_manager/event_manager/content_manager/analyst; capabilities need a verified, claimed company. Crew data: `maritime_profiles.rank/current_vessel` (free text), structured rank on `profiles.role_key`, sea service in `profile_experiences`, STCW and other certificates in `profile_credentials`. No seats, bulk buying, employer consent or company CSV export. |
| Scheduled jobs | No EventBridge schedules and no scheduled GitHub workflows. Every periodic job is a timed sweep in `scripts/workers/publish-outbox.ts` (learning emails every minute, digests hourly, invitations, tax documents, newsletter, billing, retention). The learning email queue (`learning_notification_emails`) delays sends with `next_attempt_at`, skips rows older than 72 h, and honours the Learning email opt-out. |
| Calendar and time zones | Only events have an `.ics` route (hand-built, UID domain `seaandshore.in`). Profiles have no time zone; learning pages format dates in `Asia/Kolkata` or UTC. |

Owner decisions (10 October):
- The migration may relax exactly one check: the Learning email kind also allows 'session_reminder'.

Decisions made while building:
- The attendance rule counts every scheduled session of the batch, future ones included, so a certificate waits until
  enough sessions have actually been attended; excused sessions are left out; a learner who used Join counts as present
  until a trainer marks otherwise; a batch with no sessions never holds a certificate back.
- The 24-hour reminder goes out from 24 hours to 1 hour before the start (so a late joiner still gets one); the 1-hour
  reminder in the last hour. The sweep runs every 5 minutes; the learning email worker sends within a minute.
- Recordings up to 2 GB (MP4 or WebM), private, opened through a short-lived signed link; or a pasted https link.
- PR 1 (D1 + migrations) is #191, merged as bca7b803.

## Migrations (one guarded runner for the round, from the template)

- `0077_learning_round_d_notification_types.sql`: enum value `learning_session_reminder` (its own file: a new enum
  value cannot be used in the transaction that adds it).
- `0078_learning_round_d.sql`:
  - `profiles.time_zone` (IANA name or null) and `time_zone_source` ('auto' | 'manual', default 'auto').
  - `learning_courses.batch_mode` ('self_paced' default | 'batches'), `drip_anchor` ('enrolment' default |
    'batch_start'), `min_attendance_percent` (null = no rule, else 1–100).
  - `learning_course_batches` (title, starts_at, ends_at, seat_limit, time_zone, manager_profile_id, status
    upcoming/running/completed/archived, enrolment_open) and `learning_batch_instructors`.
  - `batch_id` on `learning_enrollments`, `course_payment_orders` and `learning_course_invitations`.
  - `learning_session_series` (weekly rule: weekdays 1=Mon…7=Sun, local_time, time_zone, duration, first_date,
    week_count), `learning_batch_sessions` (UTC starts_at, duration, meeting_url, scheduled/cancelled, recording
    link or upload), `learning_session_attendance` (join times and count, present/absent/excused mark).
  - The Learning email kind check widened with 'session_reminder'.
- Runner `learning-round-d-migration` (template), post-apply checks: 5 tables, 8 columns, the enum value, the
  widened kind check, every existing course still self-paced.

## Design

### Access
- Course managers (as today) run everything for every batch of their course.
- A batch's manager and instructors can, for that batch only: see its learners, manage its sessions, take
  attendance and attach recordings. They do not edit the course, prices or other batches.
- Learners see a batch's sessions and recordings only while their enrolment in that batch is active (access open).
- Attendance and seat data: course managers, that batch's manager and instructors, and platform admins only.
  (D3 adds the buying company's admins.)

### D1 batches
- A course switches to batches on its Batches page in Studio (`/learn/studio/courses/[courseId]/batches`). These
  are live settings on the live course (like pricing plans); a draft revision never copies or changes them.
- A batch is open for enrolment when `enrolment_open`, its status is upcoming or running, and seats are left.
  Seats taken = active or completed enrolments in the batch + checkout orders for it still awaiting payment that
  were created in the last 30 minutes. A paid order always enrols (never refuse money already taken), even if that
  goes over the limit; the batch page shows the count.
- Status: set by the manager; the sweep moves upcoming → running at `starts_at` and running → completed after
  `ends_at` (or 1 day after the last session when there is no end date). Archived batches are hidden from learners
  and closed to enrolment.
- Buying/enrolling: on a batch course the learner picks a batch on the course page (start date in their time zone,
  seats left); free enrolment, checkout, trainer enrol-by-email and invitations all carry the batch. Moving a
  learner to another batch is a manager action (audited). A learner is in at most one batch per course (one
  enrolment row, as today).
- Drip: with `drip_anchor = 'batch_start'`, a drip lesson opens `drip_delay_days` after the learner's batch
  `starts_at`; learners without a batch (or self-paced courses) keep `enrolled_at`. One shared helper is used by the
  TypeScript policy and all four SQL copies.
- Roster: a batch filter (server-side, also on the CSV export) and a Batch column.

### D2 live sessions
- Sessions belong to a batch. One-off: title, start (date + time in a chosen time zone, stored UTC), duration,
  meeting link (https only; Zoom, Meet, Teams or any https link pasted by the trainer). Recurring: weekdays, time,
  time zone, first date and number of weeks (max 52, max 100 sessions per series) create the individual sessions;
  each can then be edited or cancelled on its own. DST-correct conversion per occurrence.
- Learners: "Upcoming sessions" in the player (a Sessions tab: date, attended/absent/excused, recording) and on My
  Learning (next sessions across courses). Every time shows the zone clearly, e.g. "Mon 13 Oct, 19:00 IST
  (Asia/Kolkata)". Pages render in the browser's time zone; emails use the member's stored time zone, else
  Asia/Kolkata, and always add UTC.
- Member time zone: Settings → Notifications (or account) has "Time zone for emails: Automatic (this device) /
  choose". In automatic mode the app stores the device zone when it changes.
- Add to calendar: `.ics` per session and per batch (all sessions), shared helper in `src/lib/calendar/ics.ts`, UID
  `@seanshore.in`.
- Reminders: a sweep every 5 minutes in the outbox worker enqueues `session_reminder` learning notifications 24 h
  and 1 h before each scheduled session for each learner with open access, dedupe key
  `learning_session_reminder:{sessionId}:{learnerId}:{24h|1h}`; the 24 h one is skipped when the session is less
  than 1 h away. Learning category, so the opt-out applies.
- Join: `/learn/sessions/[sessionId]/join` checks access, records first/last join time and count (from 15 minutes
  before start until the end), then redirects to the meeting link.
- Attendance: after a session starts, the trainer marks present/absent/excused per learner (bulk "mark all who
  joined as present"). Attendance % = present ÷ (ended, not cancelled sessions − excused). An unmarked learner who
  joined counts as present; unmarked and not joined counts as absent.
- Certificate rule: when `min_attendance_percent` is set and the learner is in a batch, the certificate waits until
  the rule is met (completion or final-quiz trigger as today); marking attendance re-checks and issues it then. The
  learner sees "Attend at least N% of live sessions (now M%)".
- Recordings: link or upload (video, private, signed URL for allowed viewers), shown under the session and in the
  batch's recordings list.

## Checklist

- [x] Step 0 findings
- [x] Migrations 0077–0078 + guarded runner `learning-round-d-migration` from the template
- [x] D1 batches: settings, Studio batches page, managers and instructors, batch status sweep
- [x] D1 enrol/buy into a batch (course page, free enrolment, checkout, trainer enrol, invitations), seat limit
- [x] D1 drip from batch start (shared helper, TS and SQL)
- [x] D1 roster batch filter and CSV
- [x] D2 session calendar: one-off and recurring, edit/cancel, meeting links
- [x] D2 member time zone and clear zone display
- [x] D2 Upcoming sessions (player Sessions tab, My Learning) and .ics
- [x] D2 reminder emails 24 h and 1 h before
- [x] D2 Join tracking, attendance marking, minimum attendance for the certificate
- [x] D2 recordings (link or upload)
- [x] Zoom/Meet automatic link creation: note for the owner (not built)
- [x] D3 design sent to the owner (not built until approved)
- [x] PR 1 (D1 + migrations), PR 2 (D2), one guarded migration, one deploy, rearm, Remote Verify
- [x] Signed-out live checks on seanshore.in and report
- [ ] Signed-in live checks on seanshore.in (owner; script below)

## Release (10 October)

| Step | Result |
| --- | --- |
| PR 1, D1 batches + migrations 0077–0078 | #191, merged as `bca7b803` |
| Migration plan | run 38066123596: both files ADDITIVE (1 and 22 statements), both pending, PLAN_VERIFIED, PLAN_ONLY_NO_APPLY |
| PR 2, D2 live sessions | #192, merged as `74167b33` |
| Migration arm (owner merged) | #193, `migrate-once 74167b33` |
| Migration apply | run 38069239021: 0077 and 0078 APPLIED, `tables=5 columns=8 reminder_type=1`, APPLY_VERIFIED=true |
| Migration rearm | `b1ac9ae2` (guard back to `plan`) |
| Deploy arm (owner merged) | #194, `deploy-once b1ac9ae2` |
| Deploy | run 38070723870: web `:243 → :244`, outbox worker `:125 → :126`, notification worker `:124 → :125` |
| Deploy rearm | `8f7ac7f4` (guard back to `plan`) |
| Post-deploy checks | Remote Verify 38071669436, Google auth 38071671401, logo 38071673721: all green |

Final guards: `learning-round-d-migration-action.txt` = `plan`, `staging-deploy-action.txt` = `plan`.

One side note: the AWS Social Events Image run on the #192 merge (38067340691) failed only because its 15-minute wait
for CI on the same commit ran out 20 seconds before that CI went green (that CI run took about 16 minutes). It
builds the social worker image, which round D does not change. The next merge to feat runs it again.

### Signed-out live checks (done)

- `/` and `/learn`: 200. A self-paced course page (`/learn/courses/sire-2-0-inspection-readiness`) loads with its
  usual "Enrol" button and no batch picker.
- Signed out, `/api/learn/sessions/<id>/calendar`, `/recording` and `/api/learn/batches/<id>/calendar` answer 401;
  `/api/learn/sessions/<id>/join` sends the visitor to sign in; the Studio batch and session pages, My Learning and
  Settings → Notifications send the visitor to sign in.

### Signed-in live checks (owner)

1. Studio → a course → Batches: choose "Batches" for the course (optional: drip from the batch start, minimum
   attendance 67 %). Add a batch starting today with a seat limit.
2. Batch → Sessions: add a weekly series of 3 sessions (e.g. three weekdays at the next round hour, 30 minutes) with
   any https meeting link. The first one should start about 70 minutes from now so both reminders fall inside the test.
3. As a test learner: open the course page, choose the batch, enrol. Player → Sessions shows the 3 sessions in the
   device's zone with the zone named; "Add to calendar" downloads a `.ics` file that opens in a calendar app.
4. Reminders: the "Coming up" email arrives within about 5 minutes (24 h stage) and "Starting soon" when the session
   is under an hour away.
5. From 15 minutes before the start, Join opens the meeting link; the trainer's Sessions page then shows the join
   time. After the start, mark the learner present for one session and absent for the next.
6. The learner finishes the lessons: the certificate waits while attendance is below the minimum (Course completed
   shows the attendance message); marking enough sessions present issues it.
7. Attach a recording (link or upload) to the first session: the learner sees it in Sessions; a learner of another
   batch and a signed-out visitor do not.
8. A self-paced course still enrols, plays and issues its certificate as before.
