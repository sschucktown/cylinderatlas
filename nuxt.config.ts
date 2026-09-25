import tailwindcss from '@tailwindcss/vite'

const defaultSupabaseUrl = 'https://hnezebrdtdjvekgzjzek.supabase.co'
const defaultSupabasePublishableKey = 'sb_publishable_66cq-lBtFAP7T8jQU62Qyg_OvQf1ixX'

export default defineNuxtConfig({
  compatibilityDate: '2026-09-23',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()],
  },
  runtimeConfig: {
    public: {
      // These are public client connection values. Vercel env vars can override them.
      // Data access is enforced by Supabase RLS, not by keeping this publishable key secret.
      supabaseUrl: process.env.NUXT_PUBLIC_SUPABASE_URL || defaultSupabaseUrl,
      supabasePublishableKey:
        process.env.NUXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || defaultSupabasePublishableKey,
    },
  },
})
