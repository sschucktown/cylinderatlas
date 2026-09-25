<script setup lang="ts">
import { displayName, providerPath, rinFromProviderSlug, titleCaseCity } from '~/utils/directory'

const route = useRoute()
const { $supabase } = useNuxtApp()

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
const name = displayName(facility)
const profilePath = providerPath(facility)
const canonicalSlug = profilePath.split('/').pop() || slug
const correctionPath = '/correct/' + canonicalSlug

if (route.path !== correctionPath) {
  await navigateTo(correctionPath, { redirectCode: 301, replace: true })
}

const email = ref('')
const user = ref<{ id: string; email?: string } | null>(null)
const authLoading = ref(true)
const authSending = ref(false)
const authSent = ref(false)
const authError = ref('')
const fieldName = ref('display_name')
const proposedValue = ref('')
const notes = ref('')
const submitting = ref(false)
const submitted = ref(false)
const submitError = ref('')
let unsubscribe: (() => void) | undefined

async function refreshUser() {
  authLoading.value = true
  const result = await $supabase.auth.getUser()

  if (result.error || !result.data.user) {
    user.value = null
  } else {
    user.value = {
      id: result.data.user.id,
      email: result.data.user.email,
    }
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
      shouldCreateUser: true,
      emailRedirectTo: window.location.origin + correctionPath,
    },
  })
  authSending.value = false

  if (result.error) {
    authError.value = result.error.message
    return
  }

  authSent.value = true
}

async function submitCorrection() {
  if (!user.value) return

  submitted.value = false
  submitError.value = ''

  if (!proposedValue.value.trim()) {
    submitError.value = 'Describe the correction you are requesting.'
    return
  }

  submitting.value = true
  const result = await $supabase
    .from('corrections')
    .insert({
      facility_id: facility.id,
      user_id: user.value.id,
      field_name: fieldName.value,
      proposed_value: {
        proposed: proposedValue.value.trim(),
        notes: notes.value.trim() || null,
      },
    })

  submitting.value = false

  if (result.error) {
    submitError.value = result.error.message
    return
  }

  proposedValue.value = ''
  notes.value = ''
  submitted.value = true
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
  title: 'Report or Correct ' + name + ' — Cylinder Atlas',
  description: 'Submit a correction request for this Cylinder Atlas provider listing.',
  robots: 'noindex,nofollow',
})
</script>

<template>
  <main class="mx-auto max-w-3xl px-6 py-12">
    <NuxtLink :to="profilePath" class="text-sm font-semibold text-teal-800 hover:underline">
      ← Back to provider
    </NuxtLink>

    <div class="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <p class="text-sm font-semibold uppercase tracking-[0.14em] text-teal-700">Listing correction</p>
      <h1 class="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Report or correct {{ name }}</h1>
      <p class="mt-3 text-sm leading-6 text-slate-600">
        {{ titleCaseCity(facility.city) }}, {{ facility.state }} · PHMSA RIN {{ facility.rin }}
      </p>
      <p class="mt-5 leading-7 text-slate-600">
        Corrections are reviewed against regulatory, business-identity, and service evidence before public listing data changes. A newer address does not automatically move a RIN.
      </p>

      <div v-if="authLoading" class="mt-8 text-sm text-slate-500">Checking sign-in…</div>

      <section v-else-if="!user" class="mt-8 rounded-2xl bg-slate-50 p-5">
        <h2 class="font-semibold text-slate-950">Sign in to submit a correction</h2>
        <p class="mt-2 text-sm leading-6 text-slate-600">
          Sign-in keeps correction requests attributable while the public directory remains read-only.
        </p>

        <form class="mt-4 flex flex-col gap-3 sm:flex-row" @submit.prevent="sendSignInLink">
          <label for="correction-email" class="sr-only">Email</label>
          <input
            id="correction-email"
            v-model="email"
            type="email"
            autocomplete="email"
            placeholder="you@example.com"
            class="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2.5 outline-none ring-teal-600 focus:ring-2"
          >
          <button
            type="submit"
            :disabled="authSending"
            class="rounded-lg bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {{ authSending ? 'Sending…' : 'Send sign-in link' }}
          </button>
        </form>

        <p v-if="authSent" class="mt-3 text-sm font-medium text-teal-800">
          Check your email for the sign-in link.
        </p>
        <p v-if="authError" class="mt-3 text-sm text-red-700">{{ authError }}</p>
      </section>

      <form v-else class="mt-8 space-y-5" @submit.prevent="submitCorrection">
        <p class="text-sm text-slate-500">Signed in as {{ user.email || 'authenticated user' }}</p>

        <div>
          <label for="field-name" class="mb-1.5 block text-sm font-semibold text-slate-800">What needs correcting?</label>
          <select
            id="field-name"
            v-model="fieldName"
            class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none ring-teal-600 focus:ring-2"
          >
            <option value="display_name">Provider name</option>
            <option value="display_address">Facility address</option>
            <option value="phone">Phone</option>
            <option value="website_url">Website</option>
            <option value="services">Services offered</option>
            <option value="business_status">Business / customer-access status</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div>
          <label for="proposed-value" class="mb-1.5 block text-sm font-semibold text-slate-800">What should Cylinder Atlas show?</label>
          <textarea
            id="proposed-value"
            v-model="proposedValue"
            rows="4"
            placeholder="Describe the corrected information."
            class="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none ring-teal-600 focus:ring-2"
          />
        </div>

        <div>
          <label for="notes" class="mb-1.5 block text-sm font-semibold text-slate-800">Evidence or context <span class="font-normal text-slate-500">(optional)</span></label>
          <textarea
            id="notes"
            v-model="notes"
            rows="3"
            placeholder="Website page, business change, address explanation, or other context."
            class="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none ring-teal-600 focus:ring-2"
          />
        </div>

        <button
          type="submit"
          :disabled="submitting"
          class="rounded-lg bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {{ submitting ? 'Submitting…' : 'Submit correction' }}
        </button>

        <p v-if="submitted" class="text-sm font-medium text-teal-800">
          Correction submitted for review. The public listing has not been changed automatically.
        </p>
        <p v-if="submitError" class="text-sm text-red-700">{{ submitError }}</p>
      </form>
    </div>
  </main>
</template>
