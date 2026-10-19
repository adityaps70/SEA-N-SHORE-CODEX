'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requirePlatformAdministratorUser } from '@/features/admin/access'
import { CommunityCategoryError, communityCategoryRepository } from './category-repository'
import { revalidateCategoryPages } from './category-revalidate'

/**
 * Round I (I2): Admin › Communities › Categories. Every action requires a platform administrator (with admin
 * two-step verification) and comes back to the page with ?notice= or ?error= (see category-admin-messages).
 */
const PAGE = '/admin/communities/categories'
const uuid = z.string().uuid()

async function requireAdmin() {
  try {
    return await requirePlatformAdministratorUser()
  } catch {
    return null
  }
}

function back(params: Record<string, string>): never {
  redirect(`${PAGE}?${new URLSearchParams(params).toString()}`)
}

function field(formData: FormData, key: string) {
  return formData.get(key)?.toString() ?? ''
}

/** Runs one change; a CommunityCategoryError comes back as ?error=<code>, anything else as ?error=failed. */
async function change(work: (adminId: string) => Promise<Record<string, string>>): Promise<never> {
  const admin = await requireAdmin()
  if (!admin) back({ error: 'forbidden' })
  let result: Record<string, string>
  try {
    result = await work(admin.id)
  } catch (error) {
    back({ error: error instanceof CommunityCategoryError ? error.code : 'failed' })
  }
  revalidateCategoryPages()
  back(result)
}

export async function createCommunityCategory(formData: FormData) {
  await change(async (adminId) => {
    const created = await communityCategoryRepository.create(adminId, {
      name: field(formData, 'name'),
      description: field(formData, 'description'),
      icon: field(formData, 'icon'),
    })
    return { notice: 'created', category: created.id }
  })
}

export async function updateCommunityCategory(formData: FormData) {
  const categoryId = uuid.safeParse(field(formData, 'categoryId'))
  await change(async (adminId) => {
    if (!categoryId.success) throw new CommunityCategoryError('category_not_found')
    await communityCategoryRepository.update(adminId, categoryId.data, {
      name: field(formData, 'name'),
      description: field(formData, 'description'),
      icon: field(formData, 'icon'),
    })
    return { notice: 'saved', category: categoryId.data }
  })
}

export async function moveCommunityCategory(formData: FormData) {
  const categoryId = uuid.safeParse(field(formData, 'categoryId'))
  const direction = field(formData, 'direction') === 'down' ? 'down' : 'up'
  await change(async (adminId) => {
    if (!categoryId.success) throw new CommunityCategoryError('category_not_found')
    await communityCategoryRepository.move(adminId, categoryId.data, direction)
    return { notice: direction === 'up' ? 'moved_up' : 'moved_down', category: categoryId.data }
  })
}

export async function setCommunityCategoryHidden(formData: FormData) {
  const categoryId = uuid.safeParse(field(formData, 'categoryId'))
  const hidden = field(formData, 'hidden') === 'true'
  await change(async (adminId) => {
    if (!categoryId.success) throw new CommunityCategoryError('category_not_found')
    await communityCategoryRepository.setHidden(adminId, categoryId.data, hidden)
    return { notice: hidden ? 'hidden' : 'shown', category: categoryId.data }
  })
}

/** "Move its communities to…", then delete when asked (and the category is then empty). */
export async function moveCommunityCategoryCommunities(formData: FormData) {
  const fromId = uuid.safeParse(field(formData, 'categoryId'))
  const toId = uuid.safeParse(field(formData, 'targetId'))
  const thenDelete = field(formData, 'thenDelete') === 'true'
  await change(async (adminId): Promise<Record<string, string>> => {
    if (!fromId.success) throw new CommunityCategoryError('category_not_found')
    if (!toId.success) throw new CommunityCategoryError('category_move_target_invalid')
    const moved = await communityCategoryRepository.moveCommunities(adminId, fromId.data, toId.data)
    if (thenDelete) {
      await communityCategoryRepository.remove(adminId, fromId.data)
      return { notice: 'moved_deleted', count: String(moved) }
    }
    return { notice: 'moved', count: String(moved), category: toId.data }
  })
}

export async function deleteCommunityCategory(formData: FormData) {
  const categoryId = uuid.safeParse(field(formData, 'categoryId'))
  await change(async (adminId) => {
    if (!categoryId.success) throw new CommunityCategoryError('category_not_found')
    await communityCategoryRepository.remove(adminId, categoryId.data)
    return { notice: 'deleted' }
  })
}
