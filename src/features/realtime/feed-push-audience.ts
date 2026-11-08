import type { QueryResultRow } from 'pg'
import type { DomainEvent } from '@/features/events/types'

/**
 * Round ARCH (broadcast fix): who gets a realtime hint for a feed event. Feed events used to go to every open
 * connection (a full table scan in the fan-out Lambda), and every browser then re-rendered its whole page.
 *
 * - A new post or repost: the author's network (accepted connections and followers, the organization's followers
 *   for an organization post, the group's active members for a group post), at most FEED_PUSH_AUDIENCE_CAP.
 * - A reaction or comment change: only the post's author (not when they made it themselves).
 * - Load-test accounts are never in an audience, and a load-test actor's events go to no one.
 *
 * A hint carries no content (event type and time only); the browser re-asks the server, which applies the full
 * feed visibility, so a slightly wide audience shows nobody anything new. Anyone beyond the cap, or any event whose
 * audience could not be read, still sees new posts through the 60-second count check.
 */

// 500 ids (~39 bytes each in JSON) keep one event under ~20 KB, so a batch of 10 stays under EventBridge's
// 256 KB PutEvents limit.
export const FEED_PUSH_AUDIENCE_CAP = 500

const NEW_POST_EVENTS = new Set(['feed.post_created', 'feed.post_reposted'])
const COUNT_EVENTS = new Set(['feed.post_reaction_changed', 'feed.post_comments_changed'])

type Query = <T extends QueryResultRow>(text: string, values?: readonly unknown[]) => Promise<T[]>
type IdRow = QueryResultRow & { id: string }

// $1 post id, $2 actor id, $3 cap.
export const NEW_POST_AUDIENCE_SQL = `with post as (
    select p.author_id, p.company_id, p.group_id from public.posts p where p.id = $1 and p.deleted_at is null
  )
  select distinct audience.id
  from (
    select case when c.user_low_id = post.author_id then c.user_high_id else c.user_low_id end as id
    from post join public.connections c
      on (c.user_low_id = post.author_id or c.user_high_id = post.author_id) and c.status = 'accepted'
    union select f.follower_id from post join public.follows f on f.following_id = post.author_id
    union select o.follower_id from post join public.organization_follows o on o.company_id = post.company_id
    union select m.profile_id from post join public.community_group_memberships m
      on m.group_id = post.group_id and m.status = 'active'
  ) audience
  join public.profiles member on member.id = audience.id
  where member.is_load_test = false
    and member.account_status = 'active'
    and audience.id <> (select author_id from post)
    and not exists (select 1 from public.profiles actor where actor.id = $2 and actor.is_load_test)
  order by audience.id
  limit $3`

// $1 post id, $2 actor id.
export const POST_AUTHOR_AUDIENCE_SQL = `select p.author_id as id
  from public.posts p
  join public.profiles author on author.id = p.author_id
  where p.id = $1 and p.deleted_at is null and p.author_id <> $2
    and author.is_load_test = false
    and not exists (select 1 from public.profiles actor where actor.id = $2 and actor.is_load_test)`

function isFeedEvent(event: DomainEvent) {
  return NEW_POST_EVENTS.has(event.eventType) || COUNT_EVENTS.has(event.eventType)
}

async function audienceFor(query: Query, event: DomainEvent): Promise<string[]> {
  const payload = event.payload as { actorId?: unknown; postId?: unknown }
  const postId = typeof payload.postId === 'string' ? payload.postId : event.aggregateId
  const actorId = typeof payload.actorId === 'string' ? payload.actorId : ''
  const result: IdRow[] = NEW_POST_EVENTS.has(event.eventType)
    ? await query<IdRow>(NEW_POST_AUDIENCE_SQL, [postId, actorId, FEED_PUSH_AUDIENCE_CAP])
    : await query<IdRow>(POST_AUTHOR_AUDIENCE_SQL, [postId, actorId])
  return [...new Set(result.map((row) => row.id))].slice(0, FEED_PUSH_AUDIENCE_CAP)
}

/**
 * Adds audienceProfileIds to each feed event (other events pass through unchanged). Fails safe: when an audience
 * cannot be read, that event goes out with an empty audience (no push; the browser's count check still runs).
 */
export async function withFeedPushAudience(events: DomainEvent[], query: Query): Promise<DomainEvent[]> {
  return Promise.all(events.map(async (event) => {
    if (!isFeedEvent(event)) return event
    let audienceProfileIds: string[] = []
    try {
      audienceProfileIds = await audienceFor(query, event)
    } catch (error) {
      console.error('realtime_feed_audience_unavailable', { eventType: event.eventType, name: error instanceof Error ? error.name : null })
    }
    return { ...event, payload: { ...event.payload, audienceProfileIds } } as DomainEvent
  }))
}
