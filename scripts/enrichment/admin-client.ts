import { createClient } from '@supabase/supabase-js'

export function createAdminClient() {
  const url = process.env.SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY

  if (!url || !secretKey) {
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_SECRET_KEY. These scripts require server-only credentials.',
    )
  }

  return createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}

export function readFlag(name: string) {
  const index = process.argv.indexOf('--' + name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

export function readPositiveIntFlag(name: string, fallback: number) {
  const raw = readFlag(name)
  if (!raw) return fallback

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('--' + name + ' must be a positive integer')
  }

  return parsed
}
