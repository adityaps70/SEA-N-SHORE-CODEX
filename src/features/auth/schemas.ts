import { z } from 'zod'

const email = z.string().trim().toLowerCase().email().max(254)
const password = z.string().min(12).max(72)

export const signUpSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email,
  password,
})

export const signInSchema = z.object({ email, password: z.string().min(1).max(72) })
export const resetPasswordSchema = z.object({ email })
