<script setup lang="ts">
import {
  SERVICE_KEYS,
  serviceInfo,
  serviceLabel,
  stateName,
  statePath,
} from '~/utils/directory'
import { canonicalUrl } from '~/utils/site'

const { $supabase } = useNuxtApp()

const { data: directory } = await useAsyncData('directory-home', async () => {
  const countResult = await $supabase
    .from('facilities')
    .select('id', { count: 'exact', head: true })
    .eq('publish_status', 'publish')

  if (countResult.error) throw countResult.error

  const facilitiesResult = await $supabase
    .from('facilities')
    .select('id, rin, display_name, phmsa_name, city, state')
    .eq('publish_status', 'publish')
    .order('verified_at', { ascending: false })
    .limit(6)

  if (facilitiesResult.error) throw facilitiesResult.error

  const servicesResult = await $supabase
    .from('facility_services')
    .select('facility_id, service_key')
    .in('status', ['verified', 'provider_confirmed'])
    .limit(1000)

  if (servicesResult.error) throw servicesResult.error

  const statesResult = await $supabase
    .from('facilities')
    .select('state')
    .eq('publish_status', 'publish')
    .limit(1000)

  if (statesResult.error) throw statesResult.error

  const serviceCounts: Record<string, number> = {}
  const serviceKeysByFacility: Record<string, string[]> = {}

  for (const row of servicesResult.data ?? []) {
    serviceCounts[row.service_key] = (serviceCounts[row.service_key] ?? 0) + 1
    serviceKeysByFacility[row.facility_id] = [
      ...(serviceKeysByFacility[row.facility_id] ?? []),
      row.service_key,
    ]
  }

  const stateCounts: Record<string, number> = {}
  for (const row of statesResult.data ?? []) {
    stateCounts[row.state] = (stateCounts[row.state] ?? 0) + 1
  }

  return {
    count: countResult.count ?? 0,
    facilities: facilitiesResult.data ?? [],
    serviceCounts,
    serviceKeysByFacility,
    states: Object.entries(stateCounts)
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
      .slice(0, 8),
  }
})

const availableServices = computed(() =>
  SERVICE_KEYS
    .map((key) => ({
      key,
      count: directory.value?.serviceCounts[key] ?? 0,
      info: serviceInfo(key),
    }))
    .filter((service) => service.count > 0),
)

useSeoMeta({
  title: 'Cylinder Atlas — Find DOT Cylinder Requalification Providers',
  description:
    'Find evidence-backed U.S. cylinder requalification providers by service and location, built from PHMSA RIN data and current business evidence.',
})

useHead({
  link: [{ rel: 'canonical', href: canonicalUrl('/') }],
})
</script>

<template>
  <main>
    <section class="border-b border-slate-200 bg-white">
      <div class="mx-auto grid max-w-7xl gap-12 px-6 py-16 lg:grid-cols-[1.2fr_0.8fr] lg:py-24">
        <div>
          <p class="text-sm font-semibold uppercase tracking-[0.18em] text-teal-700">
            Evidence-backed cylinder directory
          </p>
          <h1 class="mt-4 max-w-4xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-6xl">
            Find a cylinder requalification provider with better evidence.
          </h1>
          <p class="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
            Cylinder Atlas starts with PHMSA RIN data, then checks current business identity and customer-facing services before a facility appears in the directory.
          </p>

          <form action="/search" method="get" class="mt-8 flex max-w-2xl flex-col gap-3 sm:flex-row">
            <label for="home-search" class="sr-only">Search providers</label>
            <input
              id="home-search"
              name="q"
              type="search"
              placeholder="Provider, city, state, or RIN"
              class="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none ring-teal-600 focus:ring-2"
            >
            <button
              type="submit"
              class="rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white hover:bg-slate-800"
            >
              Search
            </button>
          </form>
        </div>

        <aside class="rounded-3xl border border-slate-200 bg-slate-50 p-7">
          <p class="text-sm font-semibold text-slate-600">Published directory</p>
          <p class="mt-2 text-5xl font-semibold tracking-tight text-slate-950">{{ directory?.count ?? 0 }}</p>
          <p class="mt-2 text-sm leading-6 text-slate-600">
            Facilities have cleared the current identity, public-access, and service-evidence gate. Facilities still under review remain out of search.
          </p>
          <div class="mt-6 border-t border-slate-200 pt-5">
            <p class="text-sm font-semibold text-slate-800">Trust signals on every profile</p>
            <ul class="mt-3 space-y-2 text-sm text-slate-600">
              <li>PHMSA RIN</li>
              <li>Evidence-backed service categories</li>
              <li>Last verified date</li>
            </ul>
          </div>
        </aside>
      </div>
    </section>

    <section class="mx-auto max-w-7xl px-6 py-14">
      <div class="flex items-end justify-between gap-6">
        <div>
          <p class="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">Browse by service</p>
          <h2 class="mt-2 text-2xl font-semibold tracking-tight text-slate-950">What kind of cylinder needs service?</h2>
        </div>
        <NuxtLink to="/search" class="hidden text-sm font-semibold text-teal-800 hover:underline sm:block">
          Search all providers
        </NuxtLink>
      </div>

      <div class="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <NuxtLink
          v-for="service in availableServices"
          :key="service.key"
          :to="'/services/' + service.key"
          class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:border-slate-300 hover:shadow-md"
        >
          <div class="flex items-start justify-between gap-4">
            <p class="font-semibold text-slate-950">{{ serviceLabel(service.key) }}</p>
            <span class="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
              {{ service.count }}
            </span>
          </div>
          <p class="mt-3 text-sm leading-6 text-slate-600">{{ service.info?.description }}</p>
        </NuxtLink>
      </div>
    </section>

    <section class="mx-auto max-w-7xl px-6 py-8">
      <div>
        <p class="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">Recently verified</p>
        <h2 class="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Provider profiles</h2>
      </div>

      <div v-if="directory?.facilities.length" class="mt-7 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <ProviderCard
          v-for="facility in directory.facilities"
          :key="facility.id"
          :facility="facility"
          :service-keys="directory.serviceKeysByFacility[facility.id] ?? []"
        />
      </div>
    </section>

    <section v-if="directory?.states.length" class="mx-auto max-w-7xl px-6 py-14">
      <p class="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">Browse by state</p>
      <div class="mt-5 flex flex-wrap gap-3">
        <NuxtLink
          v-for="state in directory.states"
          :key="state.code"
          :to="statePath(state.code)"
          class="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-400 hover:text-slate-950"
        >
          {{ stateName(state.code) }} · {{ state.count }}
        </NuxtLink>
      </div>
    </section>
  </main>
</template>
