import { revalidatePath } from 'next/cache'

/** Round I (I2): the pages that show community categories, refreshed after an admin change. */
export function revalidateCategoryPages() {
  revalidatePath('/admin/communities/categories')
  revalidatePath('/admin/communities')
  revalidatePath('/community')
  revalidatePath('/community/new')
  revalidatePath('/community/[slug]', 'page')
  revalidatePath('/search')
}
