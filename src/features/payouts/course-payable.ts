/**
 * The one "payable" rule for course earnings (C4), as SQL fragments, so the payout itself (createPayout), the admin
 * queue and review, and the seller's statement all agree.
 *
 * - Event-ticket earnings (and their refund adjustments) are payable as before.
 * - A course earning belongs to the calendar month in India (IST) of its created_at. Its seller invoices Sea N Shore
 *   for that month's course total: course earnings net_minor (fee already deducted) that are not reversed, which
 *   includes negative adjustments for course refunds made that month.
 * - A positive course earning is payable only once that month's seller invoice is approved, or when the month's
 *   total is 0 or less (nothing to invoice).
 * - A negative course adjustment (a refund after payout) is always payable: it only reduces what is paid.
 *
 * Every fragment takes the alias of a public.seller_earnings row and only builds SQL text (no values).
 */

const ALIAS = /^[a-z][a-z0-9_]{0,20}$/

function check(alias: string) {
  if (!ALIAS.test(alias)) throw new RangeError('sql_alias_invalid')
  return alias
}

/** Calendar month in India (YYYY-MM) of an earning (or any row with created_at). IST has no daylight saving. */
export function indiaMonthSql(alias: string) {
  return `to_char((${check(alias)}.created_at at time zone 'UTC') + interval '5 hours 30 minutes', 'YYYY-MM')`
}

/** The earning is a course purchase, or the refund adjustment of one. */
export function courseEarningSql(alias: string) {
  const a = check(alias)
  return `(${a}.source_type = 'course_purchase' or (${a}.source_type = 'adjustment' and exists (
    select 1 from public.seller_earnings ${a}_src where ${a}_src.id = ${a}.adjusts_earning_id and ${a}_src.source_type = 'course_purchase'
  )))`
}

/** Row b belongs to the same seller as row a (both have seller_profile_id / seller_company_id). */
export function sameSellerSql(a: string, b: string) {
  check(a)
  check(b)
  return `((${a}.seller_profile_id is not null and ${b}.seller_profile_id = ${a}.seller_profile_id) or (${a}.seller_company_id is not null and ${b}.seller_company_id = ${a}.seller_company_id))`
}

/** The month's course total for the earning's seller and month (what the seller invoices). */
export function monthCourseTotalSql(alias: string) {
  const a = check(alias)
  const m = `${a}_m`
  return `(select coalesce(sum(${m}.net_minor), 0) from public.seller_earnings ${m}
    where ${sameSellerSql(a, m)} and ${m}.currency = 'INR' and ${m}.status <> 'reversed'
      and ${courseEarningSql(m)} and ${indiaMonthSql(m)} = ${indiaMonthSql(a)})`
}

/** The seller's invoice for the earning's month is approved. */
export function invoiceApprovedSql(alias: string) {
  const a = check(alias)
  const i = `${a}_inv`
  return `exists (select 1 from public.seller_payout_invoices ${i}
    where ${i}.status = 'approved' and ${i}.period = ${indiaMonthSql(a)} and ${sameSellerSql(a, i)})`
}

/** The invoice gate: true when this earning may go into a payout (on top of status/currency/payout_id). */
export function payableEarningSql(alias: string) {
  const a = check(alias)
  return `(not ${courseEarningSql(a)} or ${a}.net_minor <= 0 or ${invoiceApprovedSql(a)} or ${monthCourseTotalSql(a)} <= 0)`
}

/** A positive course earning held back until its month's invoice is approved. */
export function awaitingInvoiceSql(alias: string) {
  return `(not ${payableEarningSql(alias)})`
}

/** Base filter of earnings that a payout could include (before the invoice gate). */
export function readyEarningSql(alias: string) {
  const a = check(alias)
  return `${a}.status = 'available' and ${a}.currency = 'INR' and ${a}.payout_id is null`
}
