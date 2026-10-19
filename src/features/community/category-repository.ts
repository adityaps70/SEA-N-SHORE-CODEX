import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { groupSlugFromName, uniqueGroupSlug } from './slug'
import {
  COMMUNITY_CATEGORY_DESCRIPTION_MAX_LENGTH,
  COMMUNITY_CATEGORY_NAME_MAX_LENGTH,
  GROUP_ICON_NAMES,
  type CommunityCategoryChip,
  type CommunityCategoryRecord,
  type CommunityCategoryRef,
} from './types'

/**
 * Round I (I2): the admin-managed community categories (public.community_categories, migration 0093).
 *
 * Every change runs in one transaction with its audit_events row (target_type 'community_category'). A category in
 * use is never deleted: delete refuses while any community (live or archived) has it, and the foreign key refuses
 * too. "Move its communities to…" moves them first, as its own audited step. Names are unique ignoring case; the
 * slug is made from the name when the category is created and then stays, so links keep working after a rename.
 */
type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>

function runtimeTransaction<T>(work: (query: Query) => Promise<T>) {
  return databaseTransaction((client: DatabaseQueryClient) => work(async (text, values) => (await client.query(text, values ? [...values] : undefined)).rows))
}

export type CategoryErrorCode =
  | 'category_name_invalid'
  | 'category_name_taken'
  | 'category_description_invalid'
  | 'category_icon_invalid'
  | 'category_not_found'
  | 'category_in_use'
  | 'category_move_target_invalid'

export class CommunityCategoryError extends Error {
  constructor(readonly code: CategoryErrorCode) {
    super(code)
    this.name = 'CommunityCategoryError'
  }
}

export type CategoryFields = { name: string; description?: string | null; icon?: string | null }

/** The slug made from a new category's name: lower-case letters, digits and single hyphens, at most 50 characters. */
export function categorySlugFromName(name: string) {
  return groupSlugFromName(name).slice(0, 50).replace(/-+$/g, '')
}

/** Trims and checks a name, description and icon; throws CommunityCategoryError with the first problem. */
export function normalizeCategoryFields(fields: CategoryFields) {
  const name = fields.name.replace(/\s+/g, ' ').trim()
  if (name.length < 1 || name.length > COMMUNITY_CATEGORY_NAME_MAX_LENGTH) throw new CommunityCategoryError('category_name_invalid')
  if (!/[\p{L}\p{N}]/u.test(name)) throw new CommunityCategoryError('category_name_invalid')
  const description = fields.description?.replace(/\s+/g, ' ').trim() || null
  if (description && description.length > COMMUNITY_CATEGORY_DESCRIPTION_MAX_LENGTH) throw new CommunityCategoryError('category_description_invalid')
  const icon = fields.icon?.trim() || null
  if (icon && !(GROUP_ICON_NAMES as readonly string[]).includes(icon)) throw new CommunityCategoryError('category_icon_invalid')
  return { name, description, icon }
}

type CategoryRow = QueryResultRow & {
  id: string
  slug: string
  name: string
  description: string | null
  icon: string | null
  position: number | string
  hidden_at: string | Date | null
  community_count?: number | string
  live_count?: number | string
}

function refOf(row: CategoryRow): CommunityCategoryRef {
  return { id: row.id, slug: row.slug, name: row.name, icon: row.icon, hidden: row.hidden_at !== null && row.hidden_at !== undefined }
}

const ORDER = 'order by c.position, lower(c.name), c.id'

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === '23505'
}

export function createCommunityCategoryRepository(input: { query?: Query; transaction?: Transaction } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction = input.transaction ?? runtimeTransaction

  async function audit(query: Query, actorId: string, action: string, categoryId: string, metadata: Record<string, unknown>) {
    await query(
      `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
       values ($1, $2, 'community_category', $3, $4::jsonb)`,
      [actorId, action, categoryId, JSON.stringify(metadata)],
    )
  }

  async function lockCategory(query: Query, categoryId: string) {
    const rows = await query(
      `select id, slug, name, description, icon, position, hidden_at from public.community_categories where id = $1 for update`,
      [categoryId],
    ) as CategoryRow[]
    if (!rows[0]) throw new CommunityCategoryError('category_not_found')
    return rows[0]
  }

  /** Admin › Communities › Categories: every category in admin order, with how many communities use it. */
  async function listAll(): Promise<CommunityCategoryRecord[]> {
    const rows = await queryRows(
      `select c.id, c.slug, c.name, c.description, c.icon, c.position, c.hidden_at,
              (select count(*) from public.community_groups g where g.category_id = c.id)::int as community_count
       from public.community_categories c
       ${ORDER}`,
    ) as CategoryRow[]
    return rows.map((row) => ({ ...refOf(row), description: row.description, position: Number(row.position), communityCount: Number(row.community_count ?? 0) }))
  }

  /** The community create and edit picker: shown categories in admin order. */
  async function listPickerOptions(): Promise<CommunityCategoryRef[]> {
    const rows = await queryRows(
      `select c.id, c.slug, c.name, c.description, c.icon, c.position, c.hidden_at
       from public.community_categories c
       where c.hidden_at is null
       ${ORDER}`,
    ) as CategoryRow[]
    return rows.map(refOf)
  }

  /**
   * Directory chips and "Browse by category": shown categories with at least one live community, in admin order.
   * Private communities count too: the directory lists them (it never shows their posts).
   */
  async function listDirectoryChips(): Promise<CommunityCategoryChip[]> {
    const rows = await queryRows(
      `select c.id, c.slug, c.name, c.description, c.icon, c.position, c.hidden_at, count(g.id)::int as live_count
       from public.community_categories c
       join public.community_groups g on g.category_id = c.id and g.archived_at is null
       where c.hidden_at is null
       group by c.id
       ${ORDER}`,
    ) as CategoryRow[]
    return rows.map((row) => ({ ...refOf(row), count: Number(row.live_count ?? 0) }))
  }

  /** A category by its slug, or by the old fixed value (maritime_news, ..., other) for links made before 0093. */
  async function findBySlug(slug: string): Promise<CommunityCategoryRef | null> {
    const rows = await queryRows(
      `select c.id, c.slug, c.name, c.description, c.icon, c.position, c.hidden_at
       from public.community_categories c
       where c.slug = $1 or c.legacy_key = $1
       order by (c.slug = $1) desc
       limit 1`,
      [slug],
    ) as CategoryRow[]
    return rows[0] ? refOf(rows[0]) : null
  }

  /**
   * True when a community may be given this category: a shown category, or the one it already has (a hidden
   * category stays on its communities and saving the community keeps it).
   */
  async function canAssign(categoryId: string, currentCategoryId: string | null = null) {
    if (categoryId === currentCategoryId) return true
    const rows = await queryRows(`select 1 from public.community_categories where id = $1 and hidden_at is null`, [categoryId])
    return rows.length === 1
  }

  async function create(actorId: string, fields: CategoryFields): Promise<CommunityCategoryRef> {
    const { name, description, icon } = normalizeCategoryFields(fields)
    const base = categorySlugFromName(name)
    try {
      return await transaction(async (query) => {
        const taken = await query(`select slug from public.community_categories where slug = $1 or slug like $2`, [base, `${base}-%`])
        const slug = uniqueGroupSlug(base, taken.map((row) => String(row.slug)))
        const rows = await query(
          `insert into public.community_categories (slug, name, description, icon, position, created_by)
           values ($1, $2, $3, $4, coalesce((select max(position) from public.community_categories), 0) + 10, $5)
           returning id, slug, name, description, icon, position, hidden_at`,
          [slug, name, description, icon, actorId],
        ) as CategoryRow[]
        const row = rows[0]!
        await audit(query, actorId, 'community.category_created', row.id, { name, slug, description, icon })
        return refOf(row)
      })
    } catch (error) {
      if (isUniqueViolation(error)) throw new CommunityCategoryError('category_name_taken')
      throw error
    }
  }

  /** Rename, and change the short description and icon. The slug stays. */
  async function update(actorId: string, categoryId: string, fields: CategoryFields) {
    const next = normalizeCategoryFields(fields)
    try {
      await transaction(async (query) => {
        const previous = await lockCategory(query, categoryId)
        await query(
          `update public.community_categories set name = $2, description = $3, icon = $4, updated_at = now() where id = $1`,
          [categoryId, next.name, next.description, next.icon],
        )
        await audit(query, actorId, previous.name === next.name ? 'community.category_updated' : 'community.category_renamed', categoryId, {
          previous: { name: previous.name, description: previous.description, icon: previous.icon },
          next,
        })
      })
    } catch (error) {
      if (isUniqueViolation(error)) throw new CommunityCategoryError('category_name_taken')
      throw error
    }
  }

  /**
   * Puts the categories in this order (every category id, each once). Positions are renumbered 10, 20, 30...
   * Used by drag and drop and by the up and down buttons.
   */
  async function reorder(actorId: string, orderedIds: readonly string[]) {
    await transaction(async (query) => {
      const rows = await query(`select c.id, c.name from public.community_categories c ${ORDER} for update`)
      const current = rows.map((row) => String(row.id))
      if (orderedIds.length !== current.length || new Set(orderedIds).size !== current.length || orderedIds.some((id) => !current.includes(id))) {
        throw new CommunityCategoryError('category_not_found')
      }
      if (orderedIds.every((id, index) => id === current[index])) return
      await query(
        `update public.community_categories c
         set position = (ordered.position * 10)::int, updated_at = now()
         from unnest($1::uuid[]) with ordinality as ordered(id, position)
         where c.id = ordered.id`,
        [orderedIds],
      )
      const names = new Map(rows.map((row) => [String(row.id), String(row.name)]))
      await audit(query, actorId, 'community.category_reordered', orderedIds[0]!, {
        previous: current.map((id) => names.get(id)),
        next: orderedIds.map((id) => names.get(id)),
      })
    })
  }

  /** Moves one category up or down by one place. False when it is already first or last. */
  async function move(actorId: string, categoryId: string, direction: 'up' | 'down') {
    const ids = (await queryRows(`select c.id from public.community_categories c ${ORDER}`)).map((row) => String(row.id))
    const index = ids.indexOf(categoryId)
    if (index < 0) throw new CommunityCategoryError('category_not_found')
    const swap = direction === 'up' ? index - 1 : index + 1
    if (swap < 0 || swap >= ids.length) return false
    ;[ids[index], ids[swap]] = [ids[swap]!, ids[index]!]
    await reorder(actorId, ids)
    return true
  }

  async function setHidden(actorId: string, categoryId: string, hidden: boolean) {
    await transaction(async (query) => {
      const previous = await lockCategory(query, categoryId)
      const wasHidden = previous.hidden_at !== null
      if (wasHidden === hidden) return
      await query(
        `update public.community_categories set hidden_at = ${hidden ? 'now()' : 'null'}, updated_at = now() where id = $1`,
        [categoryId],
      )
      await audit(query, actorId, hidden ? 'community.category_hidden' : 'community.category_shown', categoryId, { name: previous.name })
    })
  }

  /** "Move its communities to…": every community of one category (live and archived) to another. Returns how many. */
  async function moveCommunities(actorId: string, fromId: string, toId: string) {
    if (fromId === toId) throw new CommunityCategoryError('category_move_target_invalid')
    return transaction(async (query) => {
      const from = await lockCategory(query, fromId)
      const to = await lockCategory(query, toId)
      const moved = await query(
        `update public.community_groups g
         set category_id = $2,
             category = (select c.legacy_key from public.community_categories c where c.id = $2 and c.legacy_key <> 'other'),
             updated_at = now()
         where g.category_id = $1
         returning g.id`,
        [fromId, toId],
      )
      await audit(query, actorId, 'community.category_communities_moved', fromId, {
        from: from.name,
        to: to.name,
        to_id: toId,
        count: moved.length,
      })
      return moved.length
    })
  }

  /** Deletes a category no community uses. In use: CommunityCategoryError('category_in_use'). */
  async function remove(actorId: string, categoryId: string) {
    await transaction(async (query) => {
      const previous = await lockCategory(query, categoryId)
      const used = await query(`select count(*)::int as total from public.community_groups where category_id = $1`, [categoryId])
      if (Number(used[0]?.total ?? 0) > 0) throw new CommunityCategoryError('category_in_use')
      await query(`delete from public.community_categories where id = $1`, [categoryId])
      await audit(query, actorId, 'community.category_deleted', categoryId, { name: previous.name, slug: previous.slug })
    })
  }

  return { listAll, listPickerOptions, listDirectoryChips, findBySlug, canAssign, create, update, reorder, move, setHidden, moveCommunities, remove }
}

export type CommunityCategoryRepository = ReturnType<typeof createCommunityCategoryRepository>

export const communityCategoryRepository = createCommunityCategoryRepository()
