'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getAccessContext } from '@/features/access/server'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { organizationWorkspaceRepository } from './workspace-repository'

const companyIdSchema = z.string().uuid()

export type OrganizationFollowActionResult =
  | { ok: true }
  | { ok: false; error: string }

async function mutateOrganizationFollow(
  companyId: string,
  operation: 'follow' | 'unfollow',
): Promise<OrganizationFollowActionResult> {
  const parsed = companyIdSchema.safeParse(companyId)
  if (!parsed.success) return { ok: false, error: 'This organization could not be found.' }

  try {
    const user = await requireAwsUser()
    const access = await getAccessContext(user.id)
    if (!access.accountActive) {
      return { ok: false, error: 'Your account cannot update organization follows right now.' }
    }

    const workspace = await organizationWorkspaceRepository.getById(parsed.data)
    if (!workspace) return { ok: false, error: 'This organization could not be found.' }

    if (operation === 'follow') {
      await organizationWorkspaceRepository.followOrganization(user.id, parsed.data)
    } else {
      await organizationWorkspaceRepository.unfollowOrganization(user.id, parsed.data)
    }

    revalidatePath('/organizations')
    revalidatePath('/profile')
    revalidatePath('/search')
    revalidatePath('/organizations/' + workspace.slug)
    return { ok: true }
  } catch {
    return { ok: false, error: 'We could not update this organization follow. Please try again.' }
  }
}

export async function followOrganizationAction(companyId: string) {
  return mutateOrganizationFollow(companyId, 'follow')
}

export async function unfollowOrganizationAction(companyId: string) {
  return mutateOrganizationFollow(companyId, 'unfollow')
}
