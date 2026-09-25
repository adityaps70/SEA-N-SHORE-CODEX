'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Capability } from '@/features/access/policy'
import {
  ADMIN_ORGANIZATION_GRANTABLE_CAPABILITIES,
  ADMIN_PERSONAL_GRANTABLE_CAPABILITIES,
  type AdminEntitlementSubjectType,
} from '../membership-repository'
import { grantAdminEntitlement, revokeAdminEntitlement } from '../membership-actions'

type EntitlementHistoryItem = {
  id: string
  capability: Capability
  source: string
  reason: string | null
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
  active: boolean
}

function label(capability: Capability) {
  return capability.replaceAll('.', ' · ').replaceAll('_', ' ')
}

export function AdminEntitlementControlPanel({
  subjectType,
  subjectId,
  entitlementHistory,
}: {
  subjectType: AdminEntitlementSubjectType
  subjectId: string
  entitlementHistory: EntitlementHistoryItem[]
}) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const capabilities = subjectType === 'profile'
    ? ADMIN_PERSONAL_GRANTABLE_CAPABILITIES
    : ADMIN_ORGANIZATION_GRANTABLE_CAPABILITIES
  const activeCapabilities = useMemo(
    () => new Set(entitlementHistory.filter((item) => item.active).map((item) => item.capability)),
    [entitlementHistory],
  )
  const firstAvailable = capabilities.find((capability) => !activeCapabilities.has(capability)) ?? capabilities[0]
  const [capability, setCapability] = useState<Capability>(firstAvailable)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function grant() {
    setFeedback(null)
    startTransition(async () => {
      const result = await grantAdminEntitlement({
        subjectType,
        subjectId,
        capability,
        reason,
      })
      if (!result.ok) {
        setFeedback(result.error)
        return
      }
      setFeedback('Entitlement granted and recorded in the audit trail.')
      setReason('')
      router.refresh()
    })
  }

  function revoke(grantId: string) {
    setFeedback(null)
    startTransition(async () => {
      const result = await revokeAdminEntitlement(grantId, reason)
      if (!result.ok) {
        setFeedback(result.error)
        return
      }
      setFeedback('Entitlement revoked and recorded in the audit trail.')
      setReason('')
      router.refresh()
    })
  }

  return (
    <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-red-700">Manual entitlement control</p>
        <h2 className="mt-1 text-xl font-bold text-navy-950">Grant or revoke narrow migration/support access</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Manual grants do not change the subscription plan and cannot bypass required professional verification or account suspension.
        </p>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] sm:items-end">
        <label className="grid gap-1.5 text-sm font-semibold text-navy-900">
          Capability
          <select
            value={capability}
            onChange={(event) => setCapability(event.target.value as Capability)}
            className="min-h-11 rounded-xl border border-mist-100 bg-white px-3 text-sm"
          >
            {capabilities.map((item) => (
              <option key={item} value={item} disabled={activeCapabilities.has(item)}>
                {label(item)}{activeCapabilities.has(item) ? ' · active' : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5 text-sm font-semibold text-navy-900">
          Reason
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Required for every grant or revoke action"
            maxLength={1000}
            className="min-h-11 rounded-xl border border-mist-100 bg-white px-3 text-sm"
          />
        </label>

        <button
          type="button"
          onClick={grant}
          disabled={pending || activeCapabilities.has(capability)}
          className="min-h-11 rounded-xl bg-navy-950 px-4 text-sm font-bold text-white disabled:opacity-50"
        >
          Grant entitlement
        </button>
      </div>

      {feedback ? <p role="status" className="mt-3 text-sm text-muted">{feedback}</p> : null}

      <div className="mt-6 border-t border-mist-100 pt-5">
        <p className="text-xs font-bold uppercase tracking-[0.13em] text-muted">Entitlement history</p>
        <div className="mt-3 divide-y divide-mist-100">
          {entitlementHistory.map((item) => {
            const revocable = item.active && (item.source === 'admin' || item.source === 'legacy_migration')
            return (
              <article key={item.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-bold text-navy-950">{label(item.capability)}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${item.active ? 'bg-emerald-50 text-emerald-800' : 'bg-mist-50 text-muted'}`}>
                      {item.active ? 'Active' : 'Inactive'}
                    </span>
                    <span className="rounded-full bg-mist-50 px-2 py-0.5 text-[11px] font-semibold text-muted">{item.source.replaceAll('_', ' ')}</span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    {item.reason ?? 'No reason recorded'}
                    {item.revokedAt ? ` · Revoked ${new Date(item.revokedAt).toLocaleDateString()}` : ''}
                    {item.expiresAt ? ` · Expires ${new Date(item.expiresAt).toLocaleDateString()}` : ''}
                  </p>
                </div>
                {revocable ? (
                  <button
                    type="button"
                    onClick={() => revoke(item.id)}
                    disabled={pending}
                    className="min-h-9 shrink-0 rounded-xl border border-red-200 px-3 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    Revoke
                  </button>
                ) : null}
              </article>
            )
          })}
          {entitlementHistory.length === 0 ? (
            <p className="py-4 text-sm text-muted">No manual or grandfathered entitlement history is recorded.</p>
          ) : null}
        </div>
      </div>
    </section>
  )
}
