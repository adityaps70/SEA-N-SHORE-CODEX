import { revalidatePath } from 'next/cache'
import { communityDirectoryChipsCache } from './category-repository'

/** Round I (I2): the pages that show community categories, refreshed after an admin change. */
export function revalidateCategoryPages() {
  // Round CAP: the shared directory chips cache on this task (other tasks within 30 s).
  communityDirectoryChipsCache.clear()
  revalidatePath('/admin/communities/categories')
  revalidatePath('/admin/communities')
  revalidatePath('/community')
  revalidatePath('/community/new')
  revalidatePath('/community/[slug]', 'page')
  revalidatePath('/search')
}
