import type { FaqGroup, FaqItem } from './faq-data'

/**
 * Round H (H7): the /help FAQ filter. Case- and accent-insensitive; every word of the query must appear
 * in the question or the answer. An empty query keeps every question.
 */
export function normalizeFaqText(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function faqQueryTerms(query: string) {
  return normalizeFaqText(query).split(/[^\p{L}\p{N}₹]+/u).filter(Boolean)
}

export function faqItemMatches(item: FaqItem, terms: readonly string[]) {
  if (!terms.length) return true
  const text = normalizeFaqText(`${item.question} ${item.answer}`)
  return terms.every((term) => text.includes(term))
}

export function searchFaqGroups(groups: readonly FaqGroup[], query: string) {
  const terms = faqQueryTerms(query)
  const results = groups.map((group) => ({ group, items: group.items.filter((item) => faqItemMatches(item, terms)) }))
  return { groups: results, total: results.reduce((sum, result) => sum + result.items.length, 0) }
}
