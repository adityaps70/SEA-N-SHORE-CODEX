import type { Metadata } from 'next'
import { AdminPageHeader, AdminPanel, formatAdminDate } from '@/features/admin/components/admin-ui'
import { getPlatformFeeSettings } from '@/features/payments/earnings'
import { requirePaymentsAdmin } from '@/features/payouts/admin-guard'
import { FeeOverrideManager } from '@/features/payouts/components/admin/fee-override-manager'
import { FeeSettingsForm } from '@/features/payouts/components/admin/fee-settings-form'
import { PaymentsAdminTabs } from '@/features/payouts/components/admin/payments-admin-tabs'
import { listFeeOverrides } from '@/features/payouts/payout-queries'
import { getPayoutSettings } from '@/features/payouts/payout-repository'
import { formatPercentLabel, minorToRupeesInput, sellerKey } from '@/features/payouts/payout-rules'
import { readClient } from '@/features/payouts/payout-runtime'

export const metadata: Metadata = { title: 'Fees · Payments · Admin' }
export const dynamic = 'force-dynamic'

export default async function AdminPaymentFeesPage() {
  await requirePaymentsAdmin()
  const [fees, payoutSettings, overrides] = await Promise.all([
    getPlatformFeeSettings(readClient),
    getPayoutSettings(readClient),
    listFeeOverrides(readClient),
  ])

  return (
    <main className="space-y-6">
      <AdminPageHeader title="Payments" meta="Platform fee and payout rules" />
      <PaymentsAdminTabs />

      <AdminPanel>
        <div className="border-b border-mist-100 px-5 py-3">
          <h3 className="text-sm font-bold text-navy-950">Default rules</h3>
          <p className="text-xs text-muted">Sellers receive the sale price minus the platform fee, rounded to the paisa.</p>
        </div>
        <FeeSettingsForm
          defaultPercent={String(Number(fees.defaultPercent))}
          holdDays={fees.holdDays}
          minPayout={minorToRupeesInput(payoutSettings.minPayoutMinor)}
        />
      </AdminPanel>

      <AdminPanel>
        <div className="border-b border-mist-100 px-5 py-3">
          <h3 className="text-sm font-bold text-navy-950">Seller-specific fees</h3>
          <p className="text-xs text-muted">{overrides.length ? `${overrides.length} seller${overrides.length === 1 ? ' has' : 's have'} their own rate.` : 'A person or organization can have their own rate instead of the default.'}</p>
        </div>
        <FeeOverrideManager
          defaultPercentLabel={formatPercentLabel(fees.defaultPercent)}
          overrides={overrides.map((override) => ({
            key: sellerKey(override.sellerIdentity.seller),
            name: override.sellerIdentity.name,
            kind: override.sellerIdentity.kind,
            percentLabel: formatPercentLabel(override.percent),
            note: override.note,
            updatedLabel: `Set ${formatAdminDate(override.updatedAt)}${override.updatedByName ? ` by ${override.updatedByName}` : ''}`,
          }))}
        />
      </AdminPanel>
    </main>
  )
}
