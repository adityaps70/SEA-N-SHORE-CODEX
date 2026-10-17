import type { QueryResultRow } from 'pg'
import { withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { planVisibleSql } from '@/features/billing/plan-visibility'
import { listableOrganizationSql } from '@/features/profiles/organization-link-repository'
import { matchRank, matchVesselType } from '@/features/taxonomy/maritime-taxonomy'
import { SEARCH_KINDS, SEARCH_WEIGHTS, SEARCH_WEIGHTS_VERSION, normaliseSearchQuery, type SearchKind } from './search-weights'
import { displayName } from '@/features/profiles/display-name'

/**
 * Round G (G4): one SQL statement per keystroke over public.search_documents.
 * Relevance: exact name, then name starts with the query, then a typo match on the name (pg_trgm
 * word similarity), then full text over everything else (rank and vessel synonyms through code
 * tokens: "2/O", "C/E", "ETO", "VLCC"). One character is prefix only.
 * Then, inside the same statement: every candidate is re-checked against its source table's own
 * visibility rule (open jobs, listable organizations, published courses, upcoming events, the
 * feed's post rules), blocked members never appear in either direction, and people get the
 * connection, 2nd-degree, verified and recently-active boosts. Ties keep a stable order (newest
 * first for posts, then id), so pages never overlap.
 */
type Row = QueryResultRow & Record<string, unknown>
type Query = (text: string, values?: readonly unknown[], name?: string) => Promise<Row[]>
type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>

export type SearchHit = {
  kind: SearchKind
  id: string
  name: string
  subtitle: string | null
  avatarPath: string | null
  slug: string | null
  ownerId: string | null
  score: number
  createdAt: string | null
  /** People: the viewer's connection, for the result row's button. */
  connected?: boolean
}

export type SearchRequest = {
  viewerId: string
  query: string
  /** Results per kind (0 or missing = that kind is not searched). */
  limits: Partial<Record<SearchKind, number>>
  /** Skip this many per kind (pagination of one vertical). */
  offset?: number
  /** The dropdown matches names and rank or vessel synonyms only; the full page adds full text. */
  fullText?: boolean
}

export type SearchTerms = {
  normalized: string
  prefixPattern: string
  fuzzy: boolean
  simpleQuery: string
  englishQuery: string
  /** Round H (H7): the rank synonym tokens alone ("rkchiefengineer"), for the rank tier. */
  rankQuery: string
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

/** Query text to the pieces the SQL needs. Tokens are [a-z0-9] only, so tsquery text is always safe. */
export function searchTerms(raw: string, options: { fullText?: boolean } = {}): SearchTerms {
  const normalized = normaliseSearchQuery(raw)
  const tokens = normalized.split(' ').filter(Boolean).slice(0, 8)
  const compact = normalized.replace(/\s/g, '').length
  const synonym = Boolean(matchRank(raw) ?? matchRank(normalized) ?? matchVesselType(raw) ?? matchVesselType(normalized))
  // A short rank or vessel code ("2/O", "C/E", "ETO") is matched through its synonym tokens, not by typo.
  const fuzzy = compact >= SEARCH_WEIGHTS.fuzzyFromChars && !(synonym && compact <= 4)
  const prefixed = tokens.map((token, index) => (index === tokens.length - 1 ? `${token}:*` : token)).join(' & ')
  const synonyms = [matchRank(raw), matchRank(normalized)].filter((code): code is string => Boolean(code)).map((code) => `rk${code.replace(/_/g, '')}`)
  const vessel = matchVesselType(raw) ?? matchVesselType(normalized)
  if (vessel) synonyms.push(`vt${vessel.replace(/_/g, '')}`)
  // Full text (and the synonym tokens) from 3 characters; 2 characters match names only.
  const fullText = options.fullText !== false && normalized.replace(/\s/g, '').length >= SEARCH_WEIGHTS.fullTextFromChars && tokens.length > 0
  const simpleQuery = fullText ? [`(${prefixed})`, ...new Set(synonyms)].join(' | ') : (synonyms.length ? [...new Set(synonyms)].join(' | ') : '')
  const rankQuery = [...new Set(synonyms.filter((token) => token.startsWith('rk')))].join(' | ')
  return { normalized, prefixPattern: `${escapeLike(normalized)}%`, fuzzy, simpleQuery, englishQuery: fullText ? prefixed : '', rankQuery }
}

const JOB_OPEN = `j.status = 'published' and j.deleted_at is null and ${planVisibleSql('job', 'j')} and (j.apply_until is null or j.apply_until >= current_date)`
const COURSE_OPEN = `course.status = 'published' and course.removed_at is null and course.is_discoverable = true and ${planVisibleSql('course', 'course')}
  and ((course.company_id is null and exists (
          select 1 from public.learning_mentors mentor
          join public.learning_mentor_applications application on application.user_id = mentor.user_id and application.status = 'approved'
          where mentor.id = course.mentor_id and mentor.status = 'active'))
       or (course.company_id is not null and exists (select 1 from public.companies course_company where course_company.id = course.company_id and course_company.is_verified = true)))`
const EVENT_OPEN = `e.status = 'published' and e.removed_at is null and e.end_at > now() and ${planVisibleSql('event', 'e')}`

/** The feed's post rules (deleted, author active, blocks both ways, private communities, hides, mutes). */
const POST_VISIBLE = `p.deleted_at is null
  and (p.author_id = $1 or (author.account_status = 'active' and author.onboarding_completed_at is not null))
  and (p.group_id is null or exists (
    select 1 from public.community_groups visible_group
    where visible_group.id = p.group_id and visible_group.archived_at is null
      and (visible_group.visibility = 'public' or exists (
        select 1 from public.community_group_memberships membership
        where membership.group_id = visible_group.id and membership.profile_id = $1 and membership.status = 'active'))))
  and not exists (select 1 from public.post_hides hidden where hidden.user_id = $1 and hidden.post_id = p.id)
  and not exists (select 1 from public.user_mutes muted where muted.viewer_id = $1
    and (muted.muted_profile_id = p.author_id or (p.company_id is not null and muted.muted_org_id = p.company_id)))`

/** The search statement with only the branches this query needs (Postgres cannot skip a LATERAL branch by itself). */
export function searchSql(branches: { fuzzy: boolean; fullText: boolean }) {
  return `
with terms as (
  select $2::text as norm, $3::text as prefix, $4::boolean as fuzzy,
         case when $5::text = '' then null else to_tsquery('simple', $5::text) end as q_simple,
         case when $6::text = '' then null else to_tsquery('english', $6::text) end as q_english,
         case when $21::text = '' then null else to_tsquery('simple', $21::text) end as q_rank,
         $22::real as rank_tier
),
limits as (select key as kind, value::int as n from jsonb_each_text($7::jsonb) where value::int > 0),
blocked as (
  select blocked_id as id from public.user_blocks where blocker_id = $1
  union select blocker_id from public.user_blocks where blocked_id = $1
),
viewer_connections as (
  select case when c.user_low_id = $1 then c.user_high_id else c.user_low_id end as id
  from public.connections c
  where c.status = 'accepted' and (c.user_low_id = $1 or c.user_high_id = $1)
),
matched as (
  -- Keys and a cheap tier only (ts_rank waits for the shortlist). Each branch is bounded per kind,
  -- so a one-letter query or a very common word never scans more than the cap.
  select kind, entity_id, owner_id, source_created_at, max(tier) as tier
  from (
    -- Exact name and name starts with the query: index order, stops at the cap.
    select d.kind, d.entity_id, d.owner_id, d.source_created_at,
      case when d.normalized_name = t.norm then $9::real else $10::real end as tier
    from limits l
    cross join terms t
    cross join lateral (
      select d.kind, d.entity_id, d.owner_id, d.source_created_at, d.normalized_name
      from public.search_documents d
      where d.visibility <> 'hidden' and d.kind = l.kind and d.normalized_name <> '' and d.normalized_name like t.prefix
      order by d.normalized_name
      limit l.n + $8::int + ${SEARCH_WEIGHTS.candidatesPerKind}
    ) d
    ${branches.fuzzy ? `union all
    -- Typos on the name.
    select d.kind, d.entity_id, d.owner_id, d.source_created_at, $11::real + word_similarity(t.norm, d.normalized_name) * $13::real
    from limits l
    cross join terms t
    cross join lateral (
      select d.kind, d.entity_id, d.owner_id, d.source_created_at, d.normalized_name
      from public.search_documents d
      where t.fuzzy and d.visibility <> 'hidden' and d.kind = l.kind and d.normalized_name <> '' and t.norm <% d.normalized_name
      order by word_similarity(t.norm, d.normalized_name) desc, d.entity_id
      limit l.n + $8::int + ${SEARCH_WEIGHTS.candidatesPerKind}
    ) d` : ''}
    union all
    -- The viewer's own connections are always considered, however common their name is.
    select d.kind, d.entity_id, d.owner_id, d.source_created_at,
      case when d.normalized_name = t.norm then $9::real when d.normalized_name like t.prefix then $10::real
           else $11::real + word_similarity(t.norm, d.normalized_name) * $13::real end
    from viewer_connections vc
    cross join terms t
    join public.search_documents d on d.kind = 'person' and d.entity_id = vc.id
    where exists (select 1 from limits where kind = 'person') and d.visibility <> 'hidden'
      and (d.normalized_name like t.prefix or (t.fuzzy and t.norm <% d.normalized_name))
    ${branches.fullText ? `union all
    -- Full text (headlines, descriptions, posts) and rank or vessel synonym tokens; newest first.
    -- Round H (H7): a rank or title match (the person's or job's rank is the one the query names, or the
    -- person's headline starts with the query) takes the rank tier and is kept first in the candidate cap.
    select d.kind, d.entity_id, d.owner_id, d.source_created_at, d.tier
    from limits l
    cross join terms t
    cross join lateral (
      select d.kind, d.entity_id, d.owner_id, d.source_created_at,
        case when (t.q_rank is not null and d.tsv @@ t.q_rank)
               or (d.kind = 'person' and d.subtitle is not null and public.taxonomy_normalize(d.subtitle) like t.prefix)
             then t.rank_tier else $12::real end as tier
      from public.search_documents d
      where (t.q_simple is not null or t.q_english is not null) and d.visibility <> 'hidden' and d.kind = l.kind
        and ((t.q_simple is not null and d.tsv @@ t.q_simple) or (t.q_english is not null and d.tsv @@ t.q_english))
      order by tier desc, d.source_created_at desc nulls last, d.entity_id
      limit l.n + $8::int + ${SEARCH_WEIGHTS.candidatesPerKind}
    ) d` : ''}
  ) branches
  group by kind, entity_id, owner_id, source_created_at
),
capped as materialized (
  select d.kind, d.entity_id, d.display_name, d.subtitle, d.avatar_path, d.slug, d.owner_id, d.org_id, d.popularity, d.source_created_at,
    shortlist.tier + case when shortlist.tier = $12::real
      then coalesce(ts_rank(d.tsv, coalesce(t.q_simple, ''::tsquery) || coalesce(t.q_english, ''::tsquery)), 0) * $14::real else 0 end as relevance
  from (
    select ranked_match.* from (
      select m.*, row_number() over (partition by m.kind order by m.tier desc, m.source_created_at desc nulls last, m.entity_id) as candidate_rank
      from matched m
    ) ranked_match
    join limits l on l.kind = ranked_match.kind
    where ranked_match.candidate_rank <= l.n + $8::int + ${SEARCH_WEIGHTS.candidatesPerKind}
  ) shortlist
  join public.search_documents d on d.kind = shortlist.kind and d.entity_id = shortlist.entity_id
  cross join terms t
),
visible as materialized (
  select c.* from capped c
  where (c.owner_id is null or c.owner_id not in (select id from blocked))
    and case c.kind
      when 'person' then exists (select 1 from public.profiles person where person.id = c.entity_id and person.account_status = 'active' and person.onboarding_completed_at is not null)
      when 'org' then exists (select 1 from public.companies org where org.id = c.entity_id and ${listableOrganizationSql('org')})
      when 'community' then exists (select 1 from public.community_groups g where g.id = c.entity_id and g.archived_at is null)
      when 'job' then exists (select 1 from public.jobs j where j.id = c.entity_id and ${JOB_OPEN})
      when 'course' then exists (select 1 from public.learning_courses course where course.id = c.entity_id and ${COURSE_OPEN})
      when 'event' then exists (select 1 from public.events e where e.id = c.entity_id and ${EVENT_OPEN})
      when 'post' then exists (
        select 1 from public.posts p join public.profiles author on author.id = p.author_id
        where p.id = c.entity_id and ${POST_VISIBLE})
      else false
    end
),
scored as materialized (
  select v.*,
    v.relevance
      + least(ln(1 + greatest(v.popularity, 0)), $15::real)
      + case when v.kind = 'person' and exists (
          select 1 from public.connections cn
          where cn.status = 'accepted' and cn.user_low_id = least($1::uuid, v.entity_id) and cn.user_high_id = greatest($1::uuid, v.entity_id)) then $16::real else 0 end
      + case when v.kind = 'person' and exists (
          select 1 from public.connections mine
          join public.connections theirs on theirs.status = 'accepted'
            and (theirs.user_low_id = case when mine.user_low_id = $1 then mine.user_high_id else mine.user_low_id end
              or theirs.user_high_id = case when mine.user_low_id = $1 then mine.user_high_id else mine.user_low_id end)
            and (theirs.user_low_id = v.entity_id or theirs.user_high_id = v.entity_id)
          where mine.status = 'accepted' and (mine.user_low_id = $1 or mine.user_high_id = $1)) then $17::real else 0 end
      + case when v.kind = 'person' and exists (
          select 1 from public.feature_verifications fv where fv.profile_id = v.entity_id and fv.status = 'approved') then $18::real else 0 end
      + case when v.kind = 'person' and exists (
          select 1 from public.posts recent where recent.author_id = v.entity_id and recent.deleted_at is null
            and recent.created_at > now() - make_interval(days => $19::int)) then $20::real else 0 end
      as score,
    v.kind = 'person' and exists (
      select 1 from public.connections cn
      where cn.status = 'accepted' and cn.user_low_id = least($1::uuid, v.entity_id) and cn.user_high_id = greatest($1::uuid, v.entity_id)) as connected
  from visible v
),
ranked as (
  select s.*, row_number() over (partition by s.kind order by s.score desc, s.source_created_at desc nulls last, s.entity_id) as position
  from scored s
)
select r.kind, r.entity_id, r.display_name, r.subtitle, r.avatar_path, r.slug, r.owner_id, r.score, r.source_created_at, r.connected
from ranked r
join limits l on l.kind = r.kind
where r.position > $8::int and r.position <= $8::int + l.n
order by r.kind, r.position`
}

function runtimeTransaction<T>(work: (query: Query) => Promise<T>) {
  return databaseTransaction((client: DatabaseQueryClient) => work(async (text, values, name) => (await client.query(text, values ? [...values] : undefined, name)).rows as Row[]))
}

export class SearchTimeoutError extends Error {
  constructor() {
    super('search_timeout')
  }
}

export function createSearchRepository(input: { transaction?: Transaction; statementTimeoutMs?: number } = {}) {
  const transaction = input.transaction ?? runtimeTransaction
  const timeout = input.statementTimeoutMs ?? SEARCH_WEIGHTS.statementTimeoutMs

  async function search(request: SearchRequest): Promise<SearchHit[]> {
    const terms = searchTerms(request.query, { fullText: request.fullText !== false })
    const limits = Object.fromEntries(SEARCH_KINDS.flatMap((kind) => {
      const n = Math.max(0, Math.min(Math.trunc(request.limits[kind] ?? 0), 50))
      return n ? [[kind, n]] : []
    }))
    if (!terms.normalized || !Object.keys(limits).length) return []
    const W = SEARCH_WEIGHTS
    try {
      return await transaction(async (query) => {
        await query(
          // JIT compiling this statement costs ~300 ms, far more than running it; never worth it here.
          `select set_config('statement_timeout', $1, true), set_config('pg_trgm.word_similarity_threshold', $2, true), set_config('jit', 'off', true), set_config('plan_cache_mode', 'force_generic_plan', true)`,
          [String(timeout), String(W.wordSimilarityThreshold)],
        )
        const branches = { fuzzy: terms.fuzzy, fullText: Boolean(terms.simpleQuery || terms.englishQuery) }
        // Planning this statement costs more than running it, so each variant is a prepared statement
        // (planned once per pooled connection, generic plan).
        const rows = await query(searchSql(branches), [
          request.viewerId, terms.normalized, terms.prefixPattern, terms.fuzzy, terms.simpleQuery, terms.englishQuery,
          JSON.stringify(limits), Math.max(0, Math.trunc(request.offset ?? 0)),
          W.tiers.exact, W.tiers.prefix, W.tiers.trigram, W.tiers.fullText, W.trigramScale, W.fullTextScale,
          W.popularityCap, W.boosts.connection, W.boosts.secondDegree, W.boosts.verified, W.recentlyActiveDays, W.boosts.recentlyActive,
          terms.rankQuery, W.tiers.rank,
        ], `search_${SEARCH_WEIGHTS_VERSION.replace(/[^a-z0-9]/gi, '_')}_${branches.fuzzy ? 'f' : 'n'}${branches.fullText ? 't' : 'n'}`)
        return rows.map((row) => ({
          kind: row.kind as SearchKind,
          id: String(row.entity_id),
          // Round H (H7): people's names with smart capitalisation (stored as typed).
          name: row.kind === 'person' ? displayName(String(row.display_name ?? '')) : String(row.display_name ?? ''),
          subtitle: (row.subtitle as string | null) ?? null,
          avatarPath: (row.avatar_path as string | null) ?? null,
          slug: (row.slug as string | null) ?? null,
          ownerId: (row.owner_id as string | null) ?? null,
          score: Number(row.score),
          createdAt: row.source_created_at ? new Date(row.source_created_at as string).toISOString() : null,
          ...(row.kind === 'person' ? { connected: row.connected === true } : {}),
        }))
      })
    } catch (error) {
      if ((error as { code?: string })?.code === '57014') throw new SearchTimeoutError()
      throw error
    }
  }

  return { search }
}

export const searchRepository = createSearchRepository()
