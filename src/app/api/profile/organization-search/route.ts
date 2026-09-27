import { AwsAuthenticationRequiredError, requireAwsUser } from '@/features/auth/aws-queries'
import { organizationLinkRepository } from '@/features/profiles/organization-link-repository'
import { createOrganizationSearchService } from '@/features/profiles/organization-search-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
}

const service = createOrganizationSearchService({ repository: organizationLinkRepository })

/**
 * Type-ahead for the profile organization picker. Signed-in members only; returns
 * only organizations Sea N Shore lists (id, name, slug, logo, type, location).
 */
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('q') ?? ''

  try {
    const user = await requireAwsUser()
    const result = await service.search(user.id, query)
    if (!result.ok) {
      return Response.json({ error: result.message }, { status: 429, headers: { ...NO_STORE_HEADERS, 'Retry-After': '30' } })
    }
    return Response.json({ query: result.query, organizations: result.organizations }, { status: 200, headers: NO_STORE_HEADERS })
  } catch (error) {
    if (error instanceof AwsAuthenticationRequiredError) {
      return Response.json(
        { error: 'Please sign in again to search organizations.' },
        { status: 401, headers: NO_STORE_HEADERS },
      )
    }
    return Response.json(
      { error: 'We could not search organizations right now. You can keep typing the name and save it as text.' },
      { status: 500, headers: NO_STORE_HEADERS },
    )
  }
}
