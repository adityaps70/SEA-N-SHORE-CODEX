# Sea N Shore Feed Replies, No-Refresh Interactions & Realtime Design

## Goal
Make the Sea N Shore social feed feel like LinkedIn/Instagram without replacing the existing Aurora/EventBridge/SQS architecture.

## Approved UX
- Show replies clearly under the parent comment using a LinkedIn-style visual thread: indentation, vertical rail, and elbow connector into each reply.
- Under each comment/reply show a compact social-metrics row on the left: reaction symbol(s) with total reaction count, then a reply/comment icon with the number of direct replies when non-zero.
- Clicking the reaction count opens existing reaction details.
- Keep the existing reaction picker (Like, Support, Respect, On Point). Selected reaction remains visually represented.
- Reply count toggles/anchors the visible replies; do not introduce unlimited recursive Reddit-style nesting.
- Existing owner-only edit/delete and 15-minute edit policy stay unchanged.

## Interaction performance
- React/unreact on posts and comments must be optimistic and must not trigger broad route revalidation or `router.refresh()`.
- Existing photos/videos must remain mounted and must not visibly reload because of reaction-only mutations.
- Comment/reply creation should update the current thread locally after the server confirms success instead of refreshing the whole route.
- Comment edit/delete should update local thread state after success instead of refreshing the whole route.
- Marking notifications read should update bell/list state locally instead of refreshing the page.

## Realtime model
- Use lightweight authenticated polling as Stage A, approximately every 8 seconds while the document is visible.
- Poll only for small deltas (notification chrome/newest feed state), not full feed pages.
- When a new notification appears, update the bell count and prepend/update notification entries without route reload.
- When newer feed posts are detected, do not force-insert and jump the reader. Show a small `New posts available` control; clicking it refreshes/prepends the new feed state while preserving user intent.
- Pause/background-throttle polling when the document is hidden.
- Do not add WebSockets/SSE in Stage A.

## Pagination
- Preserve the existing cursor-based feed pagination.
- Replace or supplement the manual Load more control with IntersectionObserver-driven infinite loading while keeping an accessible manual fallback.
- De-duplicate posts by id when appending pages.

## Caching/CDN
- Do not enable shared CloudFront caching for personalized authenticated HTML/feed/notification responses.
- Keep existing CloudFront application behavior safe for personalized content.
- Dedicated media-CDN work is deferred to Stage B; current Stage A must not change S3/CloudFront media architecture.

## Architecture constraints
- Reuse Aurora as source of truth.
- Reuse current outbox/EventBridge/SQS notification pipeline.
- No new realtime vendor or external dependency.
- No database migration unless a verified implementation blocker requires it.
- No redesign of unrelated feed/header/profile UI.
- Branch: `feat/aws-native-phase-0-1` only.
- Do not touch `main`, merge, or create a PR.
- Deployment guards must remain `plan` during development; final rollout, if performed, uses the existing guarded `deploy-once` process only after exact-head verification.
