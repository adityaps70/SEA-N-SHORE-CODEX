import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { AdminPageHeader, AdminPanel } from '@/features/admin/components/admin-ui'
import { categoryError, categoryNotice } from '@/features/community/category-admin-messages'
import { createCommunityCategory } from '@/features/community/category-admin-actions'
import { communityCategoryRepository } from '@/features/community/category-repository'
import { CategoryAdminList, CategoryIconSelect } from '@/features/community/components/category-admin-list'
import { COMMUNITY_CATEGORY_DESCRIPTION_MAX_LENGTH, COMMUNITY_CATEGORY_NAME_MAX_LENGTH } from '@/features/community/types'
import { pluralize } from '@/lib/format'
import { requireAdminAccess } from '@/features/admin/admin-access'

export const metadata: Metadata = { title: 'Community categories' }
export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function single(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) ?? ''
}

const inputClass = 'min-h-10 w-full rounded-lg border border-mist-200 bg-white px-3 text-sm text-navy-950 outline-none focus:border-ocean-400 focus:ring-2 focus:ring-ocean-100'

/**
 * Round I (I2): Admin › Communities › Categories. The categories community owners choose from, in the order the
 * directory chips, the picker and the search facet use.
 */
export default async function CommunityCategoriesAdminPage({ searchParams }: { searchParams: SearchParams }) {
  try {
    await requireAdminAccess('platform')
  } catch (error) {
    if (error instanceof Error && error.message === 'admin_forbidden') notFound()
    throw error
  }
  const params = await searchParams
  const categories = await communityCategoryRepository.listAll()
  const notice = categoryNotice(single(params.notice), Number.parseInt(single(params.count), 10) || 0)
  const error = categoryError(single(params.error))
  const shown = categories.filter((category) => !category.hidden).length

  return (
    <div className="space-y-4">
      <Link href="/admin/communities" className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-ocean-700 hover:underline">
        <ArrowLeft aria-hidden="true" className="size-4" /> Communities
      </Link>
      <AdminPageHeader
        title="Community categories"
        meta={`${pluralize(categories.length, 'category', 'categories')} · ${shown} shown`}
        description="Owners pick one of these for their community. The order here is the order of the directory chips, the picker and the search facet. Hidden categories leave the picker but stay on their communities. A category in use can only be deleted after its communities move to another one."
      />

      {notice ? <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">{notice}</p> : null}
      {error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      <AdminPanel>
        <CategoryAdminList categories={categories} />
      </AdminPanel>

      <AdminPanel>
        <section aria-labelledby="add-category-heading" className="space-y-3 p-4">
          <h3 id="add-category-heading" className="text-lg font-bold text-navy-950">Add a category</h3>
          <form action={createCommunityCategory} className="grid gap-3 md:grid-cols-2">
            <label className="block text-sm font-semibold text-navy-950">
              Name
              <input name="name" required maxLength={COMMUNITY_CATEGORY_NAME_MAX_LENGTH} aria-describedby="add-category-name-hint" className={`${inputClass} mt-1`} placeholder="e.g. Offshore & Energy" />
              <span id="add-category-name-hint" className="mt-1 block text-xs font-normal text-muted">Up to {COMMUNITY_CATEGORY_NAME_MAX_LENGTH} characters. The web address is made from the name.</span>
            </label>
            <CategoryIconSelect id="add-category-icon" />
            <label className="block text-sm font-semibold text-navy-950 md:col-span-2">
              Short description (optional)
              <input name="description" maxLength={COMMUNITY_CATEGORY_DESCRIPTION_MAX_LENGTH} className={`${inputClass} mt-1`} placeholder="Who the communities in this category are for." />
            </label>
            <div className="md:col-span-2">
              <button type="submit" className="min-h-10 rounded-lg bg-navy-950 px-4 text-sm font-semibold text-white hover:bg-navy-900">Add category</button>
            </div>
          </form>
        </section>
      </AdminPanel>
    </div>
  )
}
