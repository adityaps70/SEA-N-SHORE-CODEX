import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

export const metadata: Metadata = { title: 'Organization hiring' }

export default function HiringOrganizationLegacyPage() {
  redirect('/organizations')
}
