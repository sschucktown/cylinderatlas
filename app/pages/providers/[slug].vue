<script setup lang="ts">
import {
  displayName,
  formatVerifiedDate,
  providerPath,
  rinFromProviderSlug,
  serviceLabel,
  stateName,
  statePath,
  titleCaseCity,
} from '~/utils/directory'
import { canonicalUrl } from '~/utils/site'

const route = useRoute()
const { $supabase } = useNuxtApp()

const slug = String(route.params.slug ?? '')
const rin = rinFromProviderSlug(slug)

if (!rin) {
  throw createError({ statusCode: 404, statusMessage: 'Provider not found' })
}

const facilityResult = await $supabase
  .from('facilities')
  .select(
    'id, rin, display_name, phmsa_name, display_address, phmsa_address, city, state, postal_code, phone, website_url, verified_at',
  )
  .eq('publish_status', 'publish')
  .eq('rin', rin)
  .maybeSingle()

if (facilityResult.error) throw facilityResult.error
if (!facilityResult.data) {
  throw createError({ statusCode: 404, statusMessage: 'Provider not found' })
}

const facility = facilityResult.data
const servicesResult = await $supabase
  .from('facility_services')
  .select('service_key, status, confidence')
  .eq('facility_id', facility.id)
  .in('status', ['verified', 'provider_confirmed'])
  .order('service_key')

if (servicesResult.error) throw servicesResult.error

const services = servicesResult.data ?? []
const name = displayName(facility)
const currentPath = providerPath(facility)
const verifiedDate = formatVerifiedDate(facility.verified_at)
const address = facility.display_address || facility.phmsa_address
const canonicalSlug = currentPath.split('/').pop() || slug
const claimPath = '/claim/' + canonicalSlug
const correctionPath = '/correct/' + canonicalSlug

if (route.path !== currentPath) {
  await navigateTo(currentPath, { redirectCode: 301, replace: true })
}

useSeoMeta({
  title: name + ' — Cylinder Requalification Provider | Cylinder Atlas',
  description:
    'View evidence-backed cylinder requalification services, PHMSA RIN, location, and verification details for ' +
    name +
    ' in ' +
    titleCaseCity(facility.city) +
    ', ' +
    facility.state +
    '.',
})

useHead({
  link: [{ rel: 'canonical', href: canonicalUrl(currentPath) }],
  script: [
    {
      type: 'application/ld+json',
      textContent: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'LocalBusiness',
        name,
        address: {
          '@type': 'PostalAddress',
          streetAddress: address,
          addressLocality: titleCaseCity(facility.city),
          addressRegion: facility.state,
          postalCode: facility.postal_code || undefined,
          addressCountry: 'US',
        },
        telephone: facility.phone || undefined,
        url: facility.website_url || undefined,
        identifier: 'PHMSA RIN ' + facility.rin,
      }),
    },
  ],
})
</script>

<template>
  <main class="mx-auto max-w-6xl px-6 py-12">
    <nav class="text-sm text-slate-500" aria-label="Breadcrumb">
      <NuxtLink to="/search" class="hover:text-slate-950 hover:underline">Providers</NuxtLink>
      <span class="mx-2">/</span>
      <NuxtLink :to="statePath(facility.state)" class="hover:text-slate-950 hover:underline">
        {{ stateName(facility.state) }}
      </NuxtLink>
    </nav>

    <div class="mt-6 grid gap-8 lg:grid-cols-[1fr_320px]">
      <div>
        <p class="text-sm font-semibold uppercase tracking-[0.14em] text-teal-700">
          Published provider
        </p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
          {{ name }}
        </h1>
        <p class="mt-3 text-lg text-slate-600">
          {{ titleCaseCity(facility.city) }}, {{ facility.state }}
        </p>

        <section class="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 class="text-lg font-semibold text-slate-950">Cylinder services</h2>
          <div v-if="services.length" class="mt-4 flex flex-wrap gap-2">
            <NuxtLink
              v-for="service in services"
              :key="service.service_key"
              :to="'/services/' + service.service_key"
              class="rounded-full bg-teal-50 px-3 py-1.5 text-sm font-medium text-teal-800 hover:bg-teal-100"
            >
              {{ serviceLabel(service.service_key) }}
            </NuxtLink>
          </div>
          <p v-else class="mt-3 text-sm text-slate-600">
            No public service labels are currently available.
          </p>
        </section>

        <section class="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 class="text-lg font-semibold text-slate-950">Facility details</h2>
          <dl class="mt-4 grid gap-5 sm:grid-cols-2">
            <div>
              <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Address</dt>
              <dd class="mt-1 text-sm leading-6 text-slate-800">{{ address }}</dd>
            </div>
            <div>
              <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">PHMSA RIN</dt>
              <dd class="mt-1 text-sm font-semibold text-slate-800">{{ facility.rin }}</dd>
            </div>
            <div v-if="facility.phone">
              <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Phone</dt>
              <dd class="mt-1 text-sm">
                <a :href="'tel:' + facility.phone" class="font-medium text-teal-800 hover:underline">
                  {{ facility.phone }}
                </a>
              </dd>
            </div>
            <div v-if="facility.website_url">
              <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Website</dt>
              <dd class="mt-1 text-sm">
                <a
                  :href="facility.website_url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="font-medium text-teal-800 hover:underline"
                >
                  Visit provider website
                </a>
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <aside class="h-fit rounded-2xl border border-teal-200 bg-teal-50 p-6">
        <p class="text-sm font-semibold text-teal-950">Why this listing is published</p>
        <p class="mt-3 text-sm leading-6 text-teal-900">
          Cylinder Atlas starts with PHMSA requalifier data, then requires a current facility identity, customer-facing service evidence, and no unresolved address or identity conflict before publication.
        </p>

        <dl class="mt-5 space-y-4 border-t border-teal-200 pt-5">
          <div>
            <dt class="text-xs font-semibold uppercase tracking-wide text-teal-700">Regulatory identifier</dt>
            <dd class="mt-1 text-sm font-semibold text-teal-950">RIN {{ facility.rin }}</dd>
          </div>
          <div v-if="verifiedDate">
            <dt class="text-xs font-semibold uppercase tracking-wide text-teal-700">Last verified</dt>
            <dd class="mt-1 text-sm font-semibold text-teal-950">{{ verifiedDate }}</dd>
          </div>
        </dl>

        <p class="mt-5 text-xs leading-5 text-teal-800">
          Verify service details directly with the provider before visiting or shipping a cylinder.
        </p>

        <div class="mt-6 border-t border-teal-200 pt-5">
          <p class="text-sm font-semibold text-teal-950">Manage this listing</p>
          <p class="mt-2 text-xs leading-5 text-teal-800">
            Provider claims and corrections are reviewed before they change public listing data.
          </p>
          <div class="mt-4 grid gap-2">
            <NuxtLink
              :to="claimPath"
              class="rounded-lg bg-slate-950 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-slate-800"
            >
              Claim this listing
            </NuxtLink>
            <NuxtLink
              :to="correctionPath"
              class="rounded-lg border border-teal-300 bg-white px-4 py-2.5 text-center text-sm font-semibold text-teal-900 hover:border-teal-400"
            >
              Report or correct listing
            </NuxtLink>
          </div>
        </div>
      </aside>
    </div>
  </main>
</template>
