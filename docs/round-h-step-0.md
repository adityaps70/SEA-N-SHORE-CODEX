# Round H, Step 0 (17 Oct 2026)

Checked against `feat/aws-native-phase-0-1` at `67873431` (web:258) and the live site, signed out.
Status: **TRUE** = still true, **PARTLY** = partly true, **FIXED** = already fine, **G** = done in Round G.

## Root cause of the 503s and the impressions failures

1. **`POST /api/feed/impressions` is rejected for every real browser, with 403.** Reproduced live: a POST
   with `Origin: https://seanshore.in` returns 403 from the app, and the same POST with no Origin
   header returns 400 or 401. The handler compared the browser's Origin with `Host` and `X-Forwarded-Host`. Behind CloudFront,
   `Host` is the ALB name and `X-Forwarded-Host` is pinned to `d3prih0q6jofyr.cloudfront.net`
   (`infra/aws/app/edge.tf:242`), so `seanshore.in` never matched. `/api/metrics/visit` has the same bug.
   The Round G "no repeats" feed has had no impression data since it shipped.
2. **The client turns every failure into a request every 5 s, for as long as the page is open.**
   `impression-tracker.ts` re-queued on any status except 2xx, 400 and 401, with a fixed 5 s timer, no backoff, no
   Retry-After and no limit. That is the "12+ consecutive calls" pattern.
3. **The 503s are not produced by the app, Next.js or WAF.** The impressions handler can only answer
   204, 400, 401, 403, 429 or 500. Next 16.3 never emits 503. A WAF block answers 403. CloudFront has no
   custom error responses. The ALB answers 503 only when the target group has no healthy target, and
   the `HTTPCode_ELB_5XX` alarm has not fired. The audit also saw S3 presigned GETs return 503 at the
   same time, and S3 is behind neither ECS nor WAF. The most likely source is the audit browser's
   network path. Request volume was still real: 99 requests per home load, and each nav route is
   prefetched twice (Next 16's segment cache sends a `/_tree` request and then a segment request). Each
   prefetch runs the `(app)` layout's 8 database queries on a 0.5 vCPU task.
   - The read-only RSC diagnostic (run 37918053458) could not read CloudWatch or WAF metrics: its role lacks
     `GetMetricData` and `wafv2:*`.
   - To prove the cause, read the ALB access logs (`elb_status_code` vs `target_status_code`). PR 1 adds
     target-5xx and ELB-5xx alarms so the next one is caught.
   - WAF per-IP limit: 2000 requests in 5 minutes. At 99 requests per load, about 20 page views in 5
     minutes would reach it, giving 403s.
4. **Realtime:** the provider survives navigation inside `(app)`. But `/learn` is in `(public)`, which has
   no provider, and `/people/[slug]` mounts its own. So Home → Learn → Events tears the connection down and
   rebuilds it, each time with a new ticket and a new messaging-state fetch.
5. **Video:** `/api/feed-media` answers 302 or 404, never 503, so the 503s came from S3 or the network. The player is a
   bare `<video>` with no poster, no error handler and no retry, so a failed load spins until a reload.

## Item status

| Item | Status | Note |
|---|---|---|
| H1 impressions 503/403 | TRUE | see above |
| H1 prefetch 503s | TRUE (not reproduced) | see above |
| H1 duplicate prefetch / 99 requests | TRUE | default `prefetch` on every nav Link |
| H1 realtime reconnects | PARTLY | across `(app)`/`(public)` only |
| H1 video retry / poster | TRUE | no `poster_path` column yet |
| H1 alarms | PARTLY | SNS email goes to a personal address. No CPU, target-5xx or per-API alarms, no health check. `/api/health` does not exist (it is `/api/health/live`) |
| H2 self-issued certificates | TRUE | no mentor or team check at issue time; no verified/self-issued column |
| H2 For You shows ineligible jobs | TRUE | `queries.ts:119` only sorts them lower |
| H2 admin 13 vs Jobs 12 | TRUE | admin counts all `published`; Jobs leaves out deleted, plan-hidden, past apply-by, dismissed and your own applied jobs. No caching involved |
| H2 joining date passed | TRUE | `joining_window_past` declared, never used |
| H2 `/api/profile/cv` 500 | TRUE | uncaught `AwsAuthenticationRequiredError` |
| H2 unknown `/api/*` HTML 404 | TRUE | no catch-all |
| H2 cancelled events in archive | TRUE | `listPastEvents` selects `status in ('published','cancelled')` |
| H2 raw markdown | TRUE | no renderer |
| H2 Like state | PARTLY | weak colour change; background dropped on phones |
| H2 "Audience: Anyone" twice | TRUE | `post-composer.tsx:992` |
| H2 repeated "approved your changes" | TRUE | Round G grouping covers reactions and comments only |
| H2 messaging dock, panel height, "Last:", dates | TRUE | |
| H2 recruiter toggle | PARTLY (G) | shown to seafarer and shore-staff profiles only; the card text promises it to everyone |
| H2 who can message me / see my connections | TRUE | not present |
| H3 change password / email, sessions, backup codes | TRUE | none exist. Sign-out already calls Cognito GlobalSignOut (signs out every device); Cognito has no backup codes |
| H3 admins keep 2FA | FIXED | `satisfiesAdminMfa` gate |
| H3 email for messages / connections / comments / mentions | TRUE | only job alerts, weekly digest and learning emails. Mail goes out through Resend via the outbox worker, not SES |
| H4 CSP report-only + endpoint | PARTLY | added in Round 14; img/connect allow any `https:`; HTML only; the landing page's Google Fonts are reported |
| H4 COOP, poweredByHeader, security.txt | TRUE | |
| H5 public jobs | TRUE | `/jobs` is in the proxy's protected list and the `(app)` layout requires sign-in |
| H5 JobPosting, sitemap, canonicals, titles, descriptions | TRUE / PARTLY | the sitemap has static pages and courses only; there is no profile indexing setting |
| H5 landing H1 | PARTLY | the rotator is already aria-hidden, but it sits inside the H1 |
| H6 all | TRUE | three headers, four footers, no width token, two Button primaries plus teal |
| H6 avatars | PARTLY | posts use the logo when it is set; course cards always show initials |
| H7 people once per page | TRUE | Round G hotfix removes connected, followed and asked people only |
| H7 search relevance | G | behind the search ranking switch |
| H7 rank "Other" | PARTLY (G) | the missing ranks exist except Operations Coordinator; cap is 100 |
| H7 course reviews | PARTLY | exist; owner reply missing |
| H7 course total duration | FIXED | already shown |
| H7 GST invoices | PARTLY | course and seat-pack invoices exist; none for subscriptions or event tickets |
| H7 the rest | TRUE | |
| H8 all | TRUE | `--muted` passes; 103 elements under 12 px; 1 px focus ring; both navs named "Primary" |
| H9 | TRUE | test course and event exist only in the database |
