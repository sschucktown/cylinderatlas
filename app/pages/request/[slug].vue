<script setup lang="ts">
import {
  displayName,
  providerPath,
  rinFromProviderSlug,
  serviceLabel,
  titleCaseCity,
} from '~/utils/directory'

const route = useRoute()
const { $supabase, $posthog } = useNuxtApp()

const slug = String(route.params.slug ?? '')
const rin = rinFromProviderSlug(slug)

if (!rin) {
  throw createError({ statusCode: 404, statusMessage: 'Provider not found' })
}

const facilityResult = await $supabase
  .from('facilities')
  .select('id, rin, display_name, phmsa_name, city, state')
  .eq('publish_status', 'publish')
  .eq('rin', rin)
  .maybeSingle()

if (facilityResult.error) throw facilityResult.error
if (!facilityResult.data) {
  throw createError({ statusCode: 404, statusMessage: 'Provider not found' })
}

const facility = facilityResult.data

const intakeResult = await $supabase
  .from('facility_intake_settings')
  .select('enabled')
  .eq('facility_id', facility.id)
  .eq('enabled', true)
  .maybeSingle()

if (intakeResult.error) throw intakeResult.error
if (!intakeResult.data) {
  throw createError({
    statusCode: 404,
    statusMessage: 'Service requests are not enabled for this provider',
  })
}

const servicesResult = await $supabase
  .from('facility_services')
  .select('service_key')
  .eq('facility_id', facility.id)
  .in('status', ['verified', 'provider_confirmed'])
  .order('service_key')

if (servicesResult.error) throw servicesResult.error

const services = servicesResult.data ?? []
if (!services.length) {
  throw createError({ statusCode: 404, statusMessage: 'No requestable services are available' })
}

const name = displayName(facility)
const profilePath = providerPath(facility)

const submitting = ref(false)
const submitted = ref(false)
const submitError = ref('')

const form = reactive({
  customerName: '',
  customerEmail: '',
  customerPhone: '',
  serviceKey: services[0]!.service_key,
  quantity: '',
  timing: 'flexible',
  notes: '',
  website: '',
})

const timingOptions = [
  { value: 'asap', label: 'As soon as possible' },
  { value: 'this_week', label: 'This week' },
  { value: 'this_month', label: 'This month' },
  { value: 'flexible', label: 'Flexible / just researching' },
]

onMounted(() => {
  $posthog.capture('service_request_started', {
    rin: facility.rin,
    state: facility.state,
    service_keys: services.map((service) => service.service_key),
  })
})

async function submitRequest() {
  submitError.value = ''

  if (form.website) {
    submitted.value = true
    return
  }

  if (!form.customerName.trim() || !form.customerEmail.trim() || !form.serviceKey) {
    submitError.value = 'Name, email, and service are required.'
    return
  }

  const quantity = form.quantity.trim() ? Number.parseInt(form.quantity, 10) : null
  if (quantity !== null && (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000)) {
    submitError.value = 'Quantity must be between 1 and 10,000.'
    return
  }

  submitting.value = true

  const result = await $supabase
    .from('service_requests')
    .insert({
      facility_id: facility.id,
      customer_name: form.customerName.trim(),
      customer_email: form.customerEmail.trim(),
      customer_phone: form.customerPhone.trim() || null,
      service_key: form.serviceKey,
      quantity,
      timing: form.timing,
      notes: form.notes.trim() || null,
      source_path: route.path,
    })

  submitting.value = false

  if (result.error) {
    submitError.value =
      'Your request could not be submitted. Please contact the provider directly instead.'
    return
  }

  $posthog.capture('service_request_submitted', {
    rin: facility.rin,
    state: facility.state,
    service_key: form.serviceKey,
    timing: form.timing,
    has_phone: Boolean(form.customerPhone.trim()),
    has_quantity: quantity !== null,
  })

  submitted.value = true
}

useSeoMeta({
  title: 'Request service from ' + name + ' — CylinderAtlas',
  description: 'Send a structured cylinder service request to ' + name + '.',
  robots: 'noindex,nofollow',
})
</script>

<template>
  <main class="mx-auto max-w-3xl px-6 py-12">
    <NuxtLink :to="profilePath" class="text-sm font-semibold text-brand-800 hover:underline">
      ← Back to provider
    </NuxtLink>

    <div class="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <p class="text-sm font-semibold uppercase tracking-[0.14em] text-brand-700">Service request</p>
      <h1 class="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
        Request service from {{ name }}
      </h1>
      <p class="mt-3 text-sm leading-6 text-slate-600">
        {{ titleCaseCity(facility.city) }}, {{ facility.state }} · PHMSA RIN {{ facility.rin }}
      </p>

      <div v-if="submitted" class="mt-8 rounded-2xl border border-brand-200 bg-brand-50 p-6">
        <h2 class="text-xl font-semibold text-brand-950">Request submitted</h2>
        <p class="mt-2 text-sm leading-6 text-brand-900">
          Your request is now available in the provider's verified CylinderAtlas account.
          This does not guarantee availability, pricing, or turnaround time.
        </p>
        <NuxtLink
          :to="profilePath"
          class="mt-4 inline-flex text-sm font-semibold text-brand-950 hover:underline"
        >
          Return to provider profile →
        </NuxtLink>
      </div>

      <form v-else class="mt-8 space-y-6" @submit.prevent="submitRequest">
        <div class="grid gap-5 sm:grid-cols-2">
          <div>
            <label for="request-name" class="text-sm font-semibold text-slate-800">Your name</label>
            <input
              id="request-name"
              v-model="form.customerName"
              type="text"
              autocomplete="name"
              maxlength="100"
              required
              class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none ring-brand-600 focus:ring-2"
            >
          </div>

          <div>
            <label for="request-email" class="text-sm font-semibold text-slate-800">Email</label>
            <input
              id="request-email"
              v-model="form.customerEmail"
              type="email"
              autocomplete="email"
              maxlength="254"
              required
              class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none ring-brand-600 focus:ring-2"
            >
          </div>

          <div>
            <label for="request-phone" class="text-sm font-semibold text-slate-800">
              Phone <span class="font-normal text-slate-400">(optional)</span>
            </label>
            <input
              id="request-phone"
              v-model="form.customerPhone"
              type="tel"
              autocomplete="tel"
              maxlength="40"
              class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none ring-brand-600 focus:ring-2"
            >
          </div>

          <div>
            <label for="request-quantity" class="text-sm font-semibold text-slate-800">
              Approx. quantity <span class="font-normal text-slate-400">(optional)</span>
            </label>
            <input
              id="request-quantity"
              v-model="form.quantity"
              type="number"
              min="1"
              max="10000"
              inputmode="numeric"
              class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none ring-brand-600 focus:ring-2"
            >
          </div>
        </div>

        <div>
          <label for="request-service" class="text-sm font-semibold text-slate-800">
            Service needed
          </label>
          <select
            id="request-service"
            v-model="form.serviceKey"
            required
            class="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none ring-brand-600 focus:ring-2"
          >
            <option
              v-for="service in services"
              :key="service.service_key"
              :value="service.service_key"
            >
              {{ serviceLabel(service.service_key) }}
            </option>
          </select>
        </div>

        <div>
          <label for="request-timing" class="text-sm font-semibold text-slate-800">
            When do you need it?
          </label>
          <select
            id="request-timing"
            v-model="form.timing"
            class="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none ring-brand-600 focus:ring-2"
          >
            <option
              v-for="option in timingOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </div>

        <div>
          <label for="request-notes" class="text-sm font-semibold text-slate-800">
            Cylinder details or notes <span class="font-normal text-slate-400">(optional)</span>
          </label>
          <textarea
            id="request-notes"
            v-model="form.notes"
            rows="5"
            maxlength="2000"
            placeholder="Cylinder type, size, material, current markings, access/drop-off questions, or anything else the provider should know."
            class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none ring-brand-600 focus:ring-2"
          />
        </div>

        <div class="hidden" aria-hidden="true">
          <label for="request-website">Website</label>
          <input
            id="request-website"
            v-model="form.website"
            type="text"
            tabindex="-1"
            autocomplete="off"
          >
        </div>

        <p class="text-xs leading-5 text-slate-500">
          CylinderAtlas passes this information to the verified provider account for this facility.
          Do not include sensitive financial, medical, or identity information.
        </p>

        <button
          type="submit"
          :disabled="submitting"
          class="rounded-xl bg-navy px-6 py-3 text-sm font-semibold text-white hover:bg-brand-950 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {{ submitting ? 'Submitting…' : 'Send service request' }}
        </button>

        <p v-if="submitError" class="text-sm text-red-700">{{ submitError }}</p>
      </form>
    </div>
  </main>
</template>
