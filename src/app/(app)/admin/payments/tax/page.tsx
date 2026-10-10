import type { Metadata } from 'next'
import { AdminPageHeader, AdminPanel, formatAdminDate } from '@/features/admin/components/admin-ui'
import { requirePaymentsAdmin } from '@/features/payouts/admin-guard'
import { PaymentsAdminTabs } from '@/features/payouts/components/admin/payments-admin-tabs'
import { readClient } from '@/features/payouts/payout-runtime'
import { GstExportPanel } from '@/features/tax/components/gst-export-panel'
import { LutForm, TdsSettingsForm } from '@/features/tax/components/tax-settings-forms'
import { COURSE_SAC, financialYearOf, GST_SUPPLIER } from '@/features/tax/gst'
import { getTaxSettings, listLutRegistrations } from '@/features/tax/tax-settings'

export const metadata: Metadata = { title: 'Tax · Payments · Admin' }
export const dynamic = 'force-dynamic'

function rupees(minor: number | null) {
  return minor === null ? '' : (minor / 100).toFixed(2).replace(/\.00$/, '')
}

/** C4: GST invoicing details, the LUT per financial year, and TDS on course-seller payouts. */
export default async function AdminPaymentTaxPage() {
  await requirePaymentsAdmin()
  const [settings, luts] = await Promise.all([getTaxSettings(readClient), listLutRegistrations(readClient)])
  const currentYear = financialYearOf(new Date())
  const currentLut = luts.find((lut) => lut.financialYear === currentYear) ?? null

  return (
    <main className="space-y-6">
      <AdminPageHeader title="Payments" meta="GST invoices, LUT and TDS" />
      <PaymentsAdminTabs />

      <AdminPanel>
        <div className="border-b border-mist-100 px-5 py-3">
          <h3 className="text-sm font-bold text-navy-950">GST invoices</h3>
          <p className="text-xs text-muted">Every course sale gets a numbered tax invoice (SNS/YY-YY/000001); a refund gets a credit note (SNC/YY-YY/000001).</p>
        </div>
        <dl className="grid gap-x-6 gap-y-2 p-5 text-sm sm:grid-cols-[12rem_1fr]">
          <dt className="font-semibold text-navy-900">Supplier</dt>
          <dd>{GST_SUPPLIER.legalName} ({GST_SUPPLIER.tradeName})</dd>
          <dt className="font-semibold text-navy-900">GSTIN</dt>
          <dd className="font-mono">{GST_SUPPLIER.gstin} · {GST_SUPPLIER.registration}</dd>
          <dt className="font-semibold text-navy-900">Address</dt>
          <dd>{GST_SUPPLIER.address.join(', ')}</dd>
          <dt className="font-semibold text-navy-900">SAC and rate</dt>
          <dd>{COURSE_SAC} · GST 18% included in course prices (Maharashtra: CGST 9% + SGST 9%; other states: IGST 18%)</dd>
        </dl>
      </AdminPanel>

      <GstExportPanel />

      <AdminPanel>
        <div className="border-b border-mist-100 px-5 py-3">
          <h3 className="text-sm font-bold text-navy-950">Letter of Undertaking (exports)</h3>
          <p className={`text-xs ${currentLut ? 'text-muted' : 'font-semibold text-amber-800'}`}>
            {currentLut
              ? `USD course purchases are open for ${currentYear} as zero-rated exports under LUT ${currentLut.arn}.`
              : `USD course purchases are switched off until an LUT ARN is saved for ${currentYear}.`}
          </p>
        </div>
        {luts.length ? (
          <ul className="divide-y divide-mist-100 border-b border-mist-100 px-5 text-sm">
            {luts.map((lut) => (
              <li key={lut.financialYear} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="font-semibold text-navy-950">{lut.financialYear}</span>
                <span className="font-mono">{lut.arn}</span>
                <span className="text-xs text-muted">Saved {formatAdminDate(lut.updatedAt)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <LutForm financialYear={currentYear} />
      </AdminPanel>

      <AdminPanel>
        <div className="border-b border-mist-100 px-5 py-3">
          <h3 className="text-sm font-bold text-navy-950">TDS on course payouts</h3>
          <p className={`text-xs ${settings.tdsRateBasisPoints === null ? 'font-semibold text-amber-800' : 'text-muted'}`}>
            {settings.tdsRateBasisPoints === null
              ? 'Course payouts are on hold: set the TDS rate (and the yearly threshold) to release them.'
              : `Section ${settings.tdsSection} at ${settings.tdsRateBasisPoints / 100}%${settings.tdsThresholdMinor !== null ? `, once a seller passes ₹${rupees(settings.tdsThresholdMinor)} in a financial year` : ', from the first rupee'}.`}
          </p>
        </div>
        <TdsSettingsForm
          section={settings.tdsSection}
          rate={settings.tdsRateBasisPoints === null ? '' : String(settings.tdsRateBasisPoints / 100)}
          threshold={rupees(settings.tdsThresholdMinor)}
        />
      </AdminPanel>
    </main>
  )
}
