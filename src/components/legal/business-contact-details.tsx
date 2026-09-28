import { Clock, Mail, MapPin, Phone } from 'lucide-react'
import {
  BUSINESS,
  businessAddressLine,
  businessRegistrations,
  telHref,
  type BusinessDetails,
} from '@/config/business'

/**
 * Who operates Sea N Shore and how to reach them. Only filled-in details are shown;
 * without a registered address the city line is shown instead.
 */
export function BusinessContactDetails({ business = BUSINESS }: { business?: BusinessDetails }) {
  const registrations = businessRegistrations(business)
  const hasFullAddress = Boolean(business.registeredAddress.trim())

  return (
    <div className="rounded-2xl border border-mist-100 bg-mist-50 p-5">
      <p className="text-base font-bold text-navy-950">{business.legalName}</p>
      <p className="text-sm text-muted">
        Operator of {business.brandName} ({business.brandTagline})
      </p>

      <dl className="mt-4 grid gap-3 text-sm leading-6">
        <div className="flex gap-3">
          <dt className="shrink-0">
            <MapPin aria-hidden="true" className="mt-1 size-4 text-ocean-700" />
            <span className="sr-only">{hasFullAddress ? 'Registered address' : 'Location'}</span>
          </dt>
          <dd className="min-w-0 text-navy-900">{businessAddressLine(business)}</dd>
        </div>
        {business.email ? (
          <div className="flex gap-3">
            <dt className="shrink-0">
              <Mail aria-hidden="true" className="mt-1 size-4 text-ocean-700" />
              <span className="sr-only">Email</span>
            </dt>
            <dd className="min-w-0 break-words">
              <a href={`mailto:${business.email}`} className="font-semibold text-ocean-700 hover:underline">{business.email}</a>
            </dd>
          </div>
        ) : null}
        {business.phone.display ? (
          <div className="flex gap-3">
            <dt className="shrink-0">
              <Phone aria-hidden="true" className="mt-1 size-4 text-ocean-700" />
              <span className="sr-only">Phone</span>
            </dt>
            <dd className="min-w-0">
              <a href={telHref(business.phone.tel || business.phone.display)} className="font-semibold text-ocean-700 hover:underline">
                {business.phone.display}
              </a>
            </dd>
          </div>
        ) : null}
        {business.supportHours ? (
          <div className="flex gap-3">
            <dt className="shrink-0">
              <Clock aria-hidden="true" className="mt-1 size-4 text-ocean-700" />
              <span className="sr-only">Support hours</span>
            </dt>
            <dd className="min-w-0 text-navy-900">{business.supportHours}</dd>
          </div>
        ) : null}
      </dl>

      {registrations.length ? (
        <p className="mt-4 text-xs text-muted">
          {registrations.map((entry) => `${entry.label}: ${entry.value}`).join(' · ')}
        </p>
      ) : null}
    </div>
  )
}
