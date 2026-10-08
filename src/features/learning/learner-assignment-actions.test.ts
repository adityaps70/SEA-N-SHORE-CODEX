import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  revalidatePath: vi.fn(),
  getSubmissionTarget: vi.fn(),
  submit: vi.fn(),
  createMediaUploadUrl: vi.fn(),
  headMediaObject: vi.fn(),
  readMediaObjectPrefix: vi.fn(),
  deleteMediaObject: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('./learner-assignment-repository', () => ({
  learnerAssignmentRepository: { getSubmissionTarget: mocks.getSubmissionTarget, submit: mocks.submit, getState: vi.fn() },
}))
vi.mock('@/lib/aws/storage', () => ({
  createMediaUploadUrl: mocks.createMediaUploadUrl,
  headMediaObject: mocks.headMediaObject,
  readMediaObjectPrefix: mocks.readMediaObjectPrefix,
  deleteMediaObject: mocks.deleteMediaObject,
  createMediaDownloadUrl: vi.fn(),
}))

import { buildAssignmentAttachmentPath } from './assignment-policy'
import { createAssignmentAttachmentUpload, submitLearningAssignment } from './learner-assignment-actions'

const slug = 'sire-readiness'
const lessonId = '22222222-2222-4222-8222-222222222222'
const enrollmentId = '11111111-1111-4111-8111-111111111111'
const submissionId = '33333333-3333-4333-8333-333333333333'
const target = { enrollmentId, lessonId, rules: { acceptedExtensions: [], maxUploadBytes: 20 * 1024 * 1024, maxFiles: 2 } }
const pdfBytes = new TextEncoder().encode('%PDF-1.7 fixture')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: 'learner-1' })
  mocks.getSubmissionTarget.mockResolvedValue(target)
  mocks.createMediaUploadUrl.mockResolvedValue('https://upload.example/signed')
  mocks.submit.mockResolvedValue({ attemptId: submissionId, attemptNumber: 1, status: 'submitted', submittedAt: '2026-10-08T00:00:00.000Z', completed: false })
})

describe('assignment file uploads', () => {
  it('signs an upload under the submission’s own prefix for an allowed file', async () => {
    const result = await createAssignmentAttachmentUpload(slug, lessonId, submissionId, { name: 'Report.pdf', mimeType: 'application/pdf', size: 4096 })

    expect(result.ok).toBe(true)
    const path = result.ok ? result.upload.storagePath : ''
    expect(path.startsWith(`learning-submissions/${enrollmentId}/${lessonId}/${submissionId}/`)).toBe(true)
    expect(mocks.createMediaUploadUrl).toHaveBeenCalledWith({ key: path, contentType: 'application/pdf' }, 300)
  })

  it.each([
    [{ name: 'tool.exe', mimeType: 'application/x-msdownload', size: 4096 }, /not a supported file type/],
    [{ name: 'page.html', mimeType: 'text/html', size: 4096 }, /not a supported file type/],
    [{ name: 'big.pdf', mimeType: 'application/pdf', size: 20 * 1024 * 1024 + 1 }, /larger than 20 MB/],
  ])('refuses a wrong-type or oversized file before anything is uploaded (%o)', async (file, copy) => {
    const result = await createAssignmentAttachmentUpload(slug, lessonId, submissionId, file)

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.error).toMatch(copy)
    expect(mocks.createMediaUploadUrl).not.toHaveBeenCalled()
  })

  it('refuses uploads when the learner can’t submit (for example, not enrolled)', async () => {
    mocks.getSubmissionTarget.mockRejectedValueOnce(new Error('assignment_not_accessible'))

    await expect(createAssignmentAttachmentUpload(slug, lessonId, submissionId, { name: 'a.pdf', mimeType: 'application/pdf', size: 10 }))
      .resolves.toEqual({ ok: false, error: 'This assignment is not available yet.' })
    expect(mocks.createMediaUploadUrl).not.toHaveBeenCalled()
  })
})

describe('submitting an assignment with files', () => {
  const storagePath = buildAssignmentAttachmentPath({ enrollmentId, lessonId, submissionId, extension: 'pdf', fileId: '44444444-4444-4444-8444-444444444444' })

  it('checks each uploaded file on the server (type, size, signature) before recording it', async () => {
    mocks.headMediaObject.mockResolvedValue({ contentType: 'application/pdf', contentLength: pdfBytes.length })
    mocks.readMediaObjectPrefix.mockResolvedValue(pdfBytes)

    const result = await submitLearningAssignment(slug, lessonId, {
      responseText: '',
      submissionId,
      attachments: [{ storagePath, name: 'report.pdf', mimeType: 'application/pdf', size: pdfBytes.length }],
    })

    expect(result.ok).toBe(true)
    expect(mocks.submit).toHaveBeenCalledWith('learner-1', slug, lessonId, {
      responseText: null,
      submissionId,
      attachments: [{ storagePath, fileName: 'report.pdf', contentType: 'application/pdf', sizeBytes: pdfBytes.length }],
    })
  })

  it('refuses and deletes a file whose stored size or type differs from what was declared', async () => {
    mocks.headMediaObject.mockResolvedValue({ contentType: 'application/pdf', contentLength: 999_999 })

    const result = await submitLearningAssignment(slug, lessonId, {
      responseText: '',
      submissionId,
      attachments: [{ storagePath, name: 'report.pdf', mimeType: 'application/pdf', size: pdfBytes.length }],
    })

    expect(result).toEqual({ ok: false, error: '“report.pdf” doesn’t match what was uploaded. Remove it and attach it again.' })
    expect(mocks.deleteMediaObject).toHaveBeenCalledWith(storagePath)
    expect(mocks.submit).not.toHaveBeenCalled()
  })

  it('refuses and deletes a renamed file whose content is not really a PDF', async () => {
    mocks.headMediaObject.mockResolvedValue({ contentType: 'application/pdf', contentLength: 16 })
    mocks.readMediaObjectPrefix.mockResolvedValue(new TextEncoder().encode('<html>not a pdf'))

    const result = await submitLearningAssignment(slug, lessonId, {
      responseText: '',
      submissionId,
      attachments: [{ storagePath, name: 'report.pdf', mimeType: 'application/pdf', size: 16 }],
    })

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.error).toMatch(/isn’t really a PDF file/)
    expect(mocks.deleteMediaObject).toHaveBeenCalledWith(storagePath)
    expect(mocks.submit).not.toHaveBeenCalled()
  })

  it('refuses more files than the assignment allows', async () => {
    const attachments = ['a', 'b', 'c'].map((name, index) => ({
      storagePath: buildAssignmentAttachmentPath({ enrollmentId, lessonId, submissionId, extension: 'pdf', fileId: `4444444${index}-4444-4444-8444-444444444444` }),
      name: `${name}.pdf`,
      mimeType: 'application/pdf',
      size: 10,
    }))

    const result = await submitLearningAssignment(slug, lessonId, { responseText: '', submissionId, attachments })

    expect(result).toEqual({ ok: false, error: 'This assignment accepts up to 2 files. Remove some and submit again.' })
    expect(mocks.headMediaObject).not.toHaveBeenCalled()
  })

  it('needs a response or at least one file', async () => {
    await expect(submitLearningAssignment(slug, lessonId, { responseText: '  ', submissionId: null, attachments: [] }))
      .resolves.toEqual({ ok: false, error: 'Write a response or attach a file before submitting.' })
  })
})
