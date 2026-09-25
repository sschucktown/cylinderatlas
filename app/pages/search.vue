<script setup lang="ts">
import { SERVICE_KEYS, serviceLabel, stateName } from '~/utils/directory'
import { canonicalUrl } from '~/utils/site'

const PAGE_SIZE = 24

const route = useRoute()
const { $supabase } = useNuxtApp()

function queryString(value: unknown) {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}

function positivePage(value: unknown) {
  const parsed = Number.parseInt(queryString(value), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

const searchTerm = computed(() => queryString(route.query.q).trim())
const stateFilter = computed(() => queryString(route.query.state).trim().toUpperCase())
const serviceFilter = computed(() => queryString(route.query.service).trim())
const currentPage = computed(() => positivePage(route.query.page))

const { data: results, pending } = await useAsyncData(
  'directory-search',
  async () => {
    const statesResult = await $supabase
      .from('facilities')
      .select('state')
      .eq('publish_status', 'publish')
      .limit(5000)

    if (statesResult.error) throw statesResult.error

    const availableStates = [...new Set((statesResult.data ?? []).map((row) => row.state))]
      .sort((a, b) => stateName(a).localeCompare(stateName(b)))

    let serviceFacilityIds: string[] | null = null

    if (serviceFilter.value) {
      if (!SERVICE_KEYS.includes(serviceFilter.value as (typeof SERVICE_KEYS)[number])) {
        return {
          facilities: [],
          serviceKeysByFacility: {} as Record<string, string[]>,
          total: 0,
          availableStates,
        }
      }

      const serviceResult = await $supabase
        .from('facility_services')
        .select('facility_id')
        .eq('service_key', serviceFilter.value)
        .in('status', ['verified', 'provider_confirmed'])
        .limit(5000)

      if (serviceResult.error) throw serviceResult.error

      serviceFacilityIds = [...new Set((serviceResult.data ?? []).map((row) => row.facility_id))]
      if (!serviceFacilityIds.length) {
        return {
          facilities: [],
          serviceKeysByFacility: {} as Record<string, string[]>,
          total: 0,
          availableStates,
        }
      }
    }

    let query = $supabase
      .from('facilities')
      .select('id, rin, display_name, phmsa_name, city, state', { count: 'exact' })
      .eq('publish_status', 'publish')
      .order('state')
      .order('city')
      .order('phmsa_name')

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

    const offset = (currentPage.value - 1) * PAGE_SIZE
    const facilitiesResult = await query.range(offset, offset + PAGE_SIZE - 1)
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

    return {
      facilities,
      serviceKeysByFacility,
      total: facilitiesResult.count ?? 0,
      availableStates,
    }
  },
  {
    watch: [() => route.fullPath],
  },
)

const resultCount = computed(() => results.value?.total ?? 0)
const totalPages = computed(() => Math.max(1, Math.ceil(resultCount.value / PAGE_SIZE)))
const rangeStart = computed(() => resultCount.value ? (currentPage.value - 1) * PAGE_SIZE + 1 : 0)
const rangeEnd = computed(() => Math.min(currentPage.value * PAGE_SIZE, resultCount.value))
const hasFilters = computed(() => Boolean(searchTerm.value || stateFilter.value || serviceFilter.value))

function pageLink(page: number) {
  const query: Record<string, string> = {}
  if (searchTerm.value) query.q = searchTerm.value
  if (stateFilter.value) query.state = stateFilter.value
  if (serviceFilter.value) query.service = serviceFilter.value
  if (page > 1) query.page = String(page)
  return { path: '/search', query }
}

useSeoMeta({
  title: 'Search Cylinder Requalification Providers — Cylinder Atlas',
  description: 'Search published Cylinder Atlas provider listings by provider, location, RIN, or service category.',
  robots: 'noindex,follow',
})

useHead({
  link: [{ rel: 'canonical', href: canonicalUrl('/search') }],
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

    <form method="get" action="/search" class="mt-8 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:grid-cols-[minmax(280px,1.5fr)_200px_240px_auto]">
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
        <select
          id="state"
          name="state"
          :value="stateFilter"
          class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none ring-teal-600 focus:ring-2"
        >
          <option value="">All states</option>
          <option v-for="state in results?.availableStates ?? []" :key="state" :value="state">
            {{ stateName(state) }}
          </option>
        </select>
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

    <div class="mt-8 flex flex-wrap items-center justify-between gap-4">
      <p class="text-sm text-slate-600">
        <span v-if="pending">Searching…</span>
        <template v-else>
          <span v-if="resultCount">
            Showing {{ rangeStart }}–{{ rangeEnd }} of {{ resultCount }} {{ resultCount === 1 ? 'provider' : 'providers' }}
          </span>
          <span v-else>0 providers</span>
          <span v-if="stateFilter"> in {{ stateName(stateFilter) }}</span>
        </template>
      </p>
      <NuxtLink
        v-if="hasFilters"
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

    <nav
      v-if="!pending && resultCount > PAGE_SIZE"
      class="mt-8 flex items-center justify-between border-t border-slate-200 pt-6"
      aria-label="Search result pages"
    >
      <NuxtLink
        v-if="currentPage > 1"
        :to="pageLink(currentPage - 1)"
        class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-950"
      >
        ← Previous
      </NuxtLink>
      <span v-else />

      <p class="text-sm text-slate-500">Page {{ currentPage }} of {{ totalPages }}</p>

      <NuxtLink
        v-if="currentPage < totalPages"
        :to="pageLink(currentPage + 1)"
        class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400 hover:text-slate-950"
      >
        Next →
      </NuxtLink>
      <span v-else />
    </nav>

    <div v-else-if="!pending" class="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white p-8">
      <p class="font-semibold text-slate-900">No published providers match those filters.</p>
      <p class="mt-2 text-sm leading-6 text-slate-600">
        Try a nearby state, remove a service filter, or search by RIN. Facilities still under enrichment or review are intentionally not shown.
      </p>
    </div>
  </main>
</template>
