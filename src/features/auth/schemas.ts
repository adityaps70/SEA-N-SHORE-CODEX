import { z } from 'zod'

const email = z.string().trim().toLowerCase()
  .email('Enter a valid email address.')
  .max(254, 'Your email address can be at most 254 characters.')
const password = z.string().min(12).max(72)

export const signUpSchema = z.object({
  fullName: z.string().trim()
    .min(2, 'Enter your full name.')
    .max(120, 'Your full name can be at most 120 characters.'),
  email,
  password,
})

export const signInSchema = z.object({ email, password: z.string().min(1).max(72) })
export const resetPasswordSchema = z.object({ email })
