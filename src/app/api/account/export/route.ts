import { accountExportRepository } from '@/features/account-export/repository'
import { AwsAuthenticationRequiredError, requireAwsUser } from '@/features/auth/aws-queries'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const JSON_HEADERS = {
  'Cache-Control': 'private, no-store',
  'Pragma': 'no-cache',
  'X-Content-Type-Options': 'nosniff',
}

function errorResponse(error: string, status: number) {
  return Response.json({ ok: false, error }, {
    status,
    headers: JSON_HEADERS,
  })
}

export async function GET() {
  let user: Awaited<ReturnType<typeof requireAwsUser>>
  try {
    user = await requireAwsUser()
  } catch (error) {
    if (error instanceof AwsAuthenticationRequiredError) {
      return errorResponse('Your session has expired. Sign in again to download your data.', 401)
    }
    return errorResponse('We could not prepare your data export right now. Please try again.', 500)
  }

  try {
    const data = await accountExportRepository.exportAccountData(user.id)
    const generatedAt = new Date().toISOString()
    const date = generatedAt.slice(0, 10)
    const payload = {
      schemaVersion: 1,
      generatedAt,
      account: {
        profileId: user.id,
        email: user.email,
      },
      data,
    }

    return new Response(JSON.stringify(payload, null, 2) + '\n', {
      status: 200,
      headers: {
        ...JSON_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="sea-n-shore-data-export-' + date + '.json"',
      },
    })
  } catch {
    return errorResponse('We could not prepare your data export right now. Please try again.', 500)
  }
}
