import { z } from 'zod'

/** Round I (I2): the community form's category: one of the admin-managed categories, always chosen. */
export const CATEGORY_REQUIRED_MESSAGE = 'Choose a category from the list.'
export const categoryIdSchema = z.string({ message: CATEGORY_REQUIRED_MESSAGE }).trim().uuid({ message: CATEGORY_REQUIRED_MESSAGE })
