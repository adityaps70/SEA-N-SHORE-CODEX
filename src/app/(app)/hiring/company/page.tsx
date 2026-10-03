import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { hiringRepository } from '@/features/jobs/hiring-repository'

export const metadata: Metadata = { title: 'Company hiring' }

export default async function HiringCompanyLegacyPage() {
  const user = await requireAwsUser()
  const company = await hiringRepository.getAuthorizedCompany(user.id)
  if (!company) notFound()
  redirect('/organizations/' + company.slug)
}
