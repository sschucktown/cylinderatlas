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
const { $supabase, $posthog } = useNuxtApp()

const slug = String(route.params.slug ?? '')
const rin = rinFromProviderSlug(slug)

if (!rin) {
  throw createError({ statusCode: 404, statusMessage: 'Provider not found' })
}

const facilityResult = await $supabase
  .from('facilities')
  .select(
    'id, rin, display_name, phmsa_name, display_address, phmsa_address, city, state, postal_code, phone, website_url, verified_at, source_effective_date',
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
  .select('service_key, status')
  .eq('facility_id', facility.id)
  .in('status', ['verified', 'provider_confirmed'])
  .order('service_key')

if (servicesResult.error) throw servicesResult.error

const publicSourcesResult = await $supabase
  .from('facility_public_sources')
  .select('purpose, source_type, url, label, verified_at')
  .eq('facility_id', facility.id)
  .order('purpose')
  .order('verified_at', { ascending: false })

if (publicSourcesResult.error) throw publicSourcesResult.error

const intakeResult = await $supabase
  .from('facility_intake_settings')
  .select('enabled')
  .eq('facility_id', facility.id)
  .eq('enabled', true)
  .maybeSingle()

if (intakeResult.error) throw intakeResult.error

const services = servicesResult.data ?? []
const publicSources = publicSourcesResult.data ?? []
const intakeEnabled = intakeResult.data?.enabled === true
const name = displayName(facility)

onMounted(() => {
  $posthog.capture('provider_profile_viewed', {
    rin: facility.rin,
    state: facility.state,
    city: facility.city,
    service_keys: services.map((service) => service.service_key),
    has_website: Boolean(facility.website_url),
    has_phone: Boolean(facility.phone),
    intake_enabled: intakeEnabled,
  })
})

function trackProviderWebsiteClick() {
  $posthog.capture('provider_website_clicked', {
    rin: facility.rin,
    state: facility.state,
    city: facility.city,
    service_keys: services.map((service) => service.service_key),
  })
}

function trackProviderPhoneClick() {
  $posthog.capture('provider_phone_clicked', {
    rin: facility.rin,
    state: facility.state,
    city: facility.city,
    service_keys: services.map((service) => service.service_key),
  })
}

function trackServiceRequestClick() {
  $posthog.capture('service_request_cta_clicked', {
    rin: facility.rin,
    state: facility.state,
    city: facility.city,
    service_keys: services.map((service) => service.service_key),
  })
}

const currentPath = providerPath(facility)
const verifiedDate = formatVerifiedDate(facility.verified_at)
const sourceEffectiveDate = formatVerifiedDate(facility.source_effective_date)
const address =
  facility.display_address ||
  [
    facility.phmsa_address,
    [titleCaseCity(facility.city), facility.state, facility.postal_code].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ')
const canonicalSlug = currentPath.split('/').pop() || slug
const claimPath = '/claim/' + canonicalSlug
const correctionPath = '/correct/' + canonicalSlug
const requestPath = '/request/' + canonicalSlug

if (route.path !== currentPath) {
  await navigateTo(currentPath, { redirectCode: 301, replace: true })
}

useSeoMeta({
  title: name + ' — Cylinder Requalification Provider | CylinderAtlas',
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
        address,
        telephone: facility.phone || undefined,
        url: canonicalUrl(currentPath),
        sameAs: facility.website_url ? [facility.website_url] : undefined,
        identifier: {
          '@type': 'PropertyValue',
          propertyID: 'PHMSA RIN',
          value: facility.rin,
        },
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
        <div class="flex flex-wrap items-center gap-2">
          <span class="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-brand-800">
            PHMSA-listed RIN
          </span>
          <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
            Source verified
          </span>
        </div>

        <h1 class="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
          {{ name }}
        </h1>
        <p class="mt-3 text-lg text-slate-600">
          {{ titleCaseCity(facility.city) }}, {{ facility.state }}
        </p>

        <div v-if="intakeEnabled || facility.phone || facility.website_url" class="mt-6 flex flex-wrap gap-3">
          <NuxtLink
            v-if="intakeEnabled"
            :to="requestPath"
            class="rounded-xl bg-navy px-5 py-3 text-sm font-semibold text-white hover:bg-brand-950"
            @click="trackServiceRequestClick"
          >
            Request service
          </NuxtLink>
          <a
            v-if="facility.phone"
            :href="'tel:' + facility.phone"
            class="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 hover:border-slate-400"
            @click="trackProviderPhoneClick"
          >
            Call provider
          </a>
          <a
            v-if="facility.website_url"
            :href="facility.website_url"
            target="_blank"
            rel="noopener noreferrer"
            class="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 hover:border-slate-400"
            @click="trackProviderWebsiteClick"
          >
            Visit provider website
          </a>
        </div>

        <section class="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Evidence-backed categories</p>
            <h2 class="mt-1 text-lg font-semibold text-slate-950">Cylinder services</h2>
          </div>

          <div v-if="services.length" class="mt-4 grid gap-3 sm:grid-cols-2">
            <NuxtLink
              v-for="service in services"
              :key="service.service_key"
              :to="'/services/' + service.service_key"
              class="rounded-xl border border-slate-200 bg-slate-50 p-4 hover:border-brand-300 hover:bg-brand-50"
            >
              <p class="font-semibold text-slate-950">{{ serviceLabel(service.service_key) }}</p>
              <p class="mt-1 text-xs font-medium text-slate-500">
                {{ service.status === 'provider_confirmed' ? 'Provider confirmed' : 'Source verified' }}
              </p>
            </NuxtLink>
          </div>
          <p v-else class="mt-3 text-sm text-slate-600">
            No public service labels are currently available.
          </p>

          <p class="mt-4 text-xs leading-5 text-slate-500">
            Service categories are published only when CylinderAtlas has current supporting evidence or a reviewed provider confirmation. Confirm cylinder-specific capabilities directly with the provider.
          </p>
        </section>

        <section class="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 class="text-lg font-semibold text-slate-950">Facility details</h2>
          <dl class="mt-4 grid gap-5 sm:grid-cols-2">
            <div>
              <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Facility address</dt>
              <dd class="mt-1 text-sm leading-6 text-slate-800">{{ address }}</dd>
            </div>
            <div>
              <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">PHMSA RIN</dt>
              <dd class="mt-1 text-sm font-semibold text-slate-800">{{ facility.rin }}</dd>
            </div>
            <div v-if="facility.phone">
              <dt class="text-xs font-semibold uppercase tracking-wide text-slate-500">Phone</dt>
              <dd class="mt-1 text-sm">
                <a :href="'tel:' + facility.phone" class="font-medium text-brand-800 hover:underline">
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
                  class="font-medium text-brand-800 hover:underline"
                  @click="trackProviderWebsiteClick"
                >
                  Visit provider website
                </a>
              </dd>
            </div>
          </dl>
        </section>

        <section class="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 class="text-lg font-semibold text-slate-950">How this listing is sourced</h2>
          <div class="mt-5 grid gap-5 sm:grid-cols-2">
            <div>
              <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Regulatory foundation</p>
              <p class="mt-1 text-sm leading-6 text-slate-700">
                CylinderAtlas starts with PHMSA cylinder requalifier data tied to RIN {{ facility.rin }}.
                <span v-if="sourceEffectiveDate"> Source record date: {{ sourceEffectiveDate }}.</span>
              </p>
            </div>
            <div>
              <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Current identity</p>
              <p class="mt-1 text-sm leading-6 text-slate-700">
                The current business identity and facility location were reconciled before this listing was published.
              </p>
            </div>
            <div>
              <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Service evidence</p>
              <p class="mt-1 text-sm leading-6 text-slate-700">
                Public service categories require current customer-facing evidence or reviewed provider confirmation.
              </p>
            </div>
            <div>
              <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Last checked</p>
              <p class="mt-1 text-sm leading-6 text-slate-700">
                {{ verifiedDate || 'Verification date unavailable' }}
              </p>
            </div>
          </div>

          <div v-if="publicSources.length" class="mt-5 border-t border-slate-200 pt-5">
            <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Public sources</p>
            <ul class="mt-3 space-y-3">
              <li
                v-for="source in publicSources"
                :key="source.purpose + source.url"
                class="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
              >
                <div>
                  <a
                    :href="source.url"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-sm font-semibold text-brand-800 hover:underline"
                  >
                    {{ source.label }}
                  </a>
                  <p class="mt-0.5 text-xs text-slate-500">
                    {{ source.purpose === 'identity'
                      ? 'Supports current business identity or facility location.'
                      : source.purpose === 'service'
                        ? 'Supports a published service category.'
                        : 'Current provider website.' }}
                  </p>
                </div>
                <span class="shrink-0 text-xs text-slate-400">
                  Checked {{ formatVerifiedDate(source.verified_at) || 'recently' }}
                </span>
              </li>
            </ul>
          </div>

          <p class="mt-5 border-t border-slate-200 pt-4 text-xs leading-5 text-slate-500">
            CylinderAtlas does not certify or approve requalification facilities. PHMSA is the regulatory source for RIN information; CylinderAtlas adds current business and service evidence for directory use.
          </p>
        </section>
      </div>

      <aside class="h-fit space-y-4 lg:sticky lg:top-6">
        <section v-if="intakeEnabled" class="rounded-2xl border border-brand-200 bg-white p-6 shadow-sm">
          <p class="text-sm font-semibold text-slate-950">Request service</p>
          <p class="mt-2 text-xs leading-5 text-slate-600">
            Send a structured request directly to this provider's verified CylinderAtlas account.
          </p>
          <NuxtLink
            :to="requestPath"
            class="mt-4 block rounded-lg bg-navy px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-brand-950"
            @click="trackServiceRequestClick"
          >
            Start request
          </NuxtLink>
        </section>

        <section class="rounded-2xl border border-brand-200 bg-brand-50 p-6">
          <p class="text-sm font-semibold text-brand-950">Why this listing is public</p>
          <p class="mt-3 text-sm leading-6 text-brand-900">
            It cleared the current CylinderAtlas publication gate: PHMSA hydrostatic authorization, matched facility identity, active business status, outside-customer access, evidence-backed service, and no unresolved identity or location conflict.
          </p>

          <dl class="mt-5 space-y-4 border-t border-brand-200 pt-5">
            <div>
              <dt class="text-xs font-semibold uppercase tracking-wide text-brand-700">PHMSA-listed RIN</dt>
              <dd class="mt-1 text-sm font-semibold text-brand-950">{{ facility.rin }}</dd>
            </div>
            <div v-if="verifiedDate">
              <dt class="text-xs font-semibold uppercase tracking-wide text-brand-700">Last checked</dt>
              <dd class="mt-1 text-sm font-semibold text-brand-950">{{ verifiedDate }}</dd>
            </div>
          </dl>

          <p class="mt-5 text-xs leading-5 text-brand-800">
            Verify service details, pricing, hours, and turnaround directly with the provider before visiting or shipping a cylinder.
          </p>
          <NuxtLink
            to="/how-we-verify"
            class="mt-4 inline-flex text-xs font-semibold text-brand-950 hover:underline"
          >
            How CylinderAtlas verifies providers
          </NuxtLink>
        </section>

        <section class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p class="text-sm font-semibold text-slate-950">Manage this listing</p>
          <p class="mt-2 text-xs leading-5 text-slate-600">
            Provider claims and corrections are reviewed before they change public listing data.
          </p>
          <div class="mt-4 grid gap-2">
            <NuxtLink
              :to="claimPath"
              class="rounded-lg bg-navy px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-brand-950"
            >
              Claim this listing
            </NuxtLink>
            <NuxtLink
              :to="correctionPath"
              class="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-center text-sm font-semibold text-slate-800 hover:border-slate-400"
            >
              Report or correct listing
            </NuxtLink>
          </div>
        </section>
      </aside>
    </div>
  </main>
</template>
