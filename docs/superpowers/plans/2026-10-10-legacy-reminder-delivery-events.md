# Legacy invites: Resend delivery events and the second reminder

The owner asked for two things on 10 October:

1. **Delivery events from Resend.** A signed webhook on seanshore.in for delivered, bounced, complained,
   delivery_delayed, failed and suppressed. Each event is recorded on the legacy invitation row (the admin page's "Last
   event") and in a general email log. The 4,547 invitations sent on 3 October get their final status fetched from the
   Resend API. Any address that hard-bounced, complained or is on Resend's suppression list becomes do-not-email
   everywhere.
2. **A "Second reminder" mode** in Admin → Legacy invites. One reminder per person, ever, with exclusion counts shown
   before preparing, the same Prepare → review → Start sending → Stop controls, the same 5-per-sweep pace and the same
   claim links. It uses the owner's template with a one-click unsubscribe, sent from Sea N Shore
   <accounts@mail.seanshore.in>.

The owner presses Prepare and Start sending. Nothing in this release sends email by itself.

## Migration 0080 (`legacy-reminder-migration`, from the template)

Additive only. No existing check is relaxed and no existing row is changed.

- `email_delivery_events` is the general email log. Each webhook delivery is kept once per `svix-id`, and each
  backfilled status once per email.
- `email_suppressions` is the do-not-email list: one row per address, with the reason (hard_bounce, complaint,
  provider_suppressed, unsubscribed) and its source.
- `legacy_profile_invites` gets `last_event`, `last_event_at`, `delivered_at` and `delivery_checked_at`.
- `legacy_profile_invite_reminders` holds the reminders. Two unique indexes (one on the invitation, one on the
  lower-cased email) make "one per person, ever" a database rule. Each row has its own `unsubscribe_token`.

## Resend keys (owner's rule, 10 October)

The production key (`sea-n-shore/resend`) has "Sending access" only. The owner created a full-access key and stored it
in plaintext as `sea-n-shore/resend-admin`.

- The **admin key** is used only to create the webhook, update domain tracking, run the 3 October status backfill and
  run the 6-hourly suppression sync. The webhook runner on the bootstrap host and the outbox worker's
  `email-delivery/backfill.ts` are its only readers. That module never sends.
- **Sending** stays on the sending-only key, for every email.
- Neither key is ever printed.
- `src/lib/email/resend-admin-key-contract.test.ts` pins this boundary.
- Both actions of the webhook runner first confirm the admin secret can be read (`ADMIN_SECRET_READABLE=true`) and
  stop before any other call if it cannot.
- **Least privilege (follow-up, not changed here).** The existing runtime grant `sea-n-shore/resend*` lets both the
  web task role and the outbox worker role read the admin key. Only the worker needs it. Narrowing the web task's
  grant to the exact sending-key ARN would need a Terraform IAM change through its own guarded runner.

## Design decisions made while building

- **Webhook endpoint.** `POST /api/email/resend/webhook` verifies the Svix signature over the raw body:
  HMAC-SHA256 of `id.timestamp.body`, a 5-minute replay window, and a constant-time compare. It answers 400 for a bad
  signature, 503 until the secret exists (Resend retries), and 500 on a database error (Resend redelivers). Event
  types outside the six are acknowledged and ignored.
- **Signing secret.** The ops runner stores it as `sea-n-shore/resend-webhook-signing`. The existing
  `sea-n-shore/resend*` grant on the web and worker task roles already covers that name, so no IAM or Terraform
  change was needed, and the secret never enters Terraform state.
- **Creating the webhook.** The new guarded runner `resend-delivery-webhook` (plan / apply-once, owner arm) runs on
  the bootstrap host:
  1. It creates the Secrets Manager entry with a placeholder first, so a missing permission stops it before anything
     exists at Resend.
  2. It creates the webhook.
  3. It stores the signing secret through a 0600 file. The secret is never printed and never appears on a command
     line.
  4. It proves the live endpoint accepts a delivery signed with the stored secret and refuses an unsigned one.
  5. It is idempotent: a re-run reuses the webhook.
- **No tracking pixels.** Open and click tracking are Resend domain settings. With them on, Resend would add a pixel
  and rewrite the claim link whatever the template says. The plan run reports both flags for `mail.seanshore.in`,
  and the apply run turns them off. Nothing in the app reads opens or clicks.
- **Backfill in the outbox worker, not on the host.** The worker has database access and can read the admin key
  under its existing grant.
  It fetches each settled invitation's status once: sent more than a day ago, with no recorded event. It fetches
  about 20 every 20 seconds, 250 ms apart, which is roughly 4 a second against Resend's 10 a second team limit, and
  stops a sweep on 429. All 4,547 take about an hour and a half after the deploy. A webhook event always wins over a
  backfilled status. The worker also syncs Resend's suppression list (`GET /suppressions`) every 6 hours.
- **What "hard bounce" means.** A `bounced` event counts as hard unless Resend calls it Transient or Undetermined.
  Resend reports `bounced` only for permanent rejections, and the backfill sees no bounce type at all.
- **Do-not-email everywhere.** All six Resend senders and the SES trial reminder are covered: newsletter, learning,
  course and company invitations, tax documents, legacy invitations and reminders. They refuse a do-not-email
  address before calling the provider. The first-invitation Prepare also leaves such addresses out. Sign-up and
  password-reset codes (the Cognito sender Lambda) are deliberately not blocked: the person asked for them, and
  blocking them would lock the person out of their own account.
- **Eligibility.** Each first invitation is counted under the first rule it fails, so the admin counts add up. The
  rules, in order:
  1. never sent;
  2. reminder already prepared or sent;
  3. sent less than 7 days ago;
  4. bounced, complained or suppressed (any bounce, including temporary ones);
  5. delivery not confirmed;
  6. claimed (by profile or email);
  7. any Sea N Shore login with that email, verified or not, in any letter case;
  8. opted out (unsubscribed from the reminder or from the newsletter).

  Every rule is checked again for each person just before sending.
- **First-invitation worker fix.** When a sweep stopped on a retryable error, the invitations it had claimed but
  not tried stayed in `sending` for good. No sweep picks that status up and Stop cannot cancel it. They now go back
  to the queue with their attempt refunded. The reminder worker does the same.
- **One reminder, ever.** A cancelled reminder can be prepared again only if no send was ever attempted. A failed
  reminder is final and is never retried after a non-retryable error. A retryable error (429, 5xx) re-queues it,
  with up to 3 attempts. When a sweep stops on a retryable error, the reminders it claimed but never tried go back to
  the queue.
- **Unsubscribe.** The body link opens a page with one confirm button, because link scanners prefetch GETs. The
  `List-Unsubscribe` / `List-Unsubscribe-Post` headers point at an RFC 8058 one-click POST endpoint. Both put the
  address on the do-not-email list.

## Checklist

- [x] Migration 0080 + guarded runner `legacy-reminder-migration`. Post-apply checks: 3 tables, 4 columns, both
  unique indexes, and no existing invitation touched.
- [x] Webhook endpoint, signature check, event recording, do-not-email list and sender guard
- [x] Status backfill and suppression-list sync in the outbox worker
- [x] Second reminder: eligibility with exclusion counts, Prepare / Start / Cancel / Stop, template, worker (5 per
  sweep), unsubscribe page and one-click endpoint
- [x] Guarded runner `resend-delivery-webhook` (admin key read first; webhook, secret, domain tracking off, signed
  probe)
- [x] Backfill and suppression sync on the admin key; sending stays on the sending-only key
- [x] First-invitation worker: claimed-but-untried invitations go back to the queue after a retryable error
- [x] Tests: signature checks, eligibility rules on the real schema, one-per-person, unsubscribe, webhook handler,
  backfill, runner contract
- [x] Feature PR, migration arm, deploy arm, webhook arm, rearms, Remote Verify

## Release

| Step | Result |
| --- | --- |
| Feature PR (migration 0080, runners, code; admin key and first-invitation fix) | #201, merged as `f0e720d5` |
| Migration plan | run 38090301062: ADDITIVE, 14 statements, pending 0080, PLAN_VERIFIED |
| Webhook plan | run 38090301060: admin secret readable, no webhook, domain tracking already off, endpoint 404 (not yet deployed) |
| Migration arm | #202, merged by the owner |
| Migration apply | run 38117294898: APPLY_VERIFIED (3 tables, 4 columns, 2 unique indexes, no invitation changed) |
| Migration rearm | `6a2630a7` (guard back to `plan`) |
| Deploy arm | #203, merged by the owner |
| Deploy | run 38120799830: web `:246`, outbox worker `:128`, notification worker `:127` |
| Post-deploy checks | Remote Verify 38121520242, Google auth 38121521520, logo 38121522687: all green |
| Deploy rearm | `d6685cae` (guard back to `plan`) |
| Webhook arm, first try | #204, closed unmerged: its CI failed because the runner's contract test required the guard to read `plan` |
| Contract test fix | #205, merged as `42898bfe` |
| Webhook arm | #206, merged by the owner |
| Webhook apply | run 38123704521: webhook `c3601cf7-634a-4202-9990-96cbad3710c6` created for the six events, signing secret stored, signed probe accepted. The final unsigned probe reached the second web task while it still cached the missing secret (30 s) and got 503, so the run ended red. Checked right after: 12 of 12 unsigned probes answer `400 invalid_signature`. The verification now requires 6 matching answers in a row (this PR). |
| Webhook rearm | `3e48f335` (guard back to `plan`) |
| Backfill | runs by itself in the outbox worker since the deploy; progress shows on the First invitation tab |
| Second reminder | the owner prepares, reviews and starts it |
