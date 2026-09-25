import { createClient } from '@supabase/supabase-js'
import type { Database } from '~~/types/database'

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()

  if (!config.public.supabaseUrl || !config.public.supabasePublishableKey) {
    throw new Error('Missing Supabase public runtime configuration')
  }

  const supabase = createClient<Database>(
    config.public.supabaseUrl as string,
    config.public.supabasePublishableKey as string,
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
