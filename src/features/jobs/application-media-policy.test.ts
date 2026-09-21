import { describe, expect, it } from 'vitest'
import {
  buildJobApplicationCvStoragePath,
  isOwnedJobApplicationCvStoragePath,
  validateJobApplicationCvMetadata,
} from './application-media-policy'

const profileId = '22222222-2222-4222-8222-222222222222'
const jobId = '11111111-1111-4111-8111-111111111111'

describe('job application CV policy', () => {
  it('accepts PDFs up to 10 MB and normalizes the file name', () => {
    expect(validateJobApplicationCvMetadata({
      fileName: '  Chief Officer CV.pdf  ',
      mimeType: 'application/pdf',
      sizeBytes: 10 * 1024 * 1024,
    })).toEqual({
      ok: true,
      fileName: 'Chief Officer CV.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10 * 1024 * 1024,
    })
  })

  it('rejects non-PDFs and oversized files', () => {
    expect(validateJobApplicationCvMetadata({
      fileName: 'resume.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: 1024,
    }).ok).toBe(false)
    expect(validateJobApplicationCvMetadata({
      fileName: 'resume.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10 * 1024 * 1024 + 1,
    }).ok).toBe(false)
  })

  it('builds an applicant/job-scoped storage key and validates ownership', () => {
    const path = buildJobApplicationCvStoragePath({ profileId, jobId })
    expect(path).toMatch(new RegExp(`^job-applications/${profileId}/${jobId}/[0-9a-f-]+\\.pdf$`))
    expect(isOwnedJobApplicationCvStoragePath({ profileId, jobId, storagePath: path })).toBe(true)
    expect(isOwnedJobApplicationCvStoragePath({
      profileId: '33333333-3333-4333-8333-333333333333',
      jobId,
      storagePath: path,
    })).toBe(false)
  })
})
