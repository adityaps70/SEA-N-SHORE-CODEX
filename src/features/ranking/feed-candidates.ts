import { query as databaseQuery } from '@/lib/db/client'
import { FEED_WEIGHTS } from './feed-weights'
import { loadTestAuthorVisibleSql } from '@/features/load-test/load-test-sql'

/**
 * Round G (G1): the candidate posts for "Top for you", with every feature the scorer reads, in one
 * SQL statement. Every existing visibility rule applies (blocks, inactive authors, private
 * communities, repost sources, hidden posts), plus mutes. Posts the viewer has seen or engaged with
 * are excluded at the content level: a repost and its original are one piece of content, so seeing
 * or reacting to either removes both.
 */
type Query = (text: string, values?: readonly unknown[]) => Promise<Array<Record<string, unknown>>>

export type FeedSource = 'self' | 'connection' | 'followed_person' | 'followed_org' | 'community' | 'second_degree' | 'discovery' | 'explore'

export type FeedCandidate = {
  id: string
  contentId: string
  authorId: string
  companyId: string | null
  groupId: string | null
  groupPublic: boolean
  category: string
  postType: string
  repostOfPostId: string | null
  createdAt: Date
  bodyLength: number
  linkOnly: boolean
  hasMedia: boolean
  /** Relationship flags (for the representative row's author). */
  isSelf: boolean
  isConnection: boolean
  isFollowedPerson: boolean
  isFollowedOrg: boolean
  isMyCommunity: boolean
  /** A connection commented on or reposted this content. */
  secondDegree: boolean
  secondDegreeActorId: string | null
  /** Names the viewer already sees on the post, for the "why" line. */
  authorName: string
  companyName: string | null
  groupName: string | null
  secondDegreeActorName: string | null
  /** Engagement on the content (the original), from post_stats. */
  reactions: number
  comments: number
  reposts: number
  /** Reactions and comments on the content by the viewer's connections. */
  connectionEngagement: number
  /** Reactions on the content by members in the viewer's rank band or department this week. */
  similarEngagement: number
  /** Author signals. */
  authorRoleKey: string | null
  authorDepartmentKey: string | null
  authorPersona: string | null
  authorVesselCodes: string[]
  authorTradingAreas: string[]
  authorCompanyId: string | null
  authorAccountAgeDays: number
  authorPostsLastDay: number
  /** The viewer's own signals about this author / organization / category. */
  viewerEngagementWithAuthor: number
  showLessAuthor: boolean
  showLessCompany: boolean
  showLessCategory: boolean
  pendingReport: boolean
  /** Distinct connections and others who reposted this content (for the collapsed card's label). */
  repostCount: number
}

export type FeedViewerProfile = {
  id: string
  roleKey: string | null
  departmentKey: string | null
  persona: string | null
  intents: string[]
  vesselCodes: string[]
  tradingAreas: string[]
  companyId: string | null
  createdAt: Date | null
  graphSize: number
  engagementCount: number
  /** Reactions and comments per post category in the last 60 days. */
  categoryAffinity: Record<string, number>
}

export type CandidateOptions = {
  viewerId: string
  windowDays: number
  /** Content ids already served in this visit (never served twice in one visit). */
  excludeContentIds?: readonly string[]
  limit?: number
  /** 'network' = the ranked sources; 'explore' = any visible unseen post outside the viewer's network. */
  mode?: 'network' | 'explore'
}

const RANK_BAND_SQL = `(
  select coalesce(array_agg(r.code), '{}'::text[])
  from public.maritime_rank_steps vr
  join public.maritime_rank_steps r on r.ladder = vr.ladder and r.department_key = vr.department_key and abs(r.step - vr.step) <= 1
  where vr.code = (select role_key from public.profiles where id = $1)
)`

/** CTEs shared by the candidate and "new posts" queries. $1 = viewer. */
export function viewerGraphCtes() {
  return `
  viewer_connections as (
    select case when c.user_low_id = $1 then c.user_high_id else c.user_low_id end as id
    from public.connections c
    where (c.user_low_id = $1 or c.user_high_id = $1) and c.status = 'accepted'
  ),
  viewer_followed as (select following_id as id from public.follows where follower_id = $1),
  viewer_followed_orgs as (select company_id as id from public.organization_follows where follower_id = $1),
  viewer_groups as (select group_id as id from public.community_group_memberships where profile_id = $1 and status = 'active'),
  viewer_muted_people as (select muted_profile_id as id from public.user_mutes where viewer_id = $1 and muted_profile_id is not null),
  viewer_muted_orgs as (select muted_org_id as id from public.user_mutes where viewer_id = $1 and muted_org_id is not null),
  viewer_seen as (
    select coalesce(seen_post.repost_of_post_id, seen_post.id) as id
    from (
      select post_id from public.post_impressions where viewer_id = $1
      union select post_id from public.post_reactions where user_id = $1
      union select post_id from public.post_comments where author_id = $1
      union select post_id from public.post_poll_votes where user_id = $1
      union select post_id from public.saved_posts where user_id = $1
      union select post_id from public.post_hides where user_id = $1
    ) touched
    join public.posts seen_post on seen_post.id = touched.post_id
    union
    select repost_of_post_id from public.posts where author_id = $1 and repost_of_post_id is not null
  )`
}

/** The visibility rule of the feed (repository.ts visibilitySql) for candidate rows, plus mutes. $1 = viewer. */
export function candidateVisibilitySql() {
  return `
    p.deleted_at is null
    and (p.author_id = $1 or (
      author.account_status = 'active' and author.onboarding_completed_at is not null
      and ${loadTestAuthorVisibleSql('author', '$1')}
      and not exists (
        select 1 from public.user_blocks b
        where (b.blocker_id = $1 and b.blocked_id = p.author_id) or (b.blocker_id = p.author_id and b.blocked_id = $1)
      )
    ))
    and (
      p.group_id is null
      or exists (
        select 1 from public.community_groups visible_group
        where visible_group.id = p.group_id and visible_group.archived_at is null
          and (visible_group.visibility = 'public' or visible_group.id in (select id from viewer_groups))
      )
    )
    and (
      p.post_type <> 'repost'
      or exists (
        select 1 from public.posts source
        join public.profiles source_author on source_author.id = source.author_id
        where source.id = p.repost_of_post_id
          and source.deleted_at is null
          and source.post_type <> 'repost'
          and (
            source.group_id is null
            or exists (
              select 1 from public.community_groups source_group
              where source_group.id = source.group_id and source_group.archived_at is null
                and (source_group.visibility = 'public' or source_group.id in (select id from viewer_groups))
            )
          )
          and (source.author_id = $1 or (
            source_author.account_status = 'active' and source_author.onboarding_completed_at is not null
            and source.author_id not in (select id from viewer_muted_people)
            and not exists (
              select 1 from public.user_blocks source_block
              where (source_block.blocker_id = $1 and source_block.blocked_id = source.author_id)
                 or (source_block.blocker_id = source.author_id and source_block.blocked_id = $1)
            )
          ))
      )
    )
    and not exists (
      select 1 from public.post_hides hidden
      where hidden.user_id = $1 and (hidden.post_id = p.id or hidden.post_id = p.repost_of_post_id)
    )
    and p.author_id not in (select id from viewer_muted_people)
    and (p.company_id is null or p.company_id not in (select id from viewer_muted_orgs))`
}

function poolSql(mode: 'network' | 'explore') {
  if (mode === 'explore') {
    // Anything the viewer may see that is not from their network: weighted-random later, in the app.
    return `
    pool as materialized (
      select p.id from public.posts p
      where p.created_at >= $2 and p.deleted_at is null and p.author_id <> $1
        and p.author_id not in (select id from viewer_connections)
        and p.author_id not in (select id from viewer_followed)
        and (p.company_id is null or p.company_id not in (select id from viewer_followed_orgs))
        and (p.group_id is null or p.group_id not in (select id from viewer_groups))
      order by p.created_at desc
      limit 600
    )`
  }
  return `
    pool as materialized (
      (select p.id from public.posts p
       where p.created_at >= $2 and p.deleted_at is null
         and (
           p.author_id in (select id from viewer_connections)
           or p.author_id in (select id from viewer_followed)
           or p.company_id in (select id from viewer_followed_orgs)
           or p.group_id in (select id from viewer_groups)
           or (p.author_id = $1 and p.post_type <> 'repost' and p.created_at > now() - make_interval(mins => $5))
         )
       order by p.created_at desc
       limit 400)
      union
      (select c.post_id from public.post_comments c
       where c.author_id in (select id from viewer_connections) and c.deleted_at is null and c.created_at >= $2
       order by c.created_at desc
       limit 150)
      union
      (select r.repost_of_post_id from public.posts r
       where r.author_id in (select id from viewer_connections) and r.repost_of_post_id is not null
         and r.deleted_at is null and r.created_at >= $2
       order by r.created_at desc
       limit 100)
      union
      (select p.id from public.posts p
       join public.post_stats s on s.post_id = p.id
       join public.profiles a on a.id = p.author_id
       left join public.maritime_profiles am on am.user_id = a.id
       where p.created_at >= $2 and p.deleted_at is null and p.group_id is null and p.post_type <> 'repost'
         and p.author_id <> $1
         and (
           a.role_department_key = (select role_department_key from public.profiles where id = $1)
           or a.persona = (select persona from public.profiles where id = $1)
           or a.role_key = any((${RANK_BAND_SQL})::text[])
           or am.vessel_type_codes && (select coalesce(vessel_type_codes, '{}') from public.maritime_profiles where user_id = $1)
         )
       order by (s.reactions + 3 * s.comments + 2 * s.reposts) desc, p.created_at desc
       limit 150)
    )`
}

/**
 * Round DB (Option A, owner-approved 12 Nov): the viewer's reactions, comments and direct messages in the last $6 days,
 * counted once per author. It replaces three counts that ran for every candidate row (each re-reading the viewer's own
 * activity: 72% of this query's time, the messages one alone 48%). The same rows are counted: a reaction or comment on
 * a post by that author, and a message the viewer sent in a direct conversation that author is in (both of its
 * members count, so for the viewer's own posts every direct message they sent counts, as before).
 */
export function viewerAuthorEngagementCte() {
  return `
  viewer_author_engagement as materialized (
    select engaged.author_id, sum(engaged.n)::int as total
    from (
      select vp.author_id, count(*) as n
      from public.post_reactions vr join public.posts vp on vp.id = vr.post_id
      where vr.user_id = $1 and vr.created_at > now() - make_interval(days => $6)
      group by vp.author_id
      union all
      select vp.author_id, count(*)
      from public.post_comments vc join public.posts vp on vp.id = vc.post_id
      where vc.author_id = $1 and vc.deleted_at is null and vc.created_at > now() - make_interval(days => $6)
      group by vp.author_id
      union all
      select member.id, count(*)
      from public.messages vm
      join public.conversations conv on conv.id = vm.conversation_id
      cross join lateral (values (conv.direct_user_low_id), (nullif(conv.direct_user_high_id, conv.direct_user_low_id))) as member(id)
      where vm.sender_profile_id = $1 and conv.type = 'direct' and vm.created_at > now() - make_interval(days => $6)
        and member.id is not null
      group by member.id
    ) engaged
    group by engaged.author_id
  )`
}

/** Every candidate column. Engagement and the seen check use the content id (the original of a repost). */
export function candidateSql(mode: 'network' | 'explore') {
  return `
  with ${viewerGraphCtes()},
  ${poolSql(mode)},
  -- Only the pool's few hundred rows go through the visibility rules (never the whole posts table).
  pool_posts as materialized (
    select p.* from pool join public.posts p on p.id = pool.id
  ),
  rank_band as materialized (select ${RANK_BAND_SQL} as codes),
  ${viewerAuthorEngagementCte()}
  select
    p.id,
    coalesce(p.repost_of_post_id, p.id) as content_id,
    p.author_id,
    p.company_id,
    p.group_id,
    coalesce(g.visibility = 'public', true) as group_public,
    p.category::text as category,
    p.post_type::text as post_type,
    p.repost_of_post_id,
    p.created_at,
    char_length(coalesce(content.body, '')) as body_length,
    (btrim(regexp_replace(coalesce(content.body, ''), 'https?://[^[:space:]]+', '', 'g')) = '' and coalesce(content.body, '') ~ 'https?://') as link_only,
    exists (select 1 from public.post_media m where m.post_id = coalesce(p.repost_of_post_id, p.id)) as has_media,
    p.author_id = $1 as is_self,
    p.author_id in (select id from viewer_connections) as is_connection,
    p.author_id in (select id from viewer_followed) as is_followed_person,
    coalesce(p.company_id in (select id from viewer_followed_orgs), false) as is_followed_org,
    coalesce(p.group_id in (select id from viewer_groups), false) as is_my_community,
    second_degree.actor_id is not null as second_degree,
    second_degree.actor_id as second_degree_actor_id,
    coalesce(s.reactions, 0) as reactions,
    coalesce(s.comments, 0) as comments,
    coalesce(s.reposts, 0) as reposts,
    (
      (select count(*) from public.post_reactions cr where cr.post_id = coalesce(p.repost_of_post_id, p.id) and cr.user_id in (select id from viewer_connections))
      + (select count(*) from public.post_comments cc where cc.post_id = coalesce(p.repost_of_post_id, p.id) and cc.deleted_at is null and cc.author_id in (select id from viewer_connections))
    )::int as connection_engagement,
    (
      select count(*) from public.post_reactions sr
      join public.profiles reactor on reactor.id = sr.user_id
      where sr.post_id = coalesce(p.repost_of_post_id, p.id)
        and sr.created_at > now() - interval '7 days'
        and sr.user_id <> $1
        and (reactor.role_key = any((select codes from rank_band)::text[]) or reactor.role_department_key = (select role_department_key from public.profiles where id = $1))
    )::int as similar_engagement,
    author.full_name as author_name,
    post_company.name as company_name,
    g.name as group_name,
    actor_profile.full_name as second_degree_actor_name,
    author.role_key as author_role_key,
    author.role_department_key as author_department_key,
    author.persona as author_persona,
    coalesce(author_maritime.vessel_type_codes, '{}') as author_vessel_codes,
    coalesce(author_maritime.trading_areas, '{}') as author_trading_areas,
    author_maritime.current_company_id as author_company_id,
    greatest(0, extract(epoch from (now() - author.created_at)) / 86400)::int as author_account_age_days,
    (select count(*) from public.posts recent where recent.author_id = p.author_id and recent.created_at > now() - interval '1 day' and recent.deleted_at is null)::int as author_posts_last_day,
    coalesce(viewer_author.total, 0)::int as viewer_engagement_with_author,
    exists (select 1 from public.feed_feedback f where f.viewer_id = $1 and f.author_id = p.author_id and p.company_id is null) as show_less_author,
    exists (select 1 from public.feed_feedback f where f.viewer_id = $1 and f.company_id = p.company_id) as show_less_company,
    exists (select 1 from public.feed_feedback f where f.viewer_id = $1 and f.category = p.category::text and f.created_at > now() - interval '30 days') as show_less_category,
    exists (
      select 1 from public.content_reports report
      where report.target_type = 'post' and report.target_id in (p.id, coalesce(p.repost_of_post_id, p.id))
        and report.status in ('open', 'reviewing')
    ) as pending_report,
    (select count(*) from public.posts rp where rp.repost_of_post_id = coalesce(p.repost_of_post_id, p.id) and rp.deleted_at is null)::int as repost_count
  from pool_posts p
  join public.posts content on content.id = coalesce(p.repost_of_post_id, p.id)
  join public.profiles author on author.id = p.author_id
  left join public.maritime_profiles author_maritime on author_maritime.user_id = p.author_id
  left join public.community_groups g on g.id = p.group_id
  left join public.companies post_company on post_company.id = p.company_id
  left join public.post_stats s on s.post_id = coalesce(p.repost_of_post_id, p.id)
  -- One row per author (grouped), so this never adds rows.
  left join viewer_author_engagement viewer_author on viewer_author.author_id = p.author_id
  left join lateral (
    select actor.id as actor_id
    from (
      select c.author_id as id, c.created_at from public.post_comments c
      where c.post_id = coalesce(p.repost_of_post_id, p.id) and c.deleted_at is null and c.author_id in (select id from viewer_connections)
      union all
      select r.author_id, r.created_at from public.posts r
      where r.repost_of_post_id = coalesce(p.repost_of_post_id, p.id) and r.deleted_at is null and r.author_id in (select id from viewer_connections)
    ) actor
    order by actor.created_at desc
    limit 1
  ) second_degree on true
  left join public.profiles actor_profile on actor_profile.id = second_degree.actor_id
  where ${candidateVisibilitySql()}
    and (
      (p.author_id = $1 and p.created_at > now() - make_interval(mins => $5))
      or coalesce(p.repost_of_post_id, p.id) not in (select id from viewer_seen where id is not null)
    )
    and (p.author_id <> $1 or p.created_at > now() - make_interval(mins => $5))
    and not (coalesce(p.repost_of_post_id, p.id) = any($3::uuid[]))
  order by p.created_at desc
  limit $4`
}

function toDate(value: unknown) {
  return value instanceof Date ? value : new Date(String(value))
}

function textArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

export function mapCandidate(row: Record<string, unknown>): FeedCandidate {
  return {
    id: String(row.id),
    contentId: String(row.content_id),
    authorId: String(row.author_id),
    companyId: row.company_id ? String(row.company_id) : null,
    groupId: row.group_id ? String(row.group_id) : null,
    groupPublic: row.group_public !== false,
    category: String(row.category),
    postType: String(row.post_type),
    repostOfPostId: row.repost_of_post_id ? String(row.repost_of_post_id) : null,
    createdAt: toDate(row.created_at),
    bodyLength: Number(row.body_length ?? 0),
    linkOnly: row.link_only === true,
    hasMedia: row.has_media === true,
    isSelf: row.is_self === true,
    isConnection: row.is_connection === true,
    isFollowedPerson: row.is_followed_person === true,
    isFollowedOrg: row.is_followed_org === true,
    isMyCommunity: row.is_my_community === true,
    secondDegree: row.second_degree === true,
    secondDegreeActorId: row.second_degree_actor_id ? String(row.second_degree_actor_id) : null,
    authorName: String(row.author_name ?? ''),
    companyName: row.company_name ? String(row.company_name) : null,
    groupName: row.group_name ? String(row.group_name) : null,
    secondDegreeActorName: row.second_degree_actor_name ? String(row.second_degree_actor_name) : null,
    reactions: Number(row.reactions ?? 0),
    comments: Number(row.comments ?? 0),
    reposts: Number(row.reposts ?? 0),
    connectionEngagement: Number(row.connection_engagement ?? 0),
    similarEngagement: Number(row.similar_engagement ?? 0),
    authorRoleKey: row.author_role_key ? String(row.author_role_key) : null,
    authorDepartmentKey: row.author_department_key ? String(row.author_department_key) : null,
    authorPersona: row.author_persona ? String(row.author_persona) : null,
    authorVesselCodes: textArray(row.author_vessel_codes),
    authorTradingAreas: textArray(row.author_trading_areas),
    authorCompanyId: row.author_company_id ? String(row.author_company_id) : null,
    authorAccountAgeDays: Number(row.author_account_age_days ?? 0),
    authorPostsLastDay: Number(row.author_posts_last_day ?? 0),
    viewerEngagementWithAuthor: Number(row.viewer_engagement_with_author ?? 0),
    showLessAuthor: row.show_less_author === true,
    showLessCompany: row.show_less_company === true,
    showLessCategory: row.show_less_category === true,
    pendingReport: row.pending_report === true,
    repostCount: Number(row.repost_count ?? 0),
  }
}

export function createFeedCandidateRepository(input: { query?: Query } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery(text, values))

  async function listCandidates(options: CandidateOptions): Promise<FeedCandidate[]> {
    const mode = options.mode ?? 'network'
    const since = new Date(Date.now() - options.windowDays * 86_400_000)
    const rows = await queryRows(candidateSql(mode), [
      options.viewerId,
      since.toISOString(),
      [...(options.excludeContentIds ?? [])],
      options.limit ?? FEED_WEIGHTS.candidates.maxCandidates,
      FEED_WEIGHTS.candidates.ownPostPinMinutes,
      FEED_WEIGHTS.relationship.recentEngagementDays,
    ])
    return rows.map(mapCandidate)
  }

  async function getViewerProfile(viewerId: string): Promise<FeedViewerProfile | null> {
    const rows = await queryRows(
      `select p.id, p.role_key, p.role_department_key, p.persona, coalesce(p.profile_intents, '{}') as intents, p.created_at,
              coalesce(mp.vessel_type_codes, '{}') as vessel_codes, coalesce(mp.trading_areas, '{}') as trading_areas,
              mp.current_company_id,
              (
                (select count(*) from public.connections c where (c.user_low_id = p.id or c.user_high_id = p.id) and c.status = 'accepted')
                + (select count(*) from public.follows f where f.follower_id = p.id)
                + (select count(*) from public.organization_follows o where o.follower_id = p.id)
                + (select count(*) from public.community_group_memberships m where m.profile_id = p.id and m.status = 'active')
              )::int as graph_size,
              (
                (select count(*) from public.post_reactions r where r.user_id = p.id)
                + (select count(*) from public.post_comments c where c.author_id = p.id and c.deleted_at is null)
              )::int as engagement_count,
              coalesce((
                select json_object_agg(category, total) from (
                  select engaged.category::text as category, count(*)::int as total
                  from (
                    select ep.category from public.post_reactions er join public.posts ep on ep.id = er.post_id
                    where er.user_id = p.id and er.created_at > now() - make_interval(days => $2)
                    union all
                    select ep.category from public.post_comments ec join public.posts ep on ep.id = ec.post_id
                    where ec.author_id = p.id and ec.deleted_at is null and ec.created_at > now() - make_interval(days => $2)
                  ) engaged
                  group by engaged.category
                ) totals
              ), '{}'::json) as category_affinity
       from public.profiles p
       left join public.maritime_profiles mp on mp.user_id = p.id
       where p.id = $1`,
      [viewerId, FEED_WEIGHTS.relevance.affinityDays],
    )
    const row = rows[0]
    if (!row) return null
    const affinity = (row.category_affinity && typeof row.category_affinity === 'object' ? row.category_affinity : {}) as Record<string, number>
    return {
      id: String(row.id),
      roleKey: row.role_key ? String(row.role_key) : null,
      departmentKey: row.role_department_key ? String(row.role_department_key) : null,
      persona: row.persona ? String(row.persona) : null,
      intents: textArray(row.intents),
      vesselCodes: textArray(row.vessel_codes),
      tradingAreas: textArray(row.trading_areas),
      companyId: row.current_company_id ? String(row.current_company_id) : null,
      createdAt: row.created_at ? toDate(row.created_at) : null,
      graphSize: Number(row.graph_size ?? 0),
      engagementCount: Number(row.engagement_count ?? 0),
      categoryAffinity: Object.fromEntries(Object.entries(affinity).map(([key, value]) => [key, Number(value)])),
    }
  }

  /**
   * "N new posts": how many unseen posts from the viewer's network arrived after `since`. One cheap
   * count with the same visibility, mute and seen rules; it never builds a page.
   */
  async function countNewPosts(viewerId: string, since: Date): Promise<number> {
    const rows = await queryRows(
      `with ${viewerGraphCtes()}
       select count(*)::int as total
       from public.posts p
       join public.profiles author on author.id = p.author_id
       where p.created_at > $2 and p.author_id <> $1
         and (
           p.author_id in (select id from viewer_connections)
           or p.author_id in (select id from viewer_followed)
           or p.company_id in (select id from viewer_followed_orgs)
           or p.group_id in (select id from viewer_groups)
         )
         and ${candidateVisibilitySql()}
         and coalesce(p.repost_of_post_id, p.id) not in (select id from viewer_seen where id is not null)`,
      [viewerId, since.toISOString()],
    )
    return Number(rows[0]?.total ?? 0)
  }

  return { listCandidates, getViewerProfile, countNewPosts }
}

export const feedCandidateRepository = createFeedCandidateRepository()
