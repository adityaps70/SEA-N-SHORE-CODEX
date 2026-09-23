import { accountExportRepository } from '@/features/account-export/repository'
import { createAccountExportZip, type AccountExportPayload } from '@/features/account-export/zip'
import { AwsAuthenticationRequiredError, requireAwsUser } from '@/features/auth/aws-queries'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EXPORT_HEADERS = {
  'Cache-Control': 'private, no-store',
  'Pragma': 'no-cache',
  'X-Content-Type-Options': 'nosniff',
}

function errorResponse(error: string, status: number) {
  return Response.json({ ok: false, error }, {
    status,
    headers: EXPORT_HEADERS,
  })
}

function exportFormat(request?: Request) {
  if (!request) {
    return 'json'
  }

  return new URL(request.url).searchParams.get('format') ?? 'json'
}

export async function GET(request?: Request) {
  const format = exportFormat(request)
  if (format !== 'json' && format !== 'zip') {
    return errorResponse('Choose either ZIP or JSON for your data export.', 400)
  }

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
    const payload: AccountExportPayload = {
      schemaVersion: 1,
      generatedAt,
      account: {
        profileId: user.id,
        email: user.email,
      },
      data,
    }

    if (format === 'zip') {
      const zip = createAccountExportZip(payload)
      return new Response(zip, {
        status: 200,
        headers: {
          ...EXPORT_HEADERS,
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="sea-n-shore-data-export-' + date + '.zip"',
        },
      })
    }

    return new Response(JSON.stringify(payload, null, 2) + '\n', {
      status: 200,
      headers: {
        ...EXPORT_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="sea-n-shore-data-export-' + date + '.json"',
      },
    })
  } catch {
    return errorResponse('We could not prepare your data export right now. Please try again.', 500)
  }
}
