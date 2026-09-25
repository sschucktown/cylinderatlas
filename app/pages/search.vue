<script setup lang="ts">
import { SERVICE_KEYS, serviceLabel, stateName } from '~/utils/directory'

const route = useRoute()
const { $supabase } = useNuxtApp()

function queryString(value: unknown) {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}

const searchTerm = computed(() => queryString(route.query.q).trim())
const stateFilter = computed(() => queryString(route.query.state).trim().toUpperCase())
const serviceFilter = computed(() => queryString(route.query.service).trim())

const { data: results, pending } = await useAsyncData(
  'directory-search',
  async () => {
    let serviceFacilityIds: string[] | null = null

    if (serviceFilter.value) {
      if (!SERVICE_KEYS.includes(serviceFilter.value as (typeof SERVICE_KEYS)[number])) {
        return { facilities: [], serviceKeysByFacility: {} as Record<string, string[]> }
      }

      const serviceResult = await $supabase
        .from('facility_services')
        .select('facility_id')
        .eq('service_key', serviceFilter.value)
        .in('status', ['verified', 'provider_confirmed'])
        .limit(1000)

      if (serviceResult.error) throw serviceResult.error

      serviceFacilityIds = [...new Set((serviceResult.data ?? []).map((row) => row.facility_id))]
      if (!serviceFacilityIds.length) {
        return { facilities: [], serviceKeysByFacility: {} as Record<string, string[]> }
      }
    }

    let query = $supabase
      .from('facilities')
      .select('id, rin, display_name, phmsa_name, city, state')
      .eq('publish_status', 'publish')
      .order('state')
      .order('city')
      .limit(200)

    if (stateFilter.value) {
      query = query.eq('state', stateFilter.value)
    }

    if (serviceFacilityIds) {
      query = query.in('id', serviceFacilityIds)
    }

    const safeSearch = searchTerm.value.replace(/[^a-zA-Z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim()
    if (safeSearch) {
      const pattern = '%' + safeSearch + '%'
      query = query.or(
        'display_name.ilike.' + pattern +
          ',phmsa_name.ilike.' + pattern +
          ',city.ilike.' + pattern +
          ',state.ilike.' + pattern +
          ',rin.ilike.' + pattern,
      )
    }

    const facilitiesResult = await query
    if (facilitiesResult.error) throw facilitiesResult.error

    const facilities = facilitiesResult.data ?? []
    const ids = facilities.map((facility) => facility.id)
    const serviceKeysByFacility: Record<string, string[]> = {}

    if (ids.length) {
      const servicesResult = await $supabase
        .from('facility_services')
        .select('facility_id, service_key')
        .in('facility_id', ids)
        .in('status', ['verified', 'provider_confirmed'])
        .limit(1000)

      if (servicesResult.error) throw servicesResult.error

      for (const row of servicesResult.data ?? []) {
        serviceKeysByFacility[row.facility_id] = [
          ...(serviceKeysByFacility[row.facility_id] ?? []),
          row.service_key,
        ]
      }
    }

    return { facilities, serviceKeysByFacility }
  },
  {
    watch: [() => route.fullPath],
  },
)

const resultCount = computed(() => results.value?.facilities.length ?? 0)

useSeoMeta({
  title: 'Search Cylinder Requalification Providers — Cylinder Atlas',
  description: 'Search published Cylinder Atlas provider listings by provider, location, RIN, or service category.',
  robots: 'noindex,follow',
})
</script>

<template>
  <main class="mx-auto max-w-7xl px-6 py-12">
    <div class="max-w-3xl">
      <p class="text-sm font-semibold uppercase tracking-[0.14em] text-teal-700">Directory search</p>
      <h1 class="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
        Find a cylinder requalification provider
      </h1>
      <p class="mt-4 text-slate-600">
        Search only includes facilities that have cleared Cylinder Atlas's current publish gate.
      </p>
    </div>

    <form method="get" action="/search" class="mt-8 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:grid-cols-[1fr_140px_240px_auto]">
      <div>
        <label for="q" class="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Search</label>
        <input
          id="q"
          name="q"
          type="search"
          :value="searchTerm"
          placeholder="Provider, city, state, or RIN"
          class="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none ring-teal-600 focus:ring-2"
        >
      </div>

      <div>
        <label for="state" class="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">State</label>
        <input
          id="state"
          name="state"
          type="text"
          maxlength="2"
          :value="stateFilter"
          placeholder="SC"
          class="w-full rounded-lg border border-slate-300 px-3 py-2.5 uppercase outline-none ring-teal-600 focus:ring-2"
        >
      </div>

      <div>
        <label for="service" class="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Service</label>
        <select
          id="service"
          name="service"
          :value="serviceFilter"
          class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none ring-teal-600 focus:ring-2"
        >
          <option value="">All services</option>
          <option v-for="service in SERVICE_KEYS" :key="service" :value="service">
            {{ serviceLabel(service) }}
          </option>
        </select>
      </div>

      <button type="submit" class="self-end rounded-lg bg-slate-950 px-5 py-2.5 font-semibold text-white hover:bg-slate-800">
        Search
      </button>
    </form>

    <div class="mt-8 flex items-center justify-between gap-4">
      <p class="text-sm text-slate-600">
        <span v-if="pending">Searching…</span>
        <span v-else>{{ resultCount }} {{ resultCount === 1 ? 'provider' : 'providers' }}</span>
        <span v-if="stateFilter"> in {{ stateName(stateFilter) }}</span>
      </p>
      <NuxtLink
        v-if="searchTerm || stateFilter || serviceFilter"
        to="/search"
        class="text-sm font-semibold text-teal-800 hover:underline"
      >
        Clear filters
      </NuxtLink>
    </div>

    <div v-if="!pending && results?.facilities.length" class="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <ProviderCard
        v-for="facility in results.facilities"
        :key="facility.id"
        :facility="facility"
        :service-keys="results.serviceKeysByFacility[facility.id] ?? []"
      />
    </div>

    <div v-else-if="!pending" class="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white p-8">
      <p class="font-semibold text-slate-900">No published providers match those filters.</p>
      <p class="mt-2 text-sm leading-6 text-slate-600">
        Try a nearby state, remove a service filter, or search by RIN. Facilities still under enrichment or review are intentionally not shown.
      </p>
    </div>
  </main>
</template>
