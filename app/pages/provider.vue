<script setup lang="ts">
import type { Enums, Tables } from '~~/types/database'
import { displayName, providerPath, serviceLabel, titleCaseCity } from '~/utils/directory'
import { authRedirectUrl } from '~/utils/site'

type Membership = Tables<'facility_memberships'>
type IntakeSetting = Tables<'facility_intake_settings'>
type ServiceRequest = Tables<'service_requests'>
type RequestStatus = Enums<'service_request_status_enum'>
type Facility = Pick<
  Tables<'facilities'>,
  'id' | 'rin' | 'display_name' | 'phmsa_name' | 'city' | 'state'
>

const { $supabase, $posthog } = useNuxtApp()

const email = ref('')
const user = ref<{ id: string; email?: string } | null>(null)
const authLoading = ref(true)
const authSending = ref(false)
const authSent = ref(false)
const authError = ref('')
const loading = ref(false)
const loadError = ref('')
const memberships = ref<Membership[]>([])
const facilities = ref<Facility[]>([])
const intakeSettings = ref<IntakeSetting[]>([])
const requests = ref<ServiceRequest[]>([])
const savingRequestId = ref<string | null>(null)
const savingIntakeFacilityId = ref<string | null>(null)
let unsubscribe: (() => void) | undefined

const membershipByFacility = computed(() =>
  Object.fromEntries(memberships.value.map((membership) => [membership.facility_id, membership])),
)
const facilityById = computed(() =>
  Object.fromEntries(facilities.value.map((facility) => [facility.id, facility])),
)
const intakeByFacility = computed(() =>
  Object.fromEntries(intakeSettings.value.map((setting) => [setting.facility_id, setting])),
)
const activeRequests = computed(() =>
  requests.value.filter((request) => request.status === 'new' || request.status === 'contacted'),
)
const closedRequests = computed(() =>
  requests.value.filter((request) => request.status === 'won' || request.status === 'not_fit'),
)

function requestFacilityName(request: ServiceRequest) {
  const facility = facilityById.value[request.facility_id]
  return facility ? displayName(facility) : 'Provider'
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function timingLabel(value: string) {
  return {
    asap: 'As soon as possible',
    this_week: 'This week',
    this_month: 'This month',
    flexible: 'Flexible',
  }[value] || value
}

function statusLabel(status: RequestStatus) {
  return {
    new: 'New',
    contacted: 'Contacted',
    won: 'Won',
    not_fit: 'Not a fit',
  }[status]
}

async function markRequestsViewed(rows: ServiceRequest[]) {
  const unseenIds = rows
    .filter((request) => !request.provider_viewed_at)
    .map((request) => request.id)

  if (!unseenIds.length) return

  const viewedAt = new Date().toISOString()
  const result = await $supabase
    .from('service_requests')
    .update({ provider_viewed_at: viewedAt })
    .in('id', unseenIds)

  if (!result.error) {
    requests.value = requests.value.map((request) =>
      unseenIds.includes(request.id)
        ? { ...request, provider_viewed_at: viewedAt }
        : request,
    )
  }
}

async function loadAccount(userId: string) {
  loading.value = true
  loadError.value = ''

  const membershipResult = await $supabase
    .from('facility_memberships')
    .select('*')
    .eq('user_id', userId)
    .order('created_at')

  if (membershipResult.error) {
    loading.value = false
    loadError.value = membershipResult.error.message
    return
  }

  memberships.value = membershipResult.data ?? []
  const facilityIds = memberships.value.map((membership) => membership.facility_id)

  if (!facilityIds.length) {
    facilities.value = []
    intakeSettings.value = []
    requests.value = []
    loading.value = false
    return
  }

  const [facilitiesResult, settingsResult, requestsResult] = await Promise.all([
    $supabase
      .from('facilities')
      .select('id, rin, display_name, phmsa_name, city, state')
      .in('id', facilityIds)
      .eq('publish_status', 'publish')
      .order('state')
      .order('city'),
    $supabase
      .from('facility_intake_settings')
      .select('*')
      .in('facility_id', facilityIds),
    $supabase
      .from('service_requests')
      .select('*')
      .in('facility_id', facilityIds)
      .order('created_at', { ascending: false })
      .limit(200),
  ])

  loading.value = false

  const error = facilitiesResult.error || settingsResult.error || requestsResult.error
  if (error) {
    loadError.value = error.message
    facilities.value = []
    intakeSettings.value = []
    requests.value = []
    return
  }

  facilities.value = facilitiesResult.data ?? []
  intakeSettings.value = settingsResult.data ?? []
  requests.value = requestsResult.data ?? []

  $posthog.capture('provider_request_inbox_viewed', {
    facility_count: facilities.value.length,
    request_count: requests.value.length,
    new_request_count: requests.value.filter((request) => request.status === 'new').length,
  })

  await markRequestsViewed(requests.value)
}

async function updateRequestStatus(request: ServiceRequest, status: RequestStatus) {
  savingRequestId.value = request.id
  loadError.value = ''

  const result = await $supabase
    .from('service_requests')
    .update({ status })
    .eq('id', request.id)

  savingRequestId.value = null

  if (result.error) {
    loadError.value = result.error.message
    return
  }

  requests.value = requests.value.map((row) =>
    row.id === request.id ? { ...row, status } : row,
  )

  $posthog.capture('service_request_status_changed', {
    rin: facilityById.value[request.facility_id]?.rin,
    service_key: request.service_key,
    from_status: request.status,
    to_status: status,
  })
}

async function setIntakeEnabled(facilityId: string, enabled: boolean) {
  savingIntakeFacilityId.value = facilityId
  loadError.value = ''

  const result = await $supabase
    .from('facility_intake_settings')
    .update({ enabled })
    .eq('facility_id', facilityId)

  savingIntakeFacilityId.value = null

  if (result.error) {
    loadError.value = result.error.message
    return
  }

  intakeSettings.value = intakeSettings.value.map((setting) =>
    setting.facility_id === facilityId ? { ...setting, enabled } : setting,
  )

  $posthog.capture('provider_intake_toggled', {
    rin: facilityById.value[facilityId]?.rin,
    enabled,
  })
}

function onIntakeToggle(facilityId: string, event: Event) {
  const target = event.target as HTMLInputElement | null
  if (!target) return
  void setIntakeEnabled(facilityId, target.checked)
}

async function refreshUser() {
  authLoading.value = true
  authError.value = ''

  const result = await $supabase.auth.getUser()

  if (result.error || !result.data.user) {
    user.value = null
    memberships.value = []
    facilities.value = []
    intakeSettings.value = []
    requests.value = []
  } else {
    user.value = {
      id: result.data.user.id,
      email: result.data.user.email,
    }
    await loadAccount(result.data.user.id)
  }

  authLoading.value = false
}

async function sendSignInLink() {
  authError.value = ''
  authSent.value = false

  if (!email.value.trim()) {
    authError.value = 'Enter your email address.'
    return
  }

  authSending.value = true
  const result = await $supabase.auth.signInWithOtp({
    email: email.value.trim(),
    options: {
      shouldCreateUser: false,
      emailRedirectTo: authRedirectUrl('/provider'),
    },
  })
  authSending.value = false

  if (result.error) {
    authError.value = result.error.message
    return
  }

  authSent.value = true
}

async function signOut() {
  await $supabase.auth.signOut()
  await refreshUser()
}

onMounted(async () => {
  await refreshUser()

  const { data } = $supabase.auth.onAuthStateChange(() => {
    window.setTimeout(() => {
      void refreshUser()
    }, 0)
  })

  unsubscribe = () => data.subscription.unsubscribe()
})

onBeforeUnmount(() => {
  unsubscribe?.()
})

useSeoMeta({
  title: 'Provider Account — CylinderAtlas',
  description: 'Manage verified CylinderAtlas provider listings and customer service requests.',
  robots: 'noindex,nofollow',
})
</script>

<template>
  <main class="mx-auto max-w-6xl px-6 py-12">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p class="text-sm font-semibold uppercase tracking-[0.14em] text-brand-700">Provider account</p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
          Your CylinderAtlas account
        </h1>
        <p class="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
          Manage claimed facilities and organized customer requests. Regulatory listing facts remain protected.
        </p>
      </div>

      <button
        v-if="user"
        type="button"
        class="self-start rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        @click="signOut"
      >
        Sign out
      </button>
    </div>

    <div
      v-if="authLoading"
      class="mt-8 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm"
    >
      Checking provider access…
    </div>

    <section
      v-else-if="!user"
      class="mt-8 max-w-xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <h2 class="text-xl font-semibold text-slate-950">Provider sign in</h2>
      <p class="mt-2 text-sm leading-6 text-slate-600">
        Use the same email address used to submit your provider claim.
      </p>

      <form class="mt-5 flex flex-col gap-3 sm:flex-row" @submit.prevent="sendSignInLink">
        <label for="provider-email" class="sr-only">Email</label>
        <input
          id="provider-email"
          v-model="email"
          type="email"
          autocomplete="email"
          placeholder="you@company.com"
          class="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2.5 outline-none ring-brand-600 focus:ring-2"
        >
        <button
          type="submit"
          :disabled="authSending"
          class="rounded-lg bg-navy px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-950 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {{ authSending ? 'Sending…' : 'Send sign-in link' }}
        </button>
      </form>

      <p v-if="authSent" class="mt-3 text-sm font-medium text-brand-800">
        Check your email for the sign-in link.
      </p>
      <p v-if="authError" class="mt-3 text-sm text-red-700">{{ authError }}</p>
    </section>

    <template v-else>
      <p class="mt-8 text-sm text-slate-500">
        Signed in as {{ user.email || 'authenticated user' }}
      </p>

      <p
        v-if="loadError"
        class="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
      >
        {{ loadError }}
      </p>

      <div v-if="loading" class="mt-6 text-sm text-slate-500">Loading provider account…</div>

      <template v-else-if="facilities.length">
        <section class="mt-8">
          <div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p class="text-sm font-semibold uppercase tracking-[0.12em] text-brand-700">
                Customer requests
              </p>
              <h2 class="mt-1 text-2xl font-semibold text-slate-950">Request inbox</h2>
            </div>
            <p class="text-xs text-slate-500">
              Email notifications are not enabled yet; requests appear here.
            </p>
          </div>

          <div v-if="activeRequests.length" class="mt-5 space-y-4">
            <article
              v-for="request in activeRequests"
              :key="request.id"
              class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
            >
              <div class="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <span
                      class="rounded-full px-2.5 py-1 text-xs font-semibold"
                      :class="request.status === 'new'
                        ? 'bg-amber-100 text-amber-900'
                        : 'bg-brand-100 text-brand-900'"
                    >
                      {{ statusLabel(request.status) }}
                    </span>
                    <span class="text-xs font-medium text-slate-500">
                      {{ formatDate(request.created_at) }}
                    </span>
                  </div>

                  <h3 class="mt-3 text-xl font-semibold text-slate-950">
                    {{ request.customer_name }}
                  </h3>
                  <p class="mt-1 text-sm text-slate-600">
                    {{ requestFacilityName(request) }} · {{ serviceLabel(request.service_key) }}
                  </p>

                  <dl class="mt-5 grid gap-4 text-sm sm:grid-cols-2">
                    <div>
                      <dt class="font-medium text-slate-500">Email</dt>
                      <dd class="mt-1 break-all">
                        <a
                          :href="'mailto:' + request.customer_email"
                          class="font-semibold text-brand-800 hover:underline"
                        >
                          {{ request.customer_email }}
                        </a>
                      </dd>
                    </div>

                    <div v-if="request.customer_phone">
                      <dt class="font-medium text-slate-500">Phone</dt>
                      <dd class="mt-1">
                        <a
                          :href="'tel:' + request.customer_phone"
                          class="font-semibold text-brand-800 hover:underline"
                        >
                          {{ request.customer_phone }}
                        </a>
                      </dd>
                    </div>

                    <div>
                      <dt class="font-medium text-slate-500">Timing</dt>
                      <dd class="mt-1 text-slate-900">{{ timingLabel(request.timing) }}</dd>
                    </div>

                    <div>
                      <dt class="font-medium text-slate-500">Quantity</dt>
                      <dd class="mt-1 text-slate-900">
                        {{ request.quantity || 'Not specified' }}
                      </dd>
                    </div>
                  </dl>

                  <p
                    v-if="request.notes"
                    class="mt-5 whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-700"
                  >
                    {{ request.notes }}
                  </p>
                </div>

                <div class="flex shrink-0 flex-wrap gap-2 lg:w-36 lg:flex-col">
                  <button
                    v-if="request.status === 'new'"
                    type="button"
                    :disabled="savingRequestId === request.id"
                    class="rounded-lg bg-navy px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-950 disabled:opacity-60"
                    @click="updateRequestStatus(request, 'contacted')"
                  >
                    Mark contacted
                  </button>

                  <button
                    v-if="request.status === 'contacted'"
                    type="button"
                    :disabled="savingRequestId === request.id"
                    class="rounded-lg bg-navy px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-950 disabled:opacity-60"
                    @click="updateRequestStatus(request, 'won')"
                  >
                    Mark won
                  </button>

                  <button
                    type="button"
                    :disabled="savingRequestId === request.id"
                    class="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    @click="updateRequestStatus(request, 'not_fit')"
                  >
                    Not a fit
                  </button>
                </div>
              </div>
            </article>
          </div>

          <div
            v-else
            class="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500"
          >
            No active customer requests.
          </div>

          <details
            v-if="closedRequests.length"
            class="mt-5 rounded-2xl border border-slate-200 bg-white p-5"
          >
            <summary class="cursor-pointer text-sm font-semibold text-slate-800">
              Closed requests ({{ closedRequests.length }})
            </summary>

            <div class="mt-4 space-y-3">
              <div
                v-for="request in closedRequests"
                :key="request.id"
                class="flex flex-col gap-1 border-t border-slate-100 pt-3 first:border-t-0 first:pt-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p class="font-semibold text-slate-950">
                    {{ request.customer_name }} · {{ serviceLabel(request.service_key) }}
                  </p>
                  <p class="mt-1 text-xs text-slate-500">
                    {{ requestFacilityName(request) }} · {{ formatDate(request.created_at) }}
                  </p>
                </div>
                <span
                  class="mt-1 self-start rounded-full px-2.5 py-1 text-xs font-semibold sm:mt-0"
                  :class="request.status === 'won'
                    ? 'bg-brand-100 text-brand-900'
                    : 'bg-slate-100 text-slate-700'"
                >
                  {{ statusLabel(request.status) }}
                </span>
              </div>
            </div>
          </details>
        </section>

        <section class="mt-12">
          <p class="text-sm font-semibold uppercase tracking-[0.12em] text-brand-700">Listings</p>
          <h2 class="mt-1 text-2xl font-semibold text-slate-950">Claimed facilities</h2>

          <div class="mt-5 grid gap-4 md:grid-cols-2">
            <article
              v-for="facility in facilities"
              :key="facility.id"
              class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <div class="flex flex-wrap items-center gap-2">
                <span class="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-900">
                  Verified {{ membershipByFacility[facility.id]?.role || 'provider' }}
                </span>
                <span class="text-xs font-medium text-slate-500">RIN {{ facility.rin }}</span>
              </div>

              <h3 class="mt-3 text-xl font-semibold text-slate-950">
                {{ displayName(facility) }}
              </h3>
              <p class="mt-1 text-sm text-slate-600">
                {{ titleCaseCity(facility.city) }}, {{ facility.state }}
              </p>

              <label class="mt-5 flex items-start gap-3 rounded-xl bg-slate-50 p-4">
                <input
                  type="checkbox"
                  class="mt-0.5 h-4 w-4"
                  :checked="intakeByFacility[facility.id]?.enabled === true"
                  :disabled="savingIntakeFacilityId === facility.id"
                  @change="onIntakeToggle(facility.id, $event)"
                >
                <span>
                  <span class="block text-sm font-semibold text-slate-900">
                    Accept CylinderAtlas service requests
                  </span>
                  <span class="mt-1 block text-xs leading-5 text-slate-500">
                    When enabled, customers see a structured Request service button on this profile.
                  </span>
                </span>
              </label>

              <div class="mt-5 flex flex-wrap gap-3">
                <NuxtLink
                  :to="providerPath(facility)"
                  class="rounded-lg bg-navy px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-950"
                >
                  View public profile
                </NuxtLink>

                <NuxtLink
                  :to="'/correct/' + providerPath(facility).split('/').pop()"
                  class="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:border-slate-400"
                >
                  Request listing change
                </NuxtLink>
              </div>
            </article>
          </div>
        </section>
      </template>

      <section
        v-else
        class="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-8"
      >
        <h2 class="font-semibold text-slate-950">No verified listings yet</h2>
        <p class="mt-2 text-sm leading-6 text-slate-600">
          Submit a claim from a public provider profile. Once the claim is approved, the listing will appear here automatically.
        </p>
        <NuxtLink
          to="/search"
          class="mt-4 inline-flex text-sm font-semibold text-brand-800 hover:underline"
        >
          Find your provider listing →
        </NuxtLink>
      </section>
    </template>
  </main>
</template>
