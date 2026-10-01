import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-09-23',
  devtools: { enabled: true },
  modules: ['@vercel/analytics'],
  runtimeConfig: {
    public: {
      posthogPublicKey: 'phc_CtmYzrjvGRePbaixo7WDzNm6mvn7LR3FiWMgUXi7XiBA',
      posthogHost: 'https://us.i.posthog.com',
      posthogDefaults: '2026-05-30',
    },
  },
  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()],
  },
})
