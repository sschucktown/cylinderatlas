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
const claimPath = '/claim/' + canonicalSlug

if (route.path !== claimPath) {
  await navigateTo(claimPath, { redirectCode: 301, replace: true })
}

const email = ref('')
const user = ref<{ id: string; email?: string } | null>(null)
const authLoading = ref(true)
const authSending = ref(false)
const authSent = ref(false)
const authError = ref('')
const submitting = ref(false)
const claimStatus = ref<string | null>(null)
const submitError = ref('')
let unsubscribe: (() => void) | undefined

async function loadClaimStatus(userId: string) {
  const result = await $supabase
    .from('claims')
    .select('status')
    .eq('facility_id', facility.id)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (result.error) {
    submitError.value = result.error.message
    return
  }

  claimStatus.value = result.data?.status ?? null
}

async function refreshUser() {
  authLoading.value = true
  const result = await $supabase.auth.getUser()

  if (result.error) {
    user.value = null
  } else if (result.data.user) {
    user.value = {
      id: result.data.user.id,
      email: result.data.user.email,
    }
    await loadClaimStatus(result.data.user.id)
  } else {
    user.value = null
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
      emailRedirectTo: window.location.origin + claimPath,
    },
  })
  authSending.value = false

  if (result.error) {
    authError.value = result.error.message
    return
  }

  authSent.value = true
}

async function submitClaim() {
  if (!user.value || claimStatus.value) return

  submitting.value = true
  submitError.value = ''

  const result = await $supabase
    .from('claims')
    .insert({
      facility_id: facility.id,
      user_id: user.value.id,
      verification_method: 'self_service_email',
    })
    .select('status')
    .single()

  submitting.value = false

  if (result.error) {
    submitError.value = result.error.message
    return
  }

  claimStatus.value = result.data.status
}

onMounted(async () => {
  await refreshUser()
  const { data } = $supabase.auth.onAuthStateChange(async () => {
    await refreshUser()
  })
  unsubscribe = () => data.subscription.unsubscribe()
})

onBeforeUnmount(() => {
  unsubscribe?.()
})

useSeoMeta({
  title: 'Claim ' + name + ' — Cylinder Atlas',
  description: 'Request ownership of this Cylinder Atlas provider listing.',
  robots: 'noindex,nofollow',
})
</script>

<template>
  <main class="mx-auto max-w-3xl px-6 py-12">
    <NuxtLink :to="profilePath" class="text-sm font-semibold text-teal-800 hover:underline">
      ← Back to provider
    </NuxtLink>

    <div class="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <p class="text-sm font-semibold uppercase tracking-[0.14em] text-teal-700">Provider claim</p>
      <h1 class="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Claim {{ name }}</h1>
      <p class="mt-3 text-sm leading-6 text-slate-600">
        {{ titleCaseCity(facility.city) }}, {{ facility.state }} · PHMSA RIN {{ facility.rin }}
      </p>
      <p class="mt-5 leading-7 text-slate-600">
        Claiming a listing does not change its PHMSA status or make Cylinder Atlas an approval authority. A claim creates a review request so provider-entered information can be tied to the correct facility.
      </p>

      <div v-if="authLoading" class="mt-8 text-sm text-slate-500">Checking sign-in…</div>

      <section v-else-if="!user" class="mt-8 rounded-2xl bg-slate-50 p-5">
        <h2 class="font-semibold text-slate-950">Sign in to request this claim</h2>
        <p class="mt-2 text-sm leading-6 text-slate-600">
          Enter a work email. We will send a passwordless sign-in link, then return you here to submit the claim.
        </p>

        <form class="mt-4 flex flex-col gap-3 sm:flex-row" @submit.prevent="sendSignInLink">
          <label for="claim-email" class="sr-only">Work email</label>
          <input
            id="claim-email"
            v-model="email"
            type="email"
            autocomplete="email"
            placeholder="you@company.com"
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

      <section v-else class="mt-8">
        <p class="text-sm text-slate-500">Signed in as {{ user.email || 'authenticated user' }}</p>

        <div v-if="claimStatus" class="mt-4 rounded-2xl border border-teal-200 bg-teal-50 p-5">
          <p class="font-semibold text-teal-950">Claim request: {{ claimStatus }}</p>
          <p class="mt-2 text-sm leading-6 text-teal-900">
            Public provider data will not change until the request is reviewed.
          </p>
        </div>

        <div v-else class="mt-4 rounded-2xl border border-slate-200 p-5">
          <h2 class="font-semibold text-slate-950">Submit claim request</h2>
          <p class="mt-2 text-sm leading-6 text-slate-600">
            Cylinder Atlas will review the account-to-facility relationship before treating this account as the provider.
          </p>
          <button
            type="button"
            :disabled="submitting"
            class="mt-4 rounded-lg bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            @click="submitClaim"
          >
            {{ submitting ? 'Submitting…' : 'Submit claim' }}
          </button>
        </div>

        <p v-if="submitError" class="mt-3 text-sm text-red-700">{{ submitError }}</p>
      </section>
    </div>
  </main>
</template>
