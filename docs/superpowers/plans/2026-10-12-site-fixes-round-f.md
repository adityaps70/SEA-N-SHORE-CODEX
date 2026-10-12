# Site fixes round F: tag notifications, leave organization, public post links, right-rail footer

The owner reproduced each issue on seanshore.in on 11 October. Delivery: PR 1 = F1 + F3 (the post access rules) and
the migration; PR 2 = F2 + F4 + the logo fix. One guarded migration, then one deploy.

## Step 0: findings checked against the code (HEAD `d6b1c8da`)

| # | Finding | Verdict | Root cause and evidence |
| --- | --- | --- | --- |
| F1 | Tag row has no thumbnail or preview | Still true for this post | Every row gets a preview tile when `listPostPreviews` finds the post (`notifications/repository.ts`). That query drops deleted posts and blocked pairs only; it ignores community privacy and the author's status. A tag row with no tile therefore means the post is deleted (or a block exists). |
| F1 | Tapping opens a 404 | Still true | `/posts/[id]` loads through `getPostRow`: `deleted_at is null` plus the feed visibility predicate (`feed/repository.ts` `visibilitySql`). **Root cause: the tagged post was deleted (soft delete), and the `photo_tag` notification stays behind.** Nothing removes or flags tag and mention notifications on delete, on untag (`removeMyPhotoTag`) or when an edit drops a mention. Notifications only go when the 30-day purge hard-deletes the post. The link itself is right: it uses the post id, not the media id. The other suspects do not apply: a private-community post still gets a tile (the preview query ignores community privacy), and posts have no connections-only audience. |
| F1 | Client navigation (`?_rsc`) returned 503 | Not reproducible in code | Locally, both `next dev` and a production build (`next start`) answer the same click from /notifications with 200 and the not-found screen. The full load gives 404. The app has no 503 path for pages. The page only calls `notFound()`, the proxy only passes or redirects, the WAF blocks with 403 and CloudFront has no custom error pages. So the 503 most likely came from the load balancer (no healthy target, for example while a deploy drained tasks; three deploys ran on 11 October). One real bug nearby: an id that is not a UUID makes Postgres throw (22P02), giving a 500 instead of a 404. Fixed, with tests. |
| F1 | Filter chips hidden on desktop | Still true | The chip row has `md:hidden`, and the filter only hides rows with `max-md:hidden` (round 8 made them phone-only). |
| F1 | Mentions misses tags | Still true | `mentions` = `post_mention`, `comment_mention` only; `photo_tag` and `organization_mention` are in no chip. |
| F1 | Subtitle omits mentions and tags | Still true | `notifications/page.tsx` and the empty state. |
| F1 | Tagged members can't open private posts | True by design today | `getPostRow` has no tag exception. Private-community posts need membership. |
| F2 | Only Owner/Administrator can leave | Still true, and narrower | "Leave team" sits in `OrganizationTeamPanel`, behind `organization.team`: Organization Pro, a verified page, and Owner or Administrator. `removeOrganizationMember` checks the same capability even for self-removal. Plain members, Recruiter / HR and the manager roles have no way out. |
| F2 | Last owner / transfer | No transfer exists | `updateMemberRole` refuses owner changes. Community groups have a transfer flow to copy. |
| F2 | Withdraw request | **Already exists** | Organizations → Your requests has "Withdraw" (`withdrawOrganizationAccessRequest`, status `cancelled`, audited). Rejoining works: a new request is refused only while a membership row exists. |
| F2 | Leave side effects | Gaps | The repository delete removes the role, and every workspace check re-reads `company_members`. It does not clear `maritime_profiles.current_company_id`, which drives the profile badge, the left-rail card and the People tab. It does not notify anyone. Audit types are free text (no migration). Notification types are a Postgres enum, so a new one needs a migration. |
| F3 | Signed-out `/posts/<id>` redirects, no return path | Still true | `/posts` is in the proxy's `PROTECTED_PREFIXES`, and the redirect is a bare `/auth/sign-in`. No auth flow (email, MFA, Google, sign-up, onboarding) carries a return path. `/auth/post-sign-in` only knows `/home` or `/onboarding`. |
| F3 | Title is "Post \| Sea N Shore" | Still true | Static `metadata`, no Open Graph. |
| F3 | Visibility values | **None exist** | `public.posts` has no audience or visibility column. A signed-in, onboarded member sees every post except private-community posts (`community_groups.visibility` is `public` or `private`), blocked pairs and inactive authors. There is no profile privacy switch (only `contact_visibility`). **Side finding (privacy):** signed-out visitors already read a member's posts on `/people/<slug>`, and that list is built as the author, so it includes the author's private-community posts. |
| F4 | Rail footer overlaps when "More" opens | Still true | `RailFooter` is `sticky bottom-0 z-[1]` with no background, inside the home and activities rail scroller. On profile, people and job pages it sits in a sticky aside with no height cap. The Messaging dock is fixed at the bottom (about 48 px, z-90) over the right-rail column, and nothing reserves space for it. |
| Logo | Blank logo box on Your pages | Cause not confirmed in code | Both cards use the same `OrganizationLogo` and the same `/api/company-logo/<id>?v=` URL. The card uses size `lg` over the cover; the page uses size `xl`. The box is white only when the `<img>` is there but shows nothing: the logo route answered 401/404 (a session that had expired by the time the lazy image loaded, or an object it refuses), or the image failed before hydration. The component had no error fallback, so any failure left the white `bg-white` image box. |

## Decisions

- **Post audience (owner's choice)**: one additive column, `posts.audience`, either `anyone` or `members`. Existing
  posts become `members`, so nothing turns public that the author did not choose. The composer and the post's edit
  menu get "Who can see this": Anyone (the default for new personal and organization posts) or Members only.
  Community posts are always members only. Signed out, `/posts/<id>` and profile pages show only `anyone` posts by
  active authors, with any reposted original also `anyone`. Everything else shows the members-only teaser.
- **Tagged members**: a member tagged in a photo or @mentioned in a post can open that post, even in a private
  community, while it exists. Blocks and inactive authors still hide it. The exception covers that post only, not
  the community or the feed.
- **Unavailable posts**: a tag, mention or other post notification whose post is deleted, or no longer visible to
  the recipient, shows "This post is no longer available" and is not clickable. Untagging a member or dropping a
  mention removes that member's notification (unless another tag in the same post remains).
- **Return path**: `?next=` holds a same-site relative path. A validator rejects `//`, backslashes, schemes,
  encoded slashes and dots, control characters, `/auth` and `/api`. The proxy stores it in a short-lived httpOnly
  cookie when a sign-in or sign-up page is opened with it. `/auth/post-sign-in` and onboarding completion honour
  and clear it. This covers email, MFA, Google and sign-up then onboarding.
- **Caching**: CloudFront's HTML behaviour is `Managed-CachingDisabled`, so edge caching of signed-out posts needs
  a Terraform change. That is not in this round. Signed-in post pages stay `private, no-store`. Post pages carry
  `robots: noindex`.
- **Leave organization**: a new member action open to every approved member. It refuses the last owner, deletes
  the membership in a transaction, clears the self-declared current organization if it points there, writes
  `organization.member_left` to `audit_events` and notifies owners and administrators with a new notification
  type, `organization_member_left`. Ownership transfer is added, for owners, to an existing administrator.

## Checklist

- [x] Step 0
- [x] PR 1: migration (notification type + post audience), F1, F3, privacy fix on profile posts
- [x] PR 1 merged ([#222](https://github.com/adityaps70/SEA-N-SHORE-CODEX/pull/222))
- [ ] PR 2: F2, F4, logo
- [ ] Guarded migration, one deploy, rearm, Remote Verify
- [ ] Live checks, report

## PR 1 notes

- **Migration** `0081_site_fixes_round_f_types` (notification type `organization_member_left`) and
  `0082_site_fixes_round_f` (`posts.audience`, default `members`, check `anyone|members`). Guarded runner
  `site-fixes-round-f-migration`. Its plan run also prints a read-only line about the owner's tagged post
  (`SITE_FIXES_ROUND_F_TAGGED_POST exists= deleted= private_or_archived_community= author_inactive= …`) to confirm
  the F1 root cause on production.
- **Post page** moved from `(app)` to `(public)/posts/[id]`. The proxy treats `/posts/<id>` as "soft auth": it
  still refreshes a member's session, but never redirects a signed-out visitor. Signed-out views are limited to
  60 a minute per address (429 with `Retry-After`). Pages stay `private, no-store`.
- **Signed out**: "Anyone" posts render read-only with the join banner (Sign up / Sign in carry
  `?next=/posts/<id>`), reaction and comment counts only, and no comments or reactor list. Any other live post
  shows the members-only teaser with nothing from the post in the HTML. Deleted or malformed ids get the post's
  own 404 page.
- **Share tags**: "Anyone" posts get `"<Author> on Sea N Shore"`, the first 150 characters, the canonical URL and
  `og:image` = `/api/public/posts/<id>/image`. That route streams the first photo of an "Anyone" post only; it is
  rate-limited and `public, max-age=300`. Every other post gets generic tags. All posts carry `noindex, nofollow`.
- **Post media** (`/api/feed-media`): signed out, it now serves the media of "Anyone" posts. Before, it returned
  401, so photos on public profiles never loaded for visitors. Signed in, it applies the post page rule
  (tagged-member exception).
- **Profile pages**: signed out, they list only the author's "Anyone" posts, without comments. Signed in, they
  list posts by the member rules. Before, both lists were built as the author, which leaked private-community
  posts.
- **Return path**: `src/lib/auth/return-path.ts` (validator, cookie `sns_return_to`, 30 minutes, httpOnly). The
  proxy sets it on `/auth/sign-in|sign-up?next=` and clears it when the member arrives. `/auth/post-sign-in`
  and the end of onboarding (`homeOrReturnPath`) honour it. Protected-route redirects now carry `?next=`, and so
  do the course page and public profile join prompts.
- **Notifications**: previews follow the post page rule. A post that is deleted or out of reach marks the row
  "This post is no longer available", which has no button and no thumbnail (list and bell). Restoring the post
  brings the row back. Tag rows preview the tagged photo and link to `/posts/<id>?photo=<media id>`. The post
  page scrolls to that photo, outlines it, shows "You're tagged in this photo" and highlights the member's name.
  Untagging someone's last tag removes their tag notification, and an edit that drops a mention removes that
  mention notification. The chips filter on every screen, Mentions includes photo tags and organization
  mentions, and the subtitle names mentions and photo tags.
- **Composer and edit dialog**: "Who can see this" is Anyone (the default) or Members only. Community posts show
  "Members of <group>" (fixed), and reposts take their original's audience. Posts show a globe (Anyone) or a
  people icon (Members only) next to the time.

## PR 2 notes

- **Leave organization** (`membership-repository.ts`, `membership-actions.ts`, `components/leave-organization.tsx`).
  Any approved member, whatever their role, can leave from three places: the "You are part of" card, the
  organization page's "…" menu and the "⋯" menu on each Organizations › Your pages card. An in-page dialog says
  what changes (role and workspace tools go; their jobs, posts and courses stay with the organization; the badge
  goes; they can ask to join again). One transaction, with the organization's memberships locked:
  - deletes the membership and so the role. Every workspace tool and seat re-reads `company_members`, so access
    ends on the next request;
  - withdraws the member's pending access requests for that organization;
  - clears `maritime_profiles.current_company_id` when it points at the organization (profile badge, Home card);
  - suspends a recruiter verification that came from organization membership when no verified organization
    still grants it;
  - writes `audit_events` `organization.member_left` (actor id, organization id, `{ previousRole }`, nothing else);
  - sends `organization_member_left` to the remaining owners and administrators. It opens the Manage page.
- **Last owner**: refused on the server (`organization_last_owner`). The dialog becomes "Transfer ownership
  first", with a picker of the organization's administrators. Transfer makes the administrator an owner and
  the current owner an administrator, who can then leave. It is audited as `organization.ownership_transferred`.
  With no administrator, the dialog says how to add one.
- **Withdraw request** was already on Organizations › Your requests. Leaving withdraws pending requests, and a
  member who left can request again (tested).
- **Rail footer (F4)**: no longer sticky. It is in the rail's flow with the page background and 4 rem of bottom
  padding for the Messaging dock. "More" is a button with `aria-expanded` and `aria-controls`; the list opens
  below it, scrolls into view, and Escape closes it and returns focus. The profile, people and job rails now
  scroll on their own (like Home and Activities), so an open list never runs off the screen.
  `tests/e2e/rail-footer.spec.ts` opens More on /home at 1280, 1440 and 1920 px and asserts that the footer box
  overlaps no rail card. It runs with `E2E_ACCESS_COOKIE` or E2E credentials and passed locally. A local
  sweep of /home, /activities, /profile and /people/<slug> at those widths found no overlap.
- **Logo**: `OrganizationLogo` loads eagerly and falls back to the initials when the image fails, including a
  failure before hydration. It never shows an empty white box.
