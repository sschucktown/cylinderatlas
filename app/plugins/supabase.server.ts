import { createClient } from '@supabase/supabase-js'
import type { Database } from '~~/types/database'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '~/utils/supabase-config'

export default defineNuxtPlugin(() => {
  const supabase = createClient<Database>(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  )

  return {
    provide: { supabase },
  }
})
