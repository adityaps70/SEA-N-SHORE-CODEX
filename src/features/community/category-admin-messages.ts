import { COMMUNITY_CATEGORY_DESCRIPTION_MAX_LENGTH, COMMUNITY_CATEGORY_NAME_MAX_LENGTH } from './types'

/** Round I (I2): what Admin › Communities › Categories says after a change (?notice=) or a refusal (?error=). */
export function categoryNotice(notice: string, count = 0): string | null {
  const communities = `${count} ${count === 1 ? 'community' : 'communities'}`
  switch (notice) {
    case 'created': return 'Category added. It is offered in the community picker now.'
    case 'saved': return 'Category saved.'
    case 'moved_up': return 'Moved up.'
    case 'moved_down': return 'Moved down.'
    case 'hidden': return 'Category hidden. It is gone from the picker, the directory chips and search, and stays on its communities.'
    case 'shown': return 'Category shown again.'
    case 'moved': return `Moved ${communities}.`
    case 'moved_deleted': return `Moved ${communities} and deleted the category.`
    case 'deleted': return 'Category deleted.'
    default: return null
  }
}

export function categoryError(error: string): string | null {
  switch (error) {
    case 'forbidden': return 'Only Sea N Shore administrators can change community categories.'
    case 'category_name_invalid': return `Give the category a name of 1 to ${COMMUNITY_CATEGORY_NAME_MAX_LENGTH} characters, with at least one letter or number.`
    case 'category_name_taken': return 'Another category already has that name.'
    case 'category_description_invalid': return `Keep the description to ${COMMUNITY_CATEGORY_DESCRIPTION_MAX_LENGTH} characters.`
    case 'category_icon_invalid': return 'Choose an icon from the list.'
    case 'category_not_found': return 'That category no longer exists. The list below is up to date.'
    case 'category_in_use': return 'Communities still use this category. Move its communities to another category first.'
    case 'category_move_target_invalid': return 'Choose another category to move the communities to.'
    case 'failed': return 'That change could not be saved. Please try again.'
    default: return null
  }
}
