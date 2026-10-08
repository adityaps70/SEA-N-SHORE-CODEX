import { describe, expect, it } from 'vitest'
import {
  ASSIGNMENT_DEFAULTS,
  attachmentAccept,
  attachmentMimeType,
  attachmentRulesLabel,
  buildAssignmentAttachmentPath,
  isAssignmentAttachmentPath,
  validateAssignmentAttachment,
} from './assignment-policy'

const rules = { acceptedExtensions: [] as string[], maxUploadBytes: ASSIGNMENT_DEFAULTS.maxUploadBytes, maxFiles: ASSIGNMENT_DEFAULTS.maxFiles }
const ids = {
  enrollmentId: '11111111-1111-4111-8111-111111111111',
  lessonId: '22222222-2222-4222-8222-222222222222',
  submissionId: '33333333-3333-4333-8333-333333333333',
}

describe('assignment attachment rules', () => {
  it('defaults new assignments to 20 MB and 5 files', () => {
    expect(ASSIGNMENT_DEFAULTS).toMatchObject({ maxUploadBytes: 20 * 1024 * 1024, maxFiles: 5 })
  })

  it.each([
    ['report.pdf', 'application/pdf'],
    ['photo.JPG', 'image/jpeg'],
    ['photo.jpeg', 'image/jpeg'],
    ['deck.png', 'image/png'],
    ['letter.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['slides.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    ['old.doc', 'application/msword'],
    ['evidence.zip', 'application/zip'],
    ['evidence.zip', 'application/x-zip-compressed'],
    ['notes.txt', 'text/plain'],
  ])('accepts %s (%s)', (name, mimeType) => {
    expect(validateAssignmentAttachment({ name, mimeType, size: 1024, rules }).ok).toBe(true)
  })

  it.each([
    ['script.exe', 'application/x-msdownload'],
    ['page.html', 'text/html'],
    ['vector.svg', 'image/svg+xml'],
    ['clip.mp4', 'video/mp4'],
    ['renamed.pdf', 'image/png'],
    ['no-extension', 'application/pdf'],
  ])('refuses the wrong type: %s (%s)', (name, mimeType) => {
    const result = validateAssignmentAttachment({ name, mimeType, size: 1024, rules })
    expect(result.ok).toBe(false)
  })

  it('refuses an oversized file, naming the limit', () => {
    const result = validateAssignmentAttachment({ name: 'big.pdf', mimeType: 'application/pdf', size: 20 * 1024 * 1024 + 1, rules })
    expect(result).toEqual({ ok: false, error: '“big.pdf” is larger than 20 MB.' })
    expect(validateAssignmentAttachment({ name: 'fits.pdf', mimeType: 'application/pdf', size: 20 * 1024 * 1024, rules }).ok).toBe(true)
  })

  it('refuses empty files and never exceeds the 100 MB ceiling, whatever the assignment says', () => {
    expect(validateAssignmentAttachment({ name: 'empty.pdf', mimeType: 'application/pdf', size: 0, rules }).ok).toBe(false)
    const generous = { ...rules, maxUploadBytes: 500 * 1024 * 1024 }
    expect(validateAssignmentAttachment({ name: 'huge.pdf', mimeType: 'application/pdf', size: 101 * 1024 * 1024, rules: generous }).ok).toBe(false)
  })

  it('follows the extensions the trainer allowed (jpg and jpeg are the same)', () => {
    const pdfAndJpeg = { ...rules, acceptedExtensions: ['.pdf', '.jpeg'] }
    expect(validateAssignmentAttachment({ name: 'a.pdf', mimeType: 'application/pdf', size: 10, rules: pdfAndJpeg }).ok).toBe(true)
    expect(validateAssignmentAttachment({ name: 'a.jpg', mimeType: 'image/jpeg', size: 10, rules: pdfAndJpeg }).ok).toBe(true)
    expect(validateAssignmentAttachment({ name: 'a.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 10, rules: pdfAndJpeg }))
      .toEqual({ ok: false, error: '“a.docx” is not accepted for this assignment. Accepted: .pdf, .jpeg.' })
    expect(attachmentAccept(pdfAndJpeg)).toBe('.pdf,.jpeg')
  })

  it('infers the type from the file name when the browser reports none', () => {
    expect(attachmentMimeType({ name: 'report.docx', mimeType: '' })).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(attachmentMimeType({ name: 'report.pdf', mimeType: 'application/octet-stream' })).toBe('application/pdf')
  })

  it('describes the rules for learners', () => {
    expect(attachmentRulesLabel(rules)).toBe('PDF, Word, Excel, PowerPoint, images, text or ZIP · up to 20 MB each · up to 5 files')
  })

  it('stores every file under its own submission’s prefix and recognises only that prefix', () => {
    const path = buildAssignmentAttachmentPath({ ...ids, extension: 'pdf', fileId: '44444444-4444-4444-8444-444444444444' })
    expect(path).toBe(`learning-submissions/${ids.enrollmentId}/${ids.lessonId}/${ids.submissionId}/44444444-4444-4444-8444-444444444444.pdf`)
    expect(isAssignmentAttachmentPath({ ...ids, extension: 'pdf', storagePath: path })).toBe(true)
    expect(isAssignmentAttachmentPath({ ...ids, submissionId: '55555555-5555-4555-8555-555555555555', extension: 'pdf', storagePath: path })).toBe(false)
    expect(isAssignmentAttachmentPath({ ...ids, extension: 'zip', storagePath: path })).toBe(false)
    expect(isAssignmentAttachmentPath({ ...ids, extension: 'pdf', storagePath: `${path.slice(0, -4)}/../x.pdf` })).toBe(false)
  })
})
