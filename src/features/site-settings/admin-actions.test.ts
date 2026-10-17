import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  allowed: true,
  set: vi.fn(),
  createMediaUploadUrl: vi.fn(async () => 'https://upload.example.com/signed'),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/aws/storage', () => ({ createMediaUploadUrl: mocks.createMediaUploadUrl }))
vi.mock('@/features/admin/access', () => ({
  requirePlatformAdministratorUser: vi.fn(async () => {
    if (!mocks.allowed) throw new Error('admin_forbidden')
    return { id: '44444444-4444-4444-8444-444444444444', cognitoSub: 'sub', email: null }
  }),
}))
vi.mock('./repository', async (importOriginal) => ({
  ...await importOriginal<typeof import('./repository')>(),
  siteSettingsRepository: { set: mocks.set },
}))

import { createSiteImageUploadAction, saveAboutPageAction, saveGrievanceOfficerAction } from './admin-actions'

const ADMIN = '44444444-4444-4444-8444-444444444444'

function form(entries: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(entries)) data.append(key, value)
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.allowed = true
  mocks.set.mockImplementation(async (_key: string, value: unknown) => value)
})

describe('Admin › Site settings actions (round H, H7)', () => {
  it('refuses anyone who is not an administrator with admin MFA', async () => {
    mocks.allowed = false
    expect((await saveGrievanceOfficerAction({ status: 'idle' }, form({ name: '', email: '', responseTime: '' }))).status).toBe('error')
    expect((await saveAboutPageAction({ status: 'idle' }, form({ about: '{}' }))).status).toBe('error')
    expect(await createSiteImageUploadAction({ contentType: 'image/png', size: 1000 })).toMatchObject({ ok: false })
    expect(mocks.set).not.toHaveBeenCalled()
    expect(mocks.createMediaUploadUrl).not.toHaveBeenCalled()
  })

  it('validates and saves the Grievance Officer, refreshing the Contact page', async () => {
    const invalid = await saveGrievanceOfficerAction({ status: 'idle' }, form({ name: 'Placeholder Officer', email: '', responseTime: '' }))
    expect(invalid).toMatchObject({ status: 'error', fieldErrors: { email: 'Add the Grievance Officer’s email address, or clear the name.' } })
    expect(mocks.set).not.toHaveBeenCalled()

    const saved = await saveGrievanceOfficerAction({ status: 'idle' }, form({ name: 'Placeholder Officer', email: 'officer@example.com', responseTime: 'Within 15 days' }))
    expect(saved.status).toBe('success')
    expect(mocks.set).toHaveBeenCalledWith('grievance_officer', { name: 'Placeholder Officer', email: 'officer@example.com', responseTime: 'Within 15 days' }, ADMIN)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/contact')
  })

  it('validates the About page lists with a field path per error', async () => {
    const invalid = await saveAboutPageAction({ status: 'idle' }, form({ about: JSON.stringify({ founders: [{ name: '' }], team: [], partners: [] }) }))
    expect(invalid).toMatchObject({ status: 'error', fieldErrors: { 'founders.0.name': 'Add the person’s name.' } })
    const garbage = await saveAboutPageAction({ status: 'idle' }, form({ about: 'not json' }))
    expect(garbage.status).toBe('error')

    const about = { founders: [{ name: 'Placeholder Founder', role: 'Founder', bio: '', photoPath: null, profileUrl: null }], team: [], partners: [], memberNumbers: { enabled: true, members: true, organizations: false, courses: false } }
    expect((await saveAboutPageAction({ status: 'idle' }, form({ about: JSON.stringify(about) }))).status).toBe('success')
    expect(mocks.set).toHaveBeenCalledWith('about_page', about, ADMIN)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/about')
  })

  it('hands out an upload link only for small PNG, JPEG or WebP images, under site/about/', async () => {
    expect(await createSiteImageUploadAction({ contentType: 'image/svg+xml', size: 1000 })).toMatchObject({ ok: false })
    expect(await createSiteImageUploadAction({ contentType: 'image/png', size: 3 * 1024 * 1024 })).toMatchObject({ ok: false })
    const result = await createSiteImageUploadAction({ contentType: 'image/webp', size: 2048 })
    expect(result).toMatchObject({ ok: true, uploadUrl: 'https://upload.example.com/signed' })
    if (result.ok) expect(result.path).toMatch(/^site\/about\/[0-9a-f-]{36}\.webp$/)
    expect(mocks.createMediaUploadUrl).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'image/webp', contentLength: 2048 }))
  })
})
