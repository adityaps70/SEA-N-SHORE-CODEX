import type { OrganizationLinkRepository } from './organization-link-repository'

type CurrentOrganizationFields = {
  currentCompany?: string
  currentCompanyId?: string
}

export type CurrentOrganizationResolution<T> =
  | { ok: true; data: T }
  | { ok: false; fieldErrors: Record<string, string[]> }

export const UNLISTED_ORGANIZATION_MESSAGE =
  'That organization is not listed on Sea N Shore any more. Search again, or type the name without choosing from the list.'

/**
 * Server-side check for the organization picker: a submitted organization id must
 * belong to an organization Sea N Shore lists. The stored name then always
 * matches that organization page. Without an id the typed name is kept as text.
 */
export async function resolveCurrentOrganizationLink<T extends CurrentOrganizationFields>(
  data: T,
  repository: Pick<OrganizationLinkRepository, 'getListableOrganization'>,
): Promise<CurrentOrganizationResolution<T>> {
  if (!data.currentCompanyId) return { ok: true, data: { ...data, currentCompanyId: undefined } }

  const organization = await repository.getListableOrganization(data.currentCompanyId)
  if (!organization) {
    return { ok: false, fieldErrors: { currentCompany: [UNLISTED_ORGANIZATION_MESSAGE] } }
  }

  return { ok: true, data: { ...data, currentCompany: organization.name, currentCompanyId: organization.id } }
}
