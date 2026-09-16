import { z } from 'zod'

const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'api', 'app', 'auth', 'contact', 'events', 'help',
  'home', 'jobs', 'learn', 'login', 'messages', 'network', 'notifications',
  'privacy', 'profile', 'register', 'search', 'settings', 'signin', 'signup',
  'support', 'terms', 'verification', 'seanshore', 'sea-n-shore',
])

export function normalizeUsername(value: string) {
  return value.trim().toLocaleLowerCase('en')
}

export const usernameSchema = z.preprocess(
  (value) => typeof value === 'string' ? normalizeUsername(value) : value,
  z
    .string()
    .min(3, 'Choose a username with at least 3 characters.')
    .max(30, 'Keep your username to 30 characters or fewer.')
    .regex(/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/, 'Use letters, numbers, dots, underscores, or hyphens; start and end with a letter or number.')
    .refine((value) => !/[._-]{2}/.test(value), 'Do not use consecutive dots, underscores, or hyphens.')
    .refine((value) => !RESERVED_USERNAMES.has(value), 'That username is reserved.'),
)
