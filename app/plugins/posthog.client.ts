import posthog from 'posthog-js'

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()

  const client = posthog.init(config.public.posthogPublicKey, {
    api_host: config.public.posthogHost,
    defaults: config.public.posthogDefaults,
  })

  return {
    provide: {
      posthog: client,
    },
  }
})
