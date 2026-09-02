import { Anchor, BriefcaseBusiness, Building2, Compass, FileCheck2, Sparkles } from 'lucide-react'
import { ProductSurface } from '@/components/product/product-surface'

const items = [
  {
    title: 'Sailing opportunities',
    description: 'Discover roles shaped around rank, vessel type, contract, joining window, certification and sea-time requirements.',
    meta: 'At sea',
    icon: Anchor,
  },
  {
    title: 'Shore career pathways',
    description: 'Translate sailing experience into superintendent, vetting, operations, training, survey and commercial career directions.',
    meta: 'Career transition',
    icon: Compass,
  },
  {
    title: 'Company hiring desks',
    description: 'A dedicated recruiter workflow for maritime companies to publish roles, review candidates and manage applications.',
    meta: 'Recruitment',
    icon: Building2,
  },
  {
    title: 'Application workspace',
    description: 'Keep saved jobs and applications in one professional workspace with clear status and next-action visibility.',
    meta: 'Candidate',
    icon: BriefcaseBusiness,
  },
  {
    title: 'Credential-aware matching',
    description: 'Match opportunity requirements against professional profile data instead of relying on keyword-only job search.',
    meta: 'Profile intelligence',
    icon: FileCheck2,
  },
  {
    title: 'Career recommendations',
    description: 'Use rank, vessel experience and professional interests to surface relevant maritime roles and skill gaps.',
    meta: 'AI-ready',
    icon: Sparkles,
  },
]

export default function JobsPage() {
  return (
    <ProductSurface
      eyebrow="Sea N Shore Jobs"
      title="Maritime opportunities, built around your real experience."
      description="A recruitment ecosystem designed to understand rank, vessel type, experience and career direction — for both sailing and shore opportunities."
      note="The professional profile is already the identity foundation. Job posting, applications and matching will connect to that same record rather than creating a separate job-portal identity."
      items={items}
    />
  )
}
