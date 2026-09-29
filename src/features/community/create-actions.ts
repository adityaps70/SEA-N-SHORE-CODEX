'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { communityErrorMessage } from './actions'
import { CREATE_AS_SELF, ELIGIBILITY_REASON_TEXT } from './eligibility'
import { getCommunityCreationEligibility } from './eligibility-server'
import { validateCommunityImage, type CommunityMediaKind } from './media'
import { uploadCommunityMedia } from './media-service'
import { communityService } from './service'
import {
  GROUP_DESCRIPTION_MAX_LENGTH,
  GROUP_JOIN_POLICIES,
  GROUP_NAME_MAX_LENGTH,
  GROUP_RULES_MAX_LENGTH,
  GROUP_VISIBILITIES,
  groupHref,
} from './types'

export type CreateCommunityState = { ok: false; error: string } | null

const createSchema = z.object({
  as: z.string().trim().max(64).default(CREATE_AS_SELF),
  name: z.string().trim().min(2, 'Give the community a name (2 to 80 characters).').max(GROUP_NAME_MAX_LENGTH, 'The name is too long (80 characters at most).'),
  description: z.string().trim().max(GROUP_DESCRIPTION_MAX_LENGTH, 'The description is too long (2,000 characters at most).'),
  rules: z.string().trim().max(GROUP_RULES_MAX_LENGTH, 'The rules are too long (4,000 characters at most).'),
  joinPolicy: z.enum(GROUP_JOIN_POLICIES, { message: 'Choose how members join: Open or Approval required.' }),
  visibility: z.enum(GROUP_VISIBILITIES, { message: 'Choose Public or Private.' }),
})

function readForm(formData: FormData, keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, formData.get(key)?.toString() ?? '']))
}

function chosenImage(formData: FormData, field: string): File | null {
  const value = formData.get(field)
  return value instanceof File && value.size > 0 ? value : null
}

/**
 * Creates a community for the signed-in member (Creator Pro) or for one of their
 * organizations (Organization Pro). Eligibility is recomputed here from the database; the
 * form's "Create as" value is only a choice among what the server allows.
 */
export async function createCommunity(_previous: CreateCommunityState, formData: FormData): Promise<CreateCommunityState> {
  const user = await requireAwsUser()
  const parsed = createSchema.safeParse(readForm(formData, ['as', 'name', 'description', 'rules', 'joinPolicy', 'visibility']))
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the community details and try again.' }

  const images: Array<{ kind: CommunityMediaKind; file: File }> = []
  for (const [field, kind, label] of [['cover', 'cover', 'banner'], ['icon', 'icon', 'profile photo']] as const) {
    const file = chosenImage(formData, field)
    if (!file) continue
    const validation = validateCommunityImage(file)
    if (!validation.ok) return { ok: false, error: `The ${label}: ${validation.error}` }
    images.push({ kind, file })
  }

  const options = await getCommunityCreationEligibility(user.id)
  const { eligibility } = options
  let ownerCompanyId: string | null = null
  if (!parsed.data.as || parsed.data.as === CREATE_AS_SELF) {
    if (!eligibility.asMember.allowed) {
      return { ok: false, error: eligibility.asMember.reason ? ELIGIBILITY_REASON_TEXT[eligibility.asMember.reason] : 'You cannot create a community right now.' }
    }
  } else {
    const option = eligibility.asOrganizations.find((entry) => entry.companyId === parsed.data.as)
    if (!option) return { ok: false, error: 'You are not part of that organization.' }
    if (!option.allowed) return { ok: false, error: option.reason ? ELIGIBILITY_REASON_TEXT[option.reason] : 'This organization cannot create a community right now.' }
    ownerCompanyId = option.companyId
  }

  let created: { id: string; slug: string }
  try {
    created = await communityService.createGroup(user.id, {
      name: parsed.data.name,
      description: parsed.data.description,
      rules: parsed.data.rules,
      visibility: parsed.data.visibility,
      joinPolicy: parsed.data.joinPolicy,
      icon: null,
      ownerId: user.id,
      ownerCompanyId,
    })
  } catch (error) {
    return { ok: false, error: await communityErrorMessage(error, 'We could not create the community. Please try again.') }
  }

  // The community exists now; a failed image upload is logged and the owner can add it from the page.
  for (const image of images) {
    try {
      await uploadCommunityMedia(created.id, image.kind, {
        type: image.file.type,
        size: image.file.size,
        bytes: new Uint8Array(await image.file.arrayBuffer()),
      })
    } catch (error) {
      console.error('community_create_image_failed', { groupId: created.id, kind: image.kind, message: error instanceof Error ? error.message : null })
    }
  }

  revalidatePath('/community')
  revalidatePath('/community/[slug]', 'page')
  if (ownerCompanyId) revalidatePath('/organizations/[slug]', 'page')
  redirect(groupHref(created.slug))
}
