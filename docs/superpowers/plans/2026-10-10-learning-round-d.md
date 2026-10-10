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
- [ ] D1 batches: settings, Studio batches page, managers and instructors, batch status sweep
- [ ] D1 enrol/buy into a batch (course page, free enrolment, checkout, trainer enrol, invitations), seat limit
- [ ] D1 drip from batch start (shared helper, TS and SQL)
- [ ] D1 roster batch filter and CSV
- [ ] D2 session calendar: one-off and recurring, edit/cancel, meeting links
- [ ] D2 member time zone and clear zone display
- [ ] D2 Upcoming sessions (player Sessions tab, My Learning) and .ics
- [ ] D2 reminder emails 24 h and 1 h before
- [ ] D2 Join tracking, attendance marking, minimum attendance for the certificate
- [ ] D2 recordings (link or upload)
- [ ] Zoom/Meet automatic link creation: note for the owner (not built)
- [ ] D3 design sent to the owner (not built until approved)
- [ ] PR 1 (D1 + migrations), PR 2 (D2), one guarded migration, one deploy, rearm, Remote Verify
- [ ] Live checks on seanshore.in and report
