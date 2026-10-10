import { COURSE_SAC, GST_SUPPLIER, gstBreakup, gstinCheckCharacter, type SupplyType } from './gst'
import type { TaxCreditNote, TaxInvoice } from './tax-document-repository'

/** Test-only GST documents with generic placeholder data. Never imported by application code. */

export const FIXTURE_BUYER_GSTIN = `27AAACF1234A1Z${gstinCheckCharacter('27AAACF1234A1Z')}`

export function sampleInvoice(overrides: Partial<TaxInvoice> & { supplyType?: SupplyType } = {}): TaxInvoice {
  const supplyType = overrides.supplyType ?? 'intra_state'
  const totalMinor = overrides.totalMinor ?? 499_900
  const breakup = gstBreakup(totalMinor, supplyType)
  const exported = supplyType === 'export_lut'
  return {
    id: '11111111-1111-4111-8111-111111111111',
    invoiceNumber: 'SNS/26-27/000001',
    financialYear: '2026-27',
    orderId: '22222222-2222-4222-8222-222222222222',
    buyerProfileId: '33333333-3333-4333-8333-333333333333',
    invoiceDate: '2026-10-05',
    issuedAt: '2026-10-05T06:30:00.000Z',
    supplier: GST_SUPPLIER,
    buyerName: 'Fixture Learner',
    buyerCompany: exported ? null : 'Fixture Shipping Pvt Ltd',
    buyerGstin: exported ? null : FIXTURE_BUYER_GSTIN,
    placeOfSupplyCode: exported ? '96' : supplyType === 'intra_state' ? '27' : '29',
    placeOfSupplyName: exported ? 'Outside India (export)' : supplyType === 'intra_state' ? 'Maharashtra' : 'Karnataka',
    supplyType,
    lutArn: exported ? 'AD2703260000001' : null,
    sac: COURSE_SAC,
    description: 'SIRE 2.0 Inspection Readiness: online course access',
    currency: exported ? 'USD' : 'INR',
    gstRateBasisPoints: breakup.rateBasisPoints,
    taxableMinor: breakup.taxableMinor,
    cgstMinor: breakup.cgstMinor,
    sgstMinor: breakup.sgstMinor,
    igstMinor: breakup.igstMinor,
    totalMinor: breakup.totalMinor,
    orderReference: 'crs_22222222222242228222222222222222',
    ...overrides,
  }
}

export function sampleCreditNote(invoice: TaxInvoice, overrides: Partial<TaxCreditNote> = {}): TaxCreditNote {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    creditNoteNumber: 'SNC/26-27/000001',
    financialYear: '2026-27',
    invoiceId: invoice.id,
    noteDate: '2026-10-09',
    issuedAt: '2026-10-09T06:30:00.000Z',
    reason: 'Course purchase refunded',
    taxableMinor: invoice.taxableMinor,
    cgstMinor: invoice.cgstMinor,
    sgstMinor: invoice.sgstMinor,
    igstMinor: invoice.igstMinor,
    totalMinor: invoice.totalMinor,
    ...overrides,
  }
}
