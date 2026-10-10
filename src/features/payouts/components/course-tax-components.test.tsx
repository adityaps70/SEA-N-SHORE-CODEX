import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  saveTax: vi.fn(),
  startUpload: vi.fn(),
  submitInvoice: vi.fn(),
  upload: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }), usePathname: () => '/admin/payments/seller-invoices' }))
vi.mock('../seller-tax-actions', () => ({ saveTaxDetailsAction: mocks.saveTax, startSellerInvoiceUploadAction: mocks.startUpload, submitSellerInvoiceAction: mocks.submitInvoice }))
vi.mock('../seller-invoice-admin-actions', () => ({ approveSellerInvoiceAction: mocks.approve, rejectSellerInvoiceAction: mocks.reject }))
vi.mock('@/features/learning/components/upload-learning-media', () => ({ uploadLearningMediaFile: mocks.upload }))
vi.mock('../../admin-actions', () => ({ updateFeeSettingsAction: vi.fn() }))

import { PaymentsAdminTabs } from './admin/payments-admin-tabs'
import { SellerInvoiceReviewActions } from './admin/seller-invoice-review-actions'
import { TdsExportPanel } from './admin/tds-export-panel'
import { SellerInvoiceMonths } from './seller-invoice-months'
import { TaxDetailsPanel } from './tax-details-panel'

const key = 'profile:44444444-4444-4444-8444-444444444444'
const INVOICE = '99999999-9999-4999-8999-999999999999'

beforeEach(() => vi.clearAllMocks())
afterEach(() => cleanup())

describe('TaxDetailsPanel', () => {
  it('adds tax details: asks for GSTIN only when registered, shows field errors, then shows the PAN masked', async () => {
    mocks.saveTax.mockResolvedValueOnce({ ok: false, error: 'Check the highlighted fields.', fieldErrors: { gstin: 'Enter a valid 15-character GSTIN.' } })
    mocks.saveTax.mockResolvedValueOnce({
      ok: true,
      message: 'Tax details saved. PAN ABCDE****F, GST registered: upload a tax invoice for each month of course earnings.',
      profile: { legalName: 'Fixture Seller', maskedPan: 'ABCDE****F', gstRegistered: true, maskedGstin: '27ABCDE****F1Z5', updatedAt: '2026-10-10T00:00:00.000Z' },
    })
    render(<TaxDetailsPanel sellerKey={key} sellerName="You" kind="profile" profile={null} />)
    expect(screen.getByText(/No tax details yet/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add tax details' }))
    const form = screen.getByRole('form', { name: 'Add tax details' })
    await waitFor(() => expect(within(form).getByLabelText('Legal name (as on the PAN)')).toHaveFocus())
    expect(within(form).queryByLabelText('GSTIN')).not.toBeInTheDocument()
    fireEvent.change(within(form).getByLabelText('Legal name (as on the PAN)'), { target: { value: 'Fixture Seller' } })
    fireEvent.change(within(form).getByLabelText('PAN'), { target: { value: 'abcde1234f' } })
    fireEvent.click(within(form).getByLabelText(/Yes, GST registered/))
    fireEvent.change(within(form).getByLabelText('GSTIN'), { target: { value: '27ABCDE1234F1Z0' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save tax details' }))
    expect(await within(form).findByText('Enter a valid 15-character GSTIN.')).toBeInTheDocument()
    expect(within(form).getByLabelText('GSTIN')).toHaveAttribute('aria-invalid', 'true')
    expect(mocks.saveTax).toHaveBeenCalledWith(key, { legalName: 'Fixture Seller', pan: 'abcde1234f', gstRegistered: 'yes', gstin: '27ABCDE1234F1Z0' })

    fireEvent.change(within(form).getByLabelText('GSTIN'), { target: { value: '27ABCDE1234F1Z5' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save tax details' }))
    expect(await screen.findByRole('status')).toHaveTextContent('PAN ABCDE****F')
    expect(screen.getByText('ABCDE****F')).toBeInTheDocument()
    expect(screen.getByText('Registered · 27ABCDE****F1Z5')).toBeInTheDocument()
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('ABCDE1234F')
  })
})

describe('SellerInvoiceMonths', () => {
  const due = { period: '2026-09', expectedMinor: 180_000, state: 'due' as const, invoice: null }

  function pickFile(form: HTMLElement, file: File) {
    fireEvent.change(within(form).getByLabelText('Invoice file'), { target: { files: [file] } })
  }

  it('refuses a wrong amount in the page, naming the exact amount, without uploading', async () => {
    render(<SellerInvoiceMonths sellerKey={key} kind="profile" months={[due]} gstRegistered={false} taxDetailsHref="/settings/payouts" />)
    fireEvent.click(screen.getByRole('button', { name: 'Upload invoice' }))
    const form = screen.getByRole('form', { name: 'Upload invoice for September 2026' })
    expect(form).toHaveTextContent('bill of supply')
    expect(form).toHaveTextContent('Beaufort Marine Services LLP')
    fireEvent.change(within(form).getByLabelText('Your invoice number'), { target: { value: 'B-12' } })
    fireEvent.change(within(form).getByLabelText('Invoice total (₹)'), { target: { value: '1799.99' } })
    pickFile(form, new File(['%PDF-1.7'], 'bill.pdf', { type: 'application/pdf' }))
    fireEvent.click(within(form).getByRole('button', { name: 'Upload invoice' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent('must be exactly ₹1,800.00')
    expect(within(form).getByLabelText('Invoice total (₹)')).toHaveAttribute('aria-invalid', 'true')
    expect(mocks.startUpload).not.toHaveBeenCalled()
  })

  it('uploads straight to storage, then records the invoice and shows it as waiting for review', async () => {
    mocks.startUpload.mockResolvedValue({ ok: true, uploadUrl: 'https://bucket.example/put', storagePath: 'seller-invoices/profile-x/2026-09/y.pdf', contentType: 'application/pdf' })
    mocks.upload.mockImplementation(async ({ onProgress }: { onProgress: (value: number) => void }) => onProgress(100))
    mocks.submitInvoice.mockResolvedValue({ ok: true, message: 'Invoice for September 2026 sent for review.' })
    render(<SellerInvoiceMonths sellerKey={key} kind="profile" months={[due]} gstRegistered taxDetailsHref="/settings/payouts" />)
    fireEvent.click(screen.getByRole('button', { name: 'Upload invoice' }))
    const form = screen.getByRole('form', { name: 'Upload invoice for September 2026' })
    expect(form).toHaveTextContent('tax invoice')
    fireEvent.change(within(form).getByLabelText('Your invoice number'), { target: { value: 'INV-42' } })
    fireEvent.change(within(form).getByLabelText('Invoice total (₹)'), { target: { value: '1,800' } })
    const file = new File(['%PDF-1.7'], 'invoice.pdf', { type: 'application/pdf' })
    pickFile(form, file)
    fireEvent.click(within(form).getByRole('button', { name: 'Upload invoice' }))
    expect(await screen.findByText('Invoice for September 2026 sent for review.')).toBeInTheDocument()
    const fields = { period: '2026-09', documentNumber: 'INV-42', amount: '1,800', name: 'invoice.pdf', mimeType: 'application/pdf', size: file.size }
    expect(mocks.startUpload).toHaveBeenCalledWith(key, fields)
    expect(mocks.upload).toHaveBeenCalledWith(expect.objectContaining({ uploadUrl: 'https://bucket.example/put', file, contentType: 'application/pdf' }))
    expect(mocks.submitInvoice).toHaveBeenCalledWith(key, { ...fields, storagePath: 'seller-invoices/profile-x/2026-09/y.pdf' })
    expect(screen.getByText('Waiting for review')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Upload invoice' })).not.toBeInTheDocument()
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('shows the server’s reason when the upload is refused', async () => {
    mocks.startUpload.mockResolvedValue({ ok: false, error: 'An invoice for this month is already waiting for review.' })
    render(<SellerInvoiceMonths sellerKey={key} kind="organization" months={[due]} gstRegistered={false} taxDetailsHref="/settings/payouts" />)
    fireEvent.click(screen.getByRole('button', { name: 'Upload invoice' }))
    const form = screen.getByRole('form', { name: 'Upload invoice for September 2026' })
    fireEvent.change(within(form).getByLabelText('Your invoice number'), { target: { value: 'B-1' } })
    fireEvent.change(within(form).getByLabelText('Invoice total (₹)'), { target: { value: '1800.00' } })
    pickFile(form, new File(['%PDF-1.7'], 'bill.pdf', { type: 'application/pdf' }))
    fireEvent.click(within(form).getByRole('button', { name: 'Upload invoice' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent('already waiting for review')
    expect(mocks.upload).not.toHaveBeenCalled()
  })
})

describe('SellerInvoiceReviewActions', () => {
  it('approves, or rejects with a note for the seller', async () => {
    mocks.approve.mockResolvedValue({ ok: true, message: 'Approved. The course earnings for September 2026 can now be paid out.' })
    render(<SellerInvoiceReviewActions invoiceId={INVOICE} summary="Fixture Seller, September 2026" canApprove />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve invoice for Fixture Seller, September 2026' }))
    expect(await screen.findByRole('status')).toHaveTextContent('can now be paid out')
    expect(mocks.approve).toHaveBeenCalledWith(INVOICE)
    expect(mocks.refresh).toHaveBeenCalled()
    cleanup()

    mocks.reject.mockResolvedValueOnce({ ok: false, error: 'Tell the seller what to fix (at least 5 characters).' })
    mocks.reject.mockResolvedValueOnce({ ok: true, message: 'Rejected. The seller sees your note.' })
    render(<SellerInvoiceReviewActions invoiceId={INVOICE} summary="Fixture Seller, August 2026" canApprove={false} />)
    expect(screen.queryByRole('button', { name: /Approve/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reject invoice for Fixture Seller, August 2026' }))
    const form = screen.getByRole('form', { name: 'Reject invoice for Fixture Seller, August 2026' })
    await waitFor(() => expect(within(form).getByLabelText('What should the seller fix?')).toHaveFocus())
    fireEvent.click(within(form).getByRole('button', { name: 'Reject invoice' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('what to fix')
    fireEvent.change(within(form).getByLabelText('What should the seller fix?'), { target: { value: 'The bill is not signed.' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Reject invoice' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Rejected')
    expect(mocks.reject).toHaveBeenLastCalledWith(INVOICE, 'The bill is not signed.')
  })
})

describe('TdsExportPanel and tabs', () => {
  it('links the chosen month to the CSV export', () => {
    render(<TdsExportPanel defaultMonth="2026-09" />)
    expect(screen.getByRole('link', { name: 'Download TDS report for September 2026' })).toHaveAttribute('href', '/api/admin/tax/tds?month=2026-09')
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-08' } })
    expect(screen.getByRole('link', { name: 'Download TDS report for August 2026' })).toHaveAttribute('href', '/api/admin/tax/tds?month=2026-08')
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '' } })
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download TDS report' })).toBeDisabled()
  })

  it('has a Seller invoices tab in Admin → Payments', () => {
    render(<PaymentsAdminTabs />)
    expect(screen.getByRole('link', { name: 'Seller invoices' })).toHaveAttribute('aria-current', 'page')
  })
})
