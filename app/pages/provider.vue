<script setup lang="ts">
import type { Tables } from '~~/types/database'
import { displayName, providerPath, titleCaseCity } from '~/utils/directory'
import { authRedirectUrl } from '~/utils/site'

type Membership = Tables<'facility_memberships'>
type Facility = Pick<
  Tables<'facilities'>,
  'id' | 'rin' | 'display_name' | 'phmsa_name' | 'city' | 'state'
>

const { $supabase } = useNuxtApp()

const email = ref('')
const user = ref<{ id: string; email?: string } | null>(null)
const authLoading = ref(true)
const authSending = ref(false)
const authSent = ref(false)
const authError = ref('')
const loadingListings = ref(false)
const loadError = ref('')
const memberships = ref<Membership[]>([])
const facilities = ref<Facility[]>([])
let unsubscribe: (() => void) | undefined

const membershipByFacility = computed(() =>
  Object.fromEntries(memberships.value.map((membership) => [membership.facility_id, membership])),
)

async function loadListings(userId: string) {
  loadingListings.value = true
  loadError.value = ''

  const membershipResult = await $supabase
    .from('facility_memberships')
    .select('*')
    .eq('user_id', userId)
    .order('created_at')

  if (membershipResult.error) {
    loadingListings.value = false
    loadError.value = membershipResult.error.message
    return
  }

  memberships.value = membershipResult.data ?? []
  const facilityIds = memberships.value.map((membership) => membership.facility_id)

  if (!facilityIds.length) {
    facilities.value = []
    loadingListings.value = false
    return
  }

  const facilitiesResult = await $supabase
    .from('facilities')
    .select('id, rin, display_name, phmsa_name, city, state')
    .in('id', facilityIds)
    .eq('publish_status', 'publish')
    .order('state')
    .order('city')

  loadingListings.value = false

  if (facilitiesResult.error) {
    loadError.value = facilitiesResult.error.message
    facilities.value = []
    return
  }

  facilities.value = facilitiesResult.data ?? []
}

async function refreshUser() {
  authLoading.value = true
  authError.value = ''

  const result = await $supabase.auth.getUser()

  if (result.error || !result.data.user) {
    user.value = null
    memberships.value = []
    facilities.value = []
  } else {
    user.value = {
      id: result.data.user.id,
      email: result.data.user.email,
    }
    await loadListings(result.data.user.id)
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
  description: 'Manage verified CylinderAtlas provider listings.',
  robots: 'noindex,nofollow',
})
</script>

<template>
  <main class="mx-auto max-w-5xl px-6 py-12">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p class="text-sm font-semibold uppercase tracking-[0.14em] text-brand-700">Provider account</p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Your CylinderAtlas listings</h1>
        <p class="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
          Verified provider claims appear here. Regulatory facts remain protected; listing corrections continue through the reviewed correction workflow.
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

    <div v-if="authLoading" class="mt-8 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
      Checking provider access…
    </div>

    <section v-else-if="!user" class="mt-8 max-w-xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
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

      <p v-if="authSent" class="mt-3 text-sm font-medium text-brand-800">Check your email for the sign-in link.</p>
      <p v-if="authError" class="mt-3 text-sm text-red-700">{{ authError }}</p>
    </section>

    <template v-else>
      <p class="mt-8 text-sm text-slate-500">Signed in as {{ user.email || 'authenticated user' }}</p>

      <p v-if="loadError" class="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        {{ loadError }}
      </p>

      <div v-if="loadingListings" class="mt-6 text-sm text-slate-500">Loading listings…</div>

      <section v-else-if="facilities.length" class="mt-6 grid gap-4 md:grid-cols-2">
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
          <h2 class="mt-3 text-xl font-semibold text-slate-950">{{ displayName(facility) }}</h2>
          <p class="mt-1 text-sm text-slate-600">{{ titleCaseCity(facility.city) }}, {{ facility.state }}</p>

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
              Request a listing change
            </NuxtLink>
          </div>
        </article>
      </section>

      <section v-else class="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-8">
        <h2 class="font-semibold text-slate-950">No verified listings yet</h2>
        <p class="mt-2 text-sm leading-6 text-slate-600">
          Submit a claim from a public provider profile. Once the claim is approved, the listing will appear here automatically.
        </p>
        <NuxtLink to="/search" class="mt-4 inline-flex text-sm font-semibold text-brand-800 hover:underline">
          Find your provider listing →
        </NuxtLink>
      </section>
    </template>
  </main>
</template>
