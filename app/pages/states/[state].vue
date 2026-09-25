<script setup lang="ts">
import {
  codeFromStateSlug,
  serviceLabel,
  stateName,
} from '~/utils/directory'

const route = useRoute()
const { $supabase } = useNuxtApp()

const stateCode = codeFromStateSlug(String(route.params.state ?? ''))
if (!stateCode) {
  throw createError({ statusCode: 404, statusMessage: 'State not found' })
}

const facilitiesResult = await $supabase
  .from('facilities')
  .select('id, rin, display_name, phmsa_name, city, state')
  .eq('publish_status', 'publish')
  .eq('state', stateCode)
  .order('city')
  .limit(1000)

if (facilitiesResult.error) throw facilitiesResult.error

const facilities = facilitiesResult.data ?? []
if (!facilities.length) {
  throw createError({ statusCode: 404, statusMessage: 'No published providers in this state yet' })
}

const ids = facilities.map((facility) => facility.id)
const servicesResult = await $supabase
  .from('facility_services')
  .select('facility_id, service_key')
  .in('facility_id', ids)
  .in('status', ['verified', 'provider_confirmed'])
  .limit(1000)

if (servicesResult.error) throw servicesResult.error

const serviceKeysByFacility: Record<string, string[]> = {}
const serviceCounts: Record<string, number> = {}

for (const row of servicesResult.data ?? []) {
  serviceKeysByFacility[row.facility_id] = [
    ...(serviceKeysByFacility[row.facility_id] ?? []),
    row.service_key,
  ]
  serviceCounts[row.service_key] = (serviceCounts[row.service_key] ?? 0) + 1
}

const services = Object.entries(serviceCounts)
  .map(([key, count]) => ({ key, count }))
  .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))

const name = stateName(stateCode)

useSeoMeta({
  title: 'Cylinder Requalification Providers in ' + name + ' — Cylinder Atlas',
  description:
    'Find published cylinder requalification providers in ' +
    name +
    ', with PHMSA RIN context and evidence-backed service categories.',
  robots: facilities.length >= 3 ? 'index,follow' : 'noindex,follow',
})
</script>

<template>
  <main class="mx-auto max-w-7xl px-6 py-12">
    <nav class="text-sm text-slate-500">
      <NuxtLink to="/search" class="hover:text-slate-950 hover:underline">Providers</NuxtLink>
      <span class="mx-2">/</span>
      <span>{{ name }}</span>
    </nav>

    <div class="mt-6 max-w-3xl">
      <p class="text-sm font-semibold uppercase tracking-[0.14em] text-teal-700">State directory</p>
      <h1 class="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
        Cylinder requalification providers in {{ name }}
      </h1>
      <p class="mt-4 text-lg leading-8 text-slate-600">
        {{ facilities.length }} published {{ facilities.length === 1 ? 'facility' : 'facilities' }} currently clear the Cylinder Atlas identity and service-evidence gate in {{ name }}.
      </p>
    </div>

    <section v-if="services.length" class="mt-9 rounded-2xl border border-slate-200 bg-white p-5">
      <p class="text-sm font-semibold text-slate-800">Services represented</p>
      <div class="mt-3 flex flex-wrap gap-2">
        <NuxtLink
          v-for="service in services"
          :key="service.key"
          :to="'/services/' + service.key"
          class="rounded-full bg-slate-100 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-200"
        >
          {{ serviceLabel(service.key) }} · {{ service.count }}
        </NuxtLink>
      </div>
    </section>

    <section class="mt-10">
      <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <ProviderCard
          v-for="facility in facilities"
          :key="facility.id"
          :facility="facility"
          :service-keys="serviceKeysByFacility[facility.id] ?? []"
        />
      </div>
    </section>

    <p v-if="facilities.length < 3" class="mt-8 max-w-3xl text-sm leading-6 text-slate-500">
      This state page remains outside the search index until it has enough published provider coverage to be useful.
    </p>
  </main>
</template>
