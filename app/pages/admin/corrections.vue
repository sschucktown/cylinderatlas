<script setup lang="ts">
import type { Database, Json } from '~~/types/database'
import { providerPath, titleCaseCity } from '~/utils/directory'
import { authRedirectUrl } from '~/utils/site'

type AdminCorrection = Database['public']['Functions']['admin_corrections_queue']['Returns'][number]
type ReviewStatus = 'accepted' | 'rejected'

const { $supabase } = useNuxtApp()

const email = ref('')
const user = ref<{ id: string; email?: string } | null>(null)
const authLoading = ref(true)
const authSending = ref(false)
const authSent = ref(false)
const authError = ref('')
const isAdmin = ref(false)
const queueLoading = ref(false)
const queueError = ref('')
const corrections = ref<AdminCorrection[]>([])
const actionCorrectionId = ref<string | null>(null)
const actionError = ref('')
const adminNotes = reactive<Record<string, string>>({})
let unsubscribe: (() => void) | undefined

const pendingCorrections = computed(() =>
  corrections.value.filter((correction) => correction.correction_status === 'pending'),
)
const reviewedCorrections = computed(() =>
  corrections.value.filter((correction) => correction.correction_status !== 'pending'),
)

function correctionName(correction: AdminCorrection) {
  return correction.display_name || correction.phmsa_name
}

function correctionProviderPath(correction: AdminCorrection) {
  return providerPath({
    display_name: correction.display_name,
    phmsa_name: correction.phmsa_name,
    rin: correction.rin,
  })
}

function formatDate(value?: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function proposedText(value: Json) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, Json | undefined>
    const proposed = typeof record.proposed === 'string' ? record.proposed : ''
    const notes = typeof record.notes === 'string' ? record.notes : ''
    return [proposed, notes ? 'Notes: ' + notes : ''].filter(Boolean).join('\n')
  }

  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

async function loadQueue() {
  queueLoading.value = true
  queueError.value = ''

  const result = await $supabase.rpc('admin_corrections_queue')

  queueLoading.value = false

  if (result.error) {
    corrections.value = []
    queueError.value = result.error.message
    return
  }

  corrections.value = result.data ?? []
}

async function refreshAccess() {
  authLoading.value = true
  authError.value = ''
  isAdmin.value = false
  corrections.value = []

  const userResult = await $supabase.auth.getUser()

  if (userResult.error || !userResult.data.user) {
    user.value = null
    authLoading.value = false
    return
  }

  user.value = {
    id: userResult.data.user.id,
    email: userResult.data.user.email,
  }

  const adminResult = await $supabase.rpc('is_admin')

  if (adminResult.error) {
    authError.value = adminResult.error.message
    authLoading.value = false
    return
  }

  isAdmin.value = adminResult.data === true
  if (isAdmin.value) await loadQueue()
  authLoading.value = false
}

async function sendSignInLink() {
  authError.value = ''
  authSent.value = false

  if (!email.value.trim()) {
    authError.value = 'Enter your admin email address.'
    return
  }

  authSending.value = true
  const result = await $supabase.auth.signInWithOtp({
    email: email.value.trim(),
    options: {
      shouldCreateUser: false,
      emailRedirectTo: authRedirectUrl('/admin/corrections'),
    },
  })
  authSending.value = false

  if (result.error) {
    authError.value = result.error.message
    return
  }

  authSent.value = true
}

async function reviewCorrection(correction: AdminCorrection, status: ReviewStatus) {
  actionError.value = ''

  const message = status === 'accepted'
    ? 'Accept this correction report? This marks it reviewed but does not automatically change public listing data.'
    : 'Reject this correction report?'

  if (!window.confirm(message)) return

  actionCorrectionId.value = correction.correction_id
  const result = await $supabase.rpc('admin_review_correction', {
    p_correction_id: correction.correction_id,
    p_status: status,
    p_admin_note: adminNotes[correction.correction_id] || undefined,
  })
  actionCorrectionId.value = null

  if (result.error) {
    actionError.value = result.error.message
    return
  }

  await loadQueue()
}

async function signOut() {
  await $supabase.auth.signOut()
  await refreshAccess()
}

onMounted(async () => {
  await refreshAccess()

  const { data } = $supabase.auth.onAuthStateChange(() => {
    window.setTimeout(() => {
      void refreshAccess()
    }, 0)
  })

  unsubscribe = () => data.subscription.unsubscribe()
})

onBeforeUnmount(() => {
  unsubscribe?.()
})

useSeoMeta({
  title: 'Correction Review — CylinderAtlas Admin',
  description: 'Internal CylinderAtlas listing correction review.',
  robots: 'noindex,nofollow',
})
</script>

<template>
  <main class="mx-auto max-w-6xl px-6 py-10">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p class="text-sm font-semibold uppercase tracking-[0.14em] text-brand-700">CylinderAtlas Admin</p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Listing correction review</h1>
        <p class="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          Review reports against facility-specific evidence. Accepting a report does not automatically mutate the public listing.
        </p>
        <div class="mt-4 flex gap-4 text-sm font-semibold">
          <NuxtLink to="/admin/claims" class="text-brand-800 hover:underline">Claims</NuxtLink>
          <span class="text-slate-950">Corrections</span>
        </div>
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
      Checking admin access…
    </div>

    <section v-else-if="!user" class="mt-8 max-w-xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h2 class="text-xl font-semibold text-slate-950">Admin sign in</h2>
      <p class="mt-2 text-sm leading-6 text-slate-600">Use an email address already authorized for CylinderAtlas administration.</p>

      <form class="mt-5 flex flex-col gap-3 sm:flex-row" @submit.prevent="sendSignInLink">
        <label for="admin-email" class="sr-only">Admin email</label>
        <input
          id="admin-email"
          v-model="email"
          type="email"
          autocomplete="email"
          placeholder="you@example.com"
          class="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2.5 outline-none ring-brand-600 focus:ring-2"
        >
        <button
          type="submit"
          :disabled="authSending"
          class="rounded-lg bg-navy px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-950 disabled:opacity-60"
        >
          {{ authSending ? 'Sending…' : 'Send sign-in link' }}
        </button>
      </form>

      <p v-if="authSent" class="mt-3 text-sm font-medium text-brand-800">Check your email for the sign-in link.</p>
      <p v-if="authError" class="mt-3 text-sm text-red-700">{{ authError }}</p>
    </section>

    <section v-else-if="!isAdmin" class="mt-8 rounded-3xl border border-red-200 bg-red-50 p-6">
      <h2 class="font-semibold text-red-950">Not authorized</h2>
      <p class="mt-2 text-sm leading-6 text-red-900">{{ user.email || 'This account' }} is not a CylinderAtlas administrator.</p>
    </section>

    <template v-else>
      <div class="mt-8 grid gap-4 sm:grid-cols-2">
        <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p class="text-sm font-medium text-slate-500">Pending</p>
          <p class="mt-1 text-3xl font-semibold text-slate-950">{{ pendingCorrections.length }}</p>
        </div>
        <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p class="text-sm font-medium text-slate-500">Reviewed</p>
          <p class="mt-1 text-3xl font-semibold text-slate-950">{{ reviewedCorrections.length }}</p>
        </div>
      </div>

      <p v-if="queueError" class="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{{ queueError }}</p>
      <p v-if="actionError" class="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{{ actionError }}</p>

      <section class="mt-8">
        <div class="flex items-center justify-between gap-4">
          <div>
            <h2 class="text-xl font-semibold text-slate-950">Pending corrections</h2>
            <p class="mt-1 text-sm text-slate-500">Verify the proposed change before accepting or rejecting it.</p>
          </div>
          <button
            type="button"
            :disabled="queueLoading"
            class="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            @click="loadQueue"
          >
            {{ queueLoading ? 'Refreshing…' : 'Refresh' }}
          </button>
        </div>

        <div v-if="pendingCorrections.length" class="mt-5 space-y-4">
          <article
            v-for="correction in pendingCorrections"
            :key="correction.correction_id"
            class="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
          >
            <div class="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">Pending</span>
                  <span class="text-sm font-medium text-slate-500">RIN {{ correction.rin }}</span>
                  <span class="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{{ correction.correction_type }}</span>
                </div>

                <h3 class="mt-3 text-xl font-semibold text-slate-950">{{ correctionName(correction) }}</h3>
                <p class="mt-1 text-sm text-slate-600">{{ titleCaseCity(correction.city) }}, {{ correction.state }}</p>

                <dl class="mt-5 grid gap-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt class="font-medium text-slate-500">Submitted by</dt>
                    <dd class="mt-1 break-all font-semibold text-slate-900">{{ correction.claimant_email || 'Authenticated user' }}</dd>
                  </div>
                  <div>
                    <dt class="font-medium text-slate-500">Submitted</dt>
                    <dd class="mt-1 text-slate-900">{{ formatDate(correction.correction_created_at) }}</dd>
                  </div>
                  <div>
                    <dt class="font-medium text-slate-500">Affected field</dt>
                    <dd class="mt-1 text-slate-900">{{ correction.field_name }}</dd>
                  </div>
                  <div>
                    <dt class="font-medium text-slate-500">PHMSA facility</dt>
                    <dd class="mt-1 text-slate-900">{{ correction.phmsa_address }}</dd>
                  </div>
                </dl>

                <div class="mt-5 rounded-xl bg-slate-50 p-4">
                  <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Proposed correction</p>
                  <p class="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">{{ proposedText(correction.proposed_value) }}</p>
                </div>

                <label class="mt-5 block text-sm font-semibold text-slate-800" :for="'note-' + correction.correction_id">
                  Admin note
                </label>
                <textarea
                  :id="'note-' + correction.correction_id"
                  v-model="adminNotes[correction.correction_id]"
                  rows="2"
                  placeholder="Optional internal review note"
                  class="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none ring-brand-600 focus:ring-2"
                />

                <NuxtLink
                  :to="correctionProviderPath(correction)"
                  class="mt-5 inline-block text-sm font-semibold text-brand-800 hover:underline"
                >
                  View public provider profile →
                </NuxtLink>
              </div>

              <div class="flex shrink-0 gap-3 lg:flex-col">
                <button
                  type="button"
                  :disabled="actionCorrectionId === correction.correction_id"
                  class="rounded-lg bg-navy px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-950 disabled:opacity-60"
                  @click="reviewCorrection(correction, 'accepted')"
                >
                  {{ actionCorrectionId === correction.correction_id ? 'Saving…' : 'Accept report' }}
                </button>
                <button
                  type="button"
                  :disabled="actionCorrectionId === correction.correction_id"
                  class="rounded-lg border border-red-300 bg-white px-5 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
                  @click="reviewCorrection(correction, 'rejected')"
                >
                  Reject
                </button>
              </div>
            </div>
          </article>
        </div>

        <div v-else class="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No pending corrections.
        </div>
      </section>

      <section v-if="reviewedCorrections.length" class="mt-10">
        <h2 class="text-xl font-semibold text-slate-950">Recently reviewed</h2>
        <div class="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div
            v-for="correction in reviewedCorrections"
            :key="correction.correction_id"
            class="flex flex-col gap-2 border-b border-slate-100 px-5 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p class="font-semibold text-slate-950">{{ correctionName(correction) }}</p>
              <p class="mt-1 text-sm text-slate-500">
                RIN {{ correction.rin }} · {{ correction.correction_type }} · reviewed {{ formatDate(correction.reviewed_at) }}
              </p>
            </div>
            <span
              class="self-start rounded-full px-2.5 py-1 text-xs font-semibold capitalize sm:self-auto"
              :class="correction.correction_status === 'accepted' ? 'bg-brand-100 text-brand-900' : 'bg-red-100 text-red-900'"
            >
              {{ correction.correction_status }}
            </span>
          </div>
        </div>
      </section>
    </template>
  </main>
</template>
