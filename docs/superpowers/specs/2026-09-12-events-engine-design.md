# Sea N Shore Events Engine Design

## Goal
Turn the existing LinkedIn-style Events UI into a real maritime Events product with persistent event creation, discovery, attendance, hosting management, edit/cancel controls, online/in-person/hybrid event support, and authenticated staging verification.

## Scope

### User-facing capabilities
- Discover published upcoming events.
- Search published events by title, description, topic, organizer name, speaker text, location and format.
- Open an event detail page.
- Attend an event and withdraw attendance.
- See attendee count on discovery/detail surfaces.
- Open **My Events** to see events the signed-in user is attending.
- Open **Hosting** to see events created by the signed-in user.
- Create an event as an authenticated user.
- Edit and cancel only events owned by the current user.
- Support `online`, `in_person`, and `hybrid` formats.
- Store event title, summary, description, start/end, timezone, location, meeting URL, topics, speaker text, capacity, banner URL, publish state and cancellation state.
- Show past events in an archive view instead of leaving the archive as a placeholder.

### Explicit non-goals for this implementation
- Paid ticketing.
- External calendar sync.
- Email reminder campaigns.
- Multi-host role delegation.
- Separate speaker accounts or a speaker approval workflow.
- Event comments/chat.
- Recording upload pipeline; the archive exposes completed events and optional recording URL metadata can be added later without changing the core attendance model.

## Architecture

Events will follow the existing Sea N Shore server-rendered AWS architecture. Persistence lives in Aurora PostgreSQL through the existing database helper/repository conventions. Server Actions perform authenticated mutations, repository methods own SQL/data mapping, and Next.js app routes render discovery, detail, create, My Events and Hosting views.

The subsystem is isolated under `src/features/events/` so event validation, SQL, actions and components remain independent from Jobs and Feed. Routes under `src/app/(app)/events/` consume that feature layer.

## Data model

### `public.events`
- `id uuid primary key`
- `host_user_id uuid not null references public.profiles(id) on delete cascade`
- `title text not null`
- `summary text not null`
- `description text not null`
- `format text not null check (format in ('online','in_person','hybrid'))`
- `status text not null check (status in ('draft','published','cancelled'))`
- `start_at timestamptz not null`
- `end_at timestamptz not null`
- `timezone text not null`
- `location_name text`
- `meeting_url text`
- `banner_url text`
- `topics text[] not null default '{}'`
- `speakers text`
- `capacity integer`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `published_at timestamptz`
- constraints require `end_at > start_at`, positive capacity when present, meeting URL for online/hybrid, and location for in-person/hybrid.

### `public.event_attendees`
- `event_id uuid not null references public.events(id) on delete cascade`
- `user_id uuid not null references public.profiles(id) on delete cascade`
- `created_at timestamptz not null default now()`
- primary key `(event_id, user_id)`

Useful indexes cover published chronological discovery, host lookup and attendee lookup.

## Authorization
- Every Events route remains inside the authenticated `(app)` shell.
- Any authenticated Sea N Shore user may create an event.
- Only `host_user_id` may edit, publish or cancel that event.
- Draft events are visible only to their host.
- Published events are discoverable to authenticated users.
- Cancelled events remain visible to the host and existing attendees but cannot accept new attendance.
- A host is implicitly part of the event and does not need a separate attendee row.
- Attendance mutations use the authenticated profile ID from the existing auth/session layer; caller-supplied user IDs are never trusted.

## Validation
- Title: 5–140 characters.
- Summary: 20–280 characters.
- Description: 40–10,000 characters.
- Start must be a valid future/present timestamp at creation; end must be after start.
- Timezone is required.
- Online and hybrid events require an `https://` meeting URL.
- In-person and hybrid events require a non-empty location.
- Capacity, when set, must be 1–100000.
- Topics are normalized, de-duplicated and capped at 10 values.
- Banner URL is optional but must be `https://` when provided.

## Discovery and search
`listDiscoverEvents()` returns published, non-cancelled events ordered by start time. A `q` query parameter performs case-insensitive matching across title, summary, description, host name, speaker text, location, format and topics.

The existing Events hero search becomes a real GET form. Event format/topic cards become discovery links rather than inert cards where practical.

## Event details
`/events/[eventId]` shows:
- banner/identity header
- date/time/timezone
- online/in-person/hybrid metadata
- organizer identity
- topics and speakers
- attendee count/capacity
- Attend / Attending / Withdraw controls
- host-only Edit and Cancel controls

Meeting URLs are shown only to the host or attending users so public discovery does not leak private meeting links.

## My Events
`/events/my` lists published/non-cancelled events the current user attends, plus cancelled events previously attended so users retain context.

## Hosting
`/events/hosting` lists all events owned by the signed-in user with status, attendee count, edit link and management actions. It also exposes **Create event**.

## Create/Edit flow
- `/events/new` renders the event editor for creation.
- `/events/[eventId]/edit` renders the same form for the host.
- The create action supports Save draft or Publish now.
- Edit preserves ownership and can update draft/published event data.
- Cancel is a status transition rather than hard delete, preserving attendee/history context.

## UI direction
Maintain the current Sea N Shore navy/teal visual system and the LinkedIn-familiar information architecture. Remove every “Coming soon” badge from functionality implemented here. Empty states should explain that no matching records exist rather than promise future functionality.

## Error handling
- Repository methods return `null` for missing/inaccessible records and throw for database faults.
- Server Actions validate input and return structured form errors for user-correctable input.
- Capacity conflicts and duplicate attendance are handled transactionally/idempotently.
- Not-found or unauthorized edit/detail access uses existing Next.js not-found/redirect conventions.

## Testing
- Validation unit tests.
- Repository SQL/contract tests following existing AWS contract-test style.
- Component/action tests for create, search, attendance state and host-only management.
- Update the Events page contract to prohibit `Coming soon` and require working navigation/actions.
- Extend staging Playwright onboarding E2E to create a disposable event, discover it, attend/withdraw with another disposable user, verify My Events/Hosting/detail pages, cancel it, and include event rows in cleanup.
- Exact-head lint, typecheck, test, Docker build, Terraform/guard checks, staging deploy, Remote Verify and one-shot authenticated staging E2E must all pass.

## Deployment safety
- Work only on `feat/aws-native-phase-0-1`.
- Never modify `main`, merge or create a PR.
- Preserve all existing guard-file conventions.
- Database schema is added through the repo’s existing migration mechanism and deployed only through the guarded AWS staging workflow.
- After deployment/E2E, restore every one-shot guard to `plan` and verify the final safe head.
