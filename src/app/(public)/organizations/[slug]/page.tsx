import type { Metadata } from 'next'
import { getVerifiedUser } from '@/features/auth/queries'
import { organizationMetadata } from '@/features/organizations/organization-seo'
import { organizationWorkspaceRepository } from '@/features/organizations/workspace-repository'
import { PublicOrganizationPage } from './public-page'
import { SignedInOrganizationPage } from './signed-in-page'

/**
 * Round ARCH (Phase 2): /organizations/<slug> opens for everyone. A signed-in member gets the full page
 * (follow, join, team and workspace tools), exactly as before; a visitor gets the public page, which reads
 * nothing about a viewer and may be cached at CloudFront. The sub-pages (manage, team, training, claim,
 * branding, analytics), /organizations and /organizations/register stay in the signed-in (app) group.
 */
type PageProps = {
  params: Promise<{ slug: string }>
  searchParams?: Promise<{ tab?: string | string[] }>
}

export async function generateMetadata({ params }: Pick<PageProps, 'params'>): Promise<Metadata> {
  const { slug } = await params
  const viewer = await getVerifiedUser().catch(() => null)
  // A visitor never learns the name of an organization that is not public (the page is not found).
  const workspace = await (viewer
    ? organizationWorkspaceRepository.getBySlug(slug)
    : organizationWorkspaceRepository.getPublicBySlug(slug)).catch(() => null)
  if (!workspace) return { title: 'Organization' }
  // Round H (H5): canonical address (no ?tab=) and a plain-text description.
  return organizationMetadata(workspace)
}

export default async function OrganizationPage(props: PageProps) {
  const viewer = await getVerifiedUser()
  // Server components without hooks: rendered here so each variant's data loads (and not-found) run in this request.
  if (viewer) return await SignedInOrganizationPage(props)
  return await PublicOrganizationPage({ params: props.params })
}
