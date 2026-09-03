import { z } from 'zod'

const publicEnvironmentSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
})

export const publicEnvironment = publicEnvironmentSchema.parse({
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
})

const cognitoEnvironmentSchema = z.object({
  AWS_COGNITO_REGION: z.string().min(1),
  AWS_COGNITO_USER_POOL_ID: z.string().regex(/^[\w-]+_[0-9A-Za-z]+$/),
  AWS_COGNITO_CLIENT_ID: z.string().min(10),
})

export const cognitoEnvironment = cognitoEnvironmentSchema.parse({
  AWS_COGNITO_REGION: process.env.AWS_COGNITO_REGION,
  AWS_COGNITO_USER_POOL_ID: process.env.AWS_COGNITO_USER_POOL_ID,
  AWS_COGNITO_CLIENT_ID: process.env.AWS_COGNITO_CLIENT_ID,
})
