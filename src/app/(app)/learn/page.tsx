import { Bot, ChartNoAxesCombined, GraduationCap, Leaf, Navigation, ShieldCheck } from 'lucide-react'
import { ProductSurface } from '@/components/product/product-surface'

const items = [
  {
    title: 'SIRE 2.0',
    description: 'Scenario-led learning for tanker professionals with behavioural competency, inspection readiness and practical vessel context.',
    meta: 'Technical',
    icon: ShieldCheck,
  },
  {
    title: 'Navigation & audits',
    description: 'Structured learning around bridge practice, navigational assessments, VDR learning and audit preparedness.',
    meta: 'Technical',
    icon: Navigation,
  },
  {
    title: 'Shore career transition',
    description: 'Turn sea-going capability into a credible shore profile with role mapping, interview preparation and skill planning.',
    meta: 'Career development',
    icon: GraduationCap,
  },
  {
    title: 'AI in shipping',
    description: 'Practical future-skills learning focused on where AI can improve maritime operations, training, safety and productivity.',
    meta: 'Future skills',
    icon: Bot,
  },
  {
    title: 'Decarbonisation',
    description: 'Build working knowledge around environmental compliance, efficiency, alternative fuels and the changing regulatory landscape.',
    meta: 'Future skills',
    icon: Leaf,
  },
  {
    title: 'Learning progress',
    description: 'Courses, quizzes, certificates and discussion tied to one professional record so learning strengthens career visibility.',
    meta: 'Professional record',
    icon: ChartNoAxesCombined,
  },
]

export default function LearnPage() {
  return (
    <ProductSurface
      eyebrow="Learn from maritime expertise"
      title="Sea N Shore Academy"
      description="Technical mastery, career development and future maritime skills in one learning environment built for professionals — not generic course consumption."
      note="Courses will connect completion, certificates and discussion back to the member profile, making learning part of a visible professional journey."
      items={items}
    />
  )
}
