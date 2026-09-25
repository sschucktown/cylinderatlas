<script setup lang="ts">
import { SERVICE_KEYS, serviceInfo, stateName, statePath } from '~/utils/directory'
import { canonicalUrl } from '~/utils/site'

const route = useRoute()
const { $supabase } = useNuxtApp()

const serviceKey = String(route.params.service ?? '')
if (!SERVICE_KEYS.includes(serviceKey as (typeof SERVICE_KEYS)[number])) {
  throw createError({ statusCode: 404, statusMessage: 'Service not found' })
}

const service = serviceInfo(serviceKey)
if (!service) {
  throw createError({ statusCode: 404, statusMessage: 'Service not found' })
}

const serviceRowsResult = await $supabase
  .from('facility_services')
  .select('facility_id')
  .eq('service_key', serviceKey)
  .in('status', ['verified', 'provider_confirmed'])
  .limit(1000)

if (serviceRowsResult.error) throw serviceRowsResult.error

const facilityIds = [...new Set((serviceRowsResult.data ?? []).map((row) => row.facility_id))]
if (!facilityIds.length) {
  throw createError({ statusCode: 404, statusMessage: 'No published providers for this service yet' })
}

const facilitiesResult = await $supabase
  .from('facilities')
  .select('id, rin, display_name, phmsa_name, city, state')
  .eq('publish_status', 'publish')
  .in('id', facilityIds)
  .order('state')
  .order('city')
  .limit(1000)

if (facilitiesResult.error) throw facilitiesResult.error

const facilities = facilitiesResult.data ?? []
const stateCounts: Record<string, number> = {}
for (const facility of facilities) {
  stateCounts[facility.state] = (stateCounts[facility.state] ?? 0) + 1
}

const states = Object.entries(stateCounts)
  .map(([code, count]) => ({ code, count }))
  .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))

useSeoMeta({
  title: service.label + ' Requalification Providers — Cylinder Atlas',
  description:
    'Find published U.S. cylinder requalification providers with current evidence supporting ' +
    service.label.toLowerCase() +
    ' service.',
  robots: facilities.length >= 3 ? 'index,follow' : 'noindex,follow',
})

useHead({
  link: [{ rel: 'canonical', href: canonicalUrl('/services/' + serviceKey) }],
})
</script>

<template>
  <main class="mx-auto max-w-7xl px-6 py-12">
    <nav class="text-sm text-slate-500">
      <NuxtLink to="/search" class="hover:text-slate-950 hover:underline">Providers</NuxtLink>
      <span class="mx-2">/</span>
      <span>{{ service.label }}</span>
    </nav>

    <div class="mt-6 max-w-3xl">
      <p class="text-sm font-semibold uppercase tracking-[0.14em] text-teal-700">Service directory</p>
      <h1 class="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
        {{ service.label }} requalification providers
      </h1>
      <p class="mt-4 text-lg leading-8 text-slate-600">{{ service.description }}</p>
      <p class="mt-3 text-sm leading-6 text-slate-500">
        Listings shown here have a publishable PHMSA RIN match and current evidence supporting this service category. Service availability can change, so confirm details with the provider.
      </p>
    </div>

    <section v-if="states.length > 1" class="mt-9 rounded-2xl border border-slate-200 bg-white p-5">
      <p class="text-sm font-semibold text-slate-800">States represented</p>
      <div class="mt-3 flex flex-wrap gap-2">
        <NuxtLink
          v-for="state in states"
          :key="state.code"
          :to="statePath(state.code)"
          class="rounded-full bg-slate-100 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-200"
        >
          {{ stateName(state.code) }} · {{ state.count }}
        </NuxtLink>
      </div>
    </section>

    <section class="mt-10">
      <div class="flex items-baseline justify-between gap-4">
        <h2 class="text-xl font-semibold text-slate-950">Published providers</h2>
        <p class="text-sm text-slate-500">{{ facilities.length }} total</p>
      </div>

      <div class="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <ProviderCard
          v-for="facility in facilities"
          :key="facility.id"
          :facility="facility"
          :service-keys="[serviceKey]"
        />
      </div>
    </section>
  </main>
</template>
