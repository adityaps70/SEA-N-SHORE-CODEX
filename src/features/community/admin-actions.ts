'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requirePlatformAdministratorUser } from '@/features/admin/access'
import { communityErrorMessage } from './actions'
import { communityService } from './service'
import {
  COMMUNITY_CATEGORIES,
  GROUP_DESCRIPTION_MAX_LENGTH,
  GROUP_ICON_NAMES,
  GROUP_JOIN_POLICIES,
  GROUP_NAME_MAX_LENGTH,
  GROUP_RULES_MAX_LENGTH,
  GROUP_VISIBILITIES,
} from './types'

export type AdminGroupFormState = { ok: true; message: string } | { ok: false; error: string } | null

const groupFieldsSchema = z.object({
  name: z.string().trim().min(2, 'Give the group a name (2 to 80 characters).').max(GROUP_NAME_MAX_LENGTH, 'The name is too long (80 characters at most).'),
  description: z.string().trim().max(GROUP_DESCRIPTION_MAX_LENGTH, 'The description is too long (2,000 characters at most).'),
  rules: z.string().trim().max(GROUP_RULES_MAX_LENGTH, 'The rules are too long (4,000 characters at most).'),
  visibility: z.enum(GROUP_VISIBILITIES, { message: 'Choose Public or Private.' }),
  joinPolicy: z.enum(GROUP_JOIN_POLICIES, { message: 'Choose Open or Approval required.' }),
  icon: z.preprocess((value) => (typeof value === 'string' && value ? value : null), z.enum(GROUP_ICON_NAMES).nullable()),
  // Round 10: '' (No category) clears it.
  category: z.preprocess((value) => (typeof value === 'string' && value ? value : null), z.enum(COMMUNITY_CATEGORIES, { message: 'Choose a category from the list.' }).nullable()),
})

const GROUP_FIELD_KEYS = ['name', 'description', 'rules', 'visibility', 'joinPolicy', 'icon', 'category']

const createSchema = groupFieldsSchema.extend({
  owner: z.string().trim().min(3, 'Enter the owner’s sign-in email or profile handle.').max(320),
})

const updateSchema = groupFieldsSchema.extend({ groupId: z.string().uuid() })
const groupIdSchema = z.object({ groupId: z.string().uuid() })
const ownerSchema = z.object({
  groupId: z.string().uuid(),
  owner: z.string().trim().min(3, 'Enter the new owner’s sign-in email or profile handle.').max(320),
})

function readForm(formData: FormData, keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, formData.get(key)?.toString() ?? '']))
}

function revalidateCommunities() {
  revalidatePath('/admin/communities')
  revalidatePath('/community')
  revalidatePath('/community/[slug]', 'page')
}

async function requireAdmin() {
  try {
    return await requirePlatformAdministratorUser()
  } catch {
    return null
  }
}

export async function createGroupAsAdmin(_previous: AdminGroupFormState, formData: FormData): Promise<AdminGroupFormState> {
  const admin = await requireAdmin()
  if (!admin) return { ok: false, error: 'Only Sea N Shore administrators can create groups.' }
  const parsed = createSchema.safeParse(readForm(formData, [...GROUP_FIELD_KEYS, 'owner']))
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the group details and try again.' }
  const { owner: ownerLookup, ...group } = parsed.data
  let created: { id: string; slug: string }
  try {
    const owner = await communityService.findOwner(ownerLookup)
    created = await communityService.createGroup(admin.id, { ...group, ownerId: owner.id })
  } catch (error) {
    return { ok: false, error: await communityErrorMessage(error, 'We could not create the group. Please try again.') }
  }
  revalidateCommunities()
  redirect(`/admin/communities?created=${created.slug}`)
}

export async function updateGroupAsAdmin(_previous: AdminGroupFormState, formData: FormData): Promise<AdminGroupFormState> {
  const admin = await requireAdmin()
  if (!admin) return { ok: false, error: 'Only Sea N Shore administrators can edit groups.' }
  const parsed = updateSchema.safeParse(readForm(formData, ['groupId', ...GROUP_FIELD_KEYS]))
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the group details and try again.' }
  const { groupId, ...group } = parsed.data
  try {
    await communityService.updateGroupAsAdmin(admin.id, groupId, group)
  } catch (error) {
    return { ok: false, error: await communityErrorMessage(error, 'We could not save the group. Please try again.') }
  }
  revalidateCommunities()
  return { ok: true, message: 'Group saved.' }
}

export async function setGroupOwnerAsAdmin(_previous: AdminGroupFormState, formData: FormData): Promise<AdminGroupFormState> {
  const admin = await requireAdmin()
  if (!admin) return { ok: false, error: 'Only Sea N Shore administrators can change a group owner.' }
  const parsed = ownerSchema.safeParse(readForm(formData, ['groupId', 'owner']))
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Enter the new owner’s email or handle.' }
  let owner: { fullName: string }
  try {
    owner = await communityService.setGroupOwner(admin.id, parsed.data.groupId, parsed.data.owner)
  } catch (error) {
    return { ok: false, error: await communityErrorMessage(error, 'We could not change the owner. Please try again.') }
  }
  revalidateCommunities()
  return { ok: true, message: `${owner.fullName} now owns this group.` }
}

export async function archiveGroupAsAdmin(formData: FormData): Promise<void> {
  const admin = await requireAdmin()
  if (!admin) return
  const parsed = groupIdSchema.safeParse(readForm(formData, ['groupId']))
  if (!parsed.success) return
  await communityService.archiveGroup(admin.id, parsed.data.groupId).catch(() => undefined)
  revalidateCommunities()
}

export async function unarchiveGroupAsAdmin(formData: FormData): Promise<void> {
  const admin = await requireAdmin()
  if (!admin) return
  const parsed = groupIdSchema.safeParse(readForm(formData, ['groupId']))
  if (!parsed.success) return
  await communityService.unarchiveGroup(admin.id, parsed.data.groupId).catch(() => undefined)
  revalidateCommunities()
}
