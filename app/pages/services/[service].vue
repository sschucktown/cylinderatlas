<script setup lang="ts">
import {
  SERVICE_KEYS,
  displayName,
  providerPath,
  serviceInfo,
  stateName,
} from '~/utils/directory'
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

const servicePath = '/services/' + serviceKey
const searchPath = {
  path: '/search',
  query: { service: serviceKey },
}

function stateServiceSearchPath(code: string) {
  return {
    path: '/search',
    query: {
      state: code,
      service: serviceKey,
    },
  }
}

useSeoMeta({
  title:
    facilities.length +
    ' ' +
    service.label +
    ' Requalification Providers — CylinderAtlas',
  description:
    'Browse ' +
    facilities.length +
    ' published U.S. cylinder requalification providers across ' +
    states.length +
    ' ' +
    (states.length === 1 ? 'state' : 'states') +
    ' with current evidence supporting ' +
    service.label.toLowerCase() +
    ' service.',
  robots: facilities.length >= 3 ? 'index,follow' : 'noindex,follow',
})

useHead({
  link: [{ rel: 'canonical', href: canonicalUrl(servicePath) }],
  script: [
    {
      type: 'application/ld+json',
      textContent: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: service.label + ' requalification providers',
        description: service.description,
        url: canonicalUrl(servicePath),
        mainEntity: {
          '@type': 'ItemList',
          numberOfItems: facilities.length,
          itemListElement: facilities.slice(0, 100).map((facility, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: displayName(facility),
            url: canonicalUrl(providerPath(facility)),
          })),
        },
      }),
    },
  ],
})
</script>

<template>
  <main class="mx-auto max-w-7xl px-6 py-12">
    <nav class="text-sm text-slate-500" aria-label="Breadcrumb">
      <NuxtLink to="/search" class="hover:text-slate-950 hover:underline">Providers</NuxtLink>
      <span class="mx-2">/</span>
      <span>{{ service.label }}</span>
    </nav>

    <div class="mt-6 grid gap-8 lg:grid-cols-[1fr_300px] lg:items-start">
      <div class="max-w-3xl">
        <p class="text-sm font-semibold uppercase tracking-[0.14em] text-brand-700">Service directory</p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
          {{ service.label }} requalification providers
        </h1>
        <p class="mt-4 text-lg leading-8 text-slate-600">{{ service.description }}</p>
        <p class="mt-3 text-sm leading-6 text-slate-500">
          Listings shown here have a published PHMSA RIN match and current evidence supporting this service category. Service availability can change, so confirm cylinder-specific capabilities directly with the provider.
        </p>

        <div class="mt-6 flex flex-wrap gap-3">
          <NuxtLink
            :to="searchPath"
            class="rounded-xl bg-navy px-5 py-3 text-sm font-semibold text-white hover:bg-brand-950"
          >
            Search these providers
          </NuxtLink>
          <span class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600">
            {{ facilities.length }} published {{ facilities.length === 1 ? 'provider' : 'providers' }}
          </span>
          <span class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600">
            {{ states.length }} {{ states.length === 1 ? 'state' : 'states' }}
          </span>
        </div>
      </div>

      <aside class="rounded-2xl border border-brand-200 bg-brand-50 p-5">
        <p class="text-sm font-semibold text-brand-950">How providers qualify</p>
        <div class="mt-4 space-y-4 text-sm leading-6 text-brand-900">
          <p><span class="font-semibold">PHMSA foundation:</span> the facility is tied to a published RIN with hydrostatic authorization.</p>
          <p><span class="font-semibold">Current identity:</span> the business and facility location are reconciled before publication.</p>
          <p><span class="font-semibold">Service evidence:</span> this category requires current customer-facing evidence or reviewed provider confirmation.</p>
        </div>
        <p class="mt-4 border-t border-brand-200 pt-4 text-xs leading-5 text-brand-800">
          CylinderAtlas does not certify providers or determine cylinder pass/fail status.
        </p>
        <NuxtLink
          to="/how-we-verify"
          class="mt-3 inline-flex text-xs font-semibold text-brand-950 hover:underline"
        >
          How verification works
        </NuxtLink>
      </aside>
    </div>

    <section v-if="states.length > 1" class="mt-9 rounded-2xl border border-slate-200 bg-white p-5">
      <div class="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p class="text-sm font-semibold text-slate-950">Browse {{ service.label }} providers by state</p>
          <p class="mt-1 text-xs leading-5 text-slate-500">
            State links open the filtered directory rather than creating thin state-service SEO pages.
          </p>
        </div>
        <NuxtLink :to="searchPath" class="text-sm font-semibold text-brand-800 hover:underline">
          View all {{ facilities.length }}
        </NuxtLink>
      </div>

      <div class="mt-4 flex flex-wrap gap-2">
        <NuxtLink
          v-for="state in states"
          :key="state.code"
          :to="stateServiceSearchPath(state.code)"
          class="rounded-full bg-slate-100 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-200"
        >
          {{ stateName(state.code) }} · {{ state.count }}
        </NuxtLink>
      </div>
    </section>

    <section class="mt-10">
      <div class="flex items-baseline justify-between gap-4">
        <h2 class="text-xl font-semibold text-slate-950">Published providers</h2>
        <NuxtLink :to="searchPath" class="text-sm font-semibold text-brand-800 hover:underline">
          Filter results
        </NuxtLink>
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

    <p v-if="facilities.length < 3" class="mt-8 max-w-3xl text-sm leading-6 text-slate-500">
      This service page remains outside the search index until it has enough published provider coverage to be useful.
    </p>
  </main>
</template>
