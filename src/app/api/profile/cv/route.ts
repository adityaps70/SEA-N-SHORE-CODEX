import { getOwnProfilePortfolio } from '@/features/profiles/profile-portfolio-queries'
import { buildProfileCvPdf } from '@/features/profiles/profile-cv-pdf'
import { getOwnProfile } from '@/features/profiles/queries'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const [profile, portfolio] = await Promise.all([
    getOwnProfile(),
    getOwnProfilePortfolio(),
  ])

  if (!profile) {
    return Response.json({ error: 'Profile not found.' }, { status: 404 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/g, '') ?? ''
  const publicProfileUrl = `${baseUrl}/people/${profile.slug}`
  const pdfBytes = await buildProfileCvPdf({ profile, portfolio, publicProfileUrl })

  return new Response(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${profile.slug}-maritime-cv.pdf"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
