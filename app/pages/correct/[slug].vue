<script setup lang="ts">
import { displayName, providerPath, rinFromProviderSlug, titleCaseCity } from '~/utils/directory'
import { authRedirectUrl } from '~/utils/site'

const CORRECTION_TYPES = [
  {
    value: 'moved',
    label: 'Facility moved',
    fieldName: 'display_address',
    question: 'What changed?',
    placeholder: 'Provide the current address and explain how it relates to this RIN facility.',
    helper:
      'A newer business address does not automatically move a facility-specific RIN. Include evidence connecting the RIN facility to the new location.',
  },
  {
    value: 'closed',
    label: 'Facility or business closed',
    fieldName: 'business_status',
    question: 'What should we know?',
    placeholder: 'Tell us why you believe this facility or business is no longer operating.',
    helper:
      'If possible, include a current first-party, government, or other authoritative source showing the closure.',
  },
  {
    value: 'wrong_phone',
    label: 'Wrong phone number',
    fieldName: 'phone',
    question: 'What is the correct phone number?',
    placeholder: 'Enter the phone number you believe belongs to this exact facility.',
    helper:
      'A company-wide or nearby-location phone may not belong to this RIN facility, so facility-specific evidence is most useful.',
  },
  {
    value: 'wrong_service',
    label: 'Wrong service information',
    fieldName: 'services',
    question: 'What service information is wrong?',
    placeholder: 'Tell us which service should be added, removed, or changed.',
    helper:
      'Service categories require current customer-facing evidence or reviewed provider confirmation.',
  },
  {
    value: 'duplicate',
    label: 'Duplicate listing',
    fieldName: 'duplicate',
    question: 'Which listing appears to be the duplicate?',
    placeholder: 'Provide the other provider name, RIN, or listing URL and explain why you believe they represent the same facility.',
    helper:
      'Multiple RINs can legitimately exist at one location, so duplicate reports are reviewed before any listing is removed.',
  },
  {
    value: 'other',
    label: 'Other issue',
    fieldName: 'other',
    question: 'What should we correct?',
    placeholder: 'Describe the issue and the corrected information.',
    helper:
      'Include enough detail for us to identify the affected listing field and verify the change.',
  },
] as const

type CorrectionType = (typeof CORRECTION_TYPES)[number]['value']

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
const correctionType = ref<CorrectionType | ''>('')
const proposedValue = ref('')
const notes = ref('')
const submitting = ref(false)
const submitted = ref(false)
const submitError = ref('')
let unsubscribe: (() => void) | undefined

const selectedCorrection = computed(
  () => CORRECTION_TYPES.find((option) => option.value === correctionType.value) ?? null,
)

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
      emailRedirectTo: authRedirectUrl(correctionPath),
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

  if (!selectedCorrection.value || !correctionType.value) {
    submitError.value = 'Select the type of correction.'
    return
  }

  if (!proposedValue.value.trim()) {
    submitError.value = 'Describe the correction you are requesting.'
    return
  }

  const correction = selectedCorrection.value

  submitting.value = true
  const result = await $supabase
    .from('corrections')
    .insert({
      facility_id: facility.id,
      user_id: user.value.id,
      correction_type: correctionType.value,
      field_name: correction.fieldName,
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

  $posthog.capture('correction_submitted', {
    rin: facility.rin,
    state: facility.state,
    correction_type: correctionType.value,
    field_name: correction.fieldName,
  })

  correctionType.value = ''
  proposedValue.value = ''
  notes.value = ''
  submitted.value = true
}

onMounted(async () => {
  $posthog.capture('correction_started', {
    rin: facility.rin,
    state: facility.state,
  })

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
  title: 'Report or Correct ' + name + ' — CylinderAtlas',
  description: 'Submit a correction request for this CylinderAtlas provider listing.',
  robots: 'noindex,nofollow',
})
</script>

<template>
  <main class="mx-auto max-w-3xl px-6 py-12">
    <NuxtLink :to="profilePath" class="text-sm font-semibold text-brand-800 hover:underline">
      ← Back to provider
    </NuxtLink>

    <div class="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <p class="text-sm font-semibold uppercase tracking-[0.14em] text-brand-700">Listing correction</p>
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

      <form v-else class="mt-8 space-y-5" @submit.prevent="submitCorrection">
        <p class="text-sm text-slate-500">Signed in as {{ user.email || 'authenticated user' }}</p>

        <div>
          <label for="correction-type" class="mb-1.5 block text-sm font-semibold text-slate-800">
            What's wrong with this listing?
          </label>
          <select
            id="correction-type"
            v-model="correctionType"
            required
            class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none ring-brand-600 focus:ring-2"
          >
            <option value="" disabled>Select an issue</option>
            <option
              v-for="option in CORRECTION_TYPES"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </div>

        <div v-if="selectedCorrection">
          <label for="proposed-value" class="mb-1.5 block text-sm font-semibold text-slate-800">
            {{ selectedCorrection.question }}
          </label>
          <textarea
            id="proposed-value"
            v-model="proposedValue"
            rows="4"
            :placeholder="selectedCorrection.placeholder"
            class="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none ring-brand-600 focus:ring-2"
          />
          <p class="mt-2 text-xs leading-5 text-slate-500">
            {{ selectedCorrection.helper }}
          </p>
        </div>

        <div v-if="selectedCorrection">
          <label for="notes" class="mb-1.5 block text-sm font-semibold text-slate-800">
            Evidence or context <span class="font-normal text-slate-500">(optional)</span>
          </label>
          <textarea
            id="notes"
            v-model="notes"
            rows="3"
            placeholder="Paste a source URL or add context that will help us verify the correction."
            class="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none ring-brand-600 focus:ring-2"
          />
        </div>

        <button
          type="submit"
          :disabled="submitting || !selectedCorrection"
          class="rounded-lg bg-navy px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-950 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {{ submitting ? 'Submitting…' : 'Submit correction' }}
        </button>

        <p v-if="submitted" class="text-sm font-medium text-brand-800">
          Correction submitted for review. The public listing has not been changed automatically.
        </p>
        <p v-if="submitError" class="text-sm text-red-700">{{ submitError }}</p>
      </form>
    </div>
  </main>
</template>
