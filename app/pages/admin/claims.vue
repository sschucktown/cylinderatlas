<script setup lang="ts">
import type { Database } from '~~/types/database'
import { providerPath, titleCaseCity } from '~/utils/directory'
import { authRedirectUrl } from '~/utils/site'

type AdminClaim = Database['public']['Functions']['admin_claims_queue']['Returns'][number]
type ReviewStatus = 'verified' | 'rejected'

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
const claims = ref<AdminClaim[]>([])
const actionClaimId = ref<string | null>(null)
const actionError = ref('')
let unsubscribe: (() => void) | undefined

const pendingClaims = computed(() => claims.value.filter((claim) => claim.claim_status === 'pending'))
const reviewedClaims = computed(() => claims.value.filter((claim) => claim.claim_status !== 'pending'))

function claimName(claim: AdminClaim) {
  return claim.display_name || claim.phmsa_name
}

function claimProviderPath(claim: AdminClaim) {
  return providerPath({
    display_name: claim.display_name,
    phmsa_name: claim.phmsa_name,
    rin: claim.rin,
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

async function loadQueue() {
  queueLoading.value = true
  queueError.value = ''

  const result = await $supabase.rpc('admin_claims_queue')

  queueLoading.value = false

  if (result.error) {
    claims.value = []
    queueError.value = result.error.message
    return
  }

  claims.value = result.data ?? []
}

async function refreshAccess() {
  authLoading.value = true
  authError.value = ''
  isAdmin.value = false
  claims.value = []

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

  if (isAdmin.value) {
    await loadQueue()
  }

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
      emailRedirectTo: authRedirectUrl('/admin/claims'),
    },
  })
  authSending.value = false

  if (result.error) {
    authError.value = result.error.message
    return
  }

  authSent.value = true
}

async function reviewClaim(claim: AdminClaim, status: ReviewStatus) {
  actionError.value = ''

  if (status === 'rejected' && !window.confirm('Reject this provider claim?')) {
    return
  }

  actionClaimId.value = claim.claim_id

  const result = await $supabase.rpc('admin_review_claim', {
    p_claim_id: claim.claim_id,
    p_status: status,
  })

  actionClaimId.value = null

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
  title: 'Claim Review — Cylinder Atlas Admin',
  description: 'Internal Cylinder Atlas provider claim review.',
  robots: 'noindex,nofollow',
})
</script>

<template>
  <main class="mx-auto max-w-6xl px-6 py-10">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p class="text-sm font-semibold uppercase tracking-[0.14em] text-teal-700">Cylinder Atlas Admin</p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Provider claim review</h1>
        <p class="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          Verify the claimant-to-facility relationship before giving the account provider ownership.
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
      Checking admin access…
    </div>

    <section v-else-if="!user" class="mt-8 max-w-xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h2 class="text-xl font-semibold text-slate-950">Admin sign in</h2>
      <p class="mt-2 text-sm leading-6 text-slate-600">
        Use an email address already authorized for Cylinder Atlas administration.
      </p>

      <form class="mt-5 flex flex-col gap-3 sm:flex-row" @submit.prevent="sendSignInLink">
        <label for="admin-email" class="sr-only">Admin email</label>
        <input
          id="admin-email"
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

      <p v-if="authSent" class="mt-3 text-sm font-medium text-teal-800">Check your email for the sign-in link.</p>
      <p v-if="authError" class="mt-3 text-sm text-red-700">{{ authError }}</p>
    </section>

    <section v-else-if="!isAdmin" class="mt-8 rounded-3xl border border-red-200 bg-red-50 p-6">
      <h2 class="font-semibold text-red-950">Not authorized</h2>
      <p class="mt-2 text-sm leading-6 text-red-900">
        {{ user.email || 'This account' }} is signed in, but is not a Cylinder Atlas administrator.
      </p>
    </section>

    <template v-else>
      <div class="mt-8 grid gap-4 sm:grid-cols-3">
        <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p class="text-sm font-medium text-slate-500">Pending</p>
          <p class="mt-1 text-3xl font-semibold text-slate-950">{{ pendingClaims.length }}</p>
        </div>
        <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p class="text-sm font-medium text-slate-500">Reviewed</p>
          <p class="mt-1 text-3xl font-semibold text-slate-950">{{ reviewedClaims.length }}</p>
        </div>
        <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p class="text-sm font-medium text-slate-500">Signed in</p>
          <p class="mt-2 truncate text-sm font-semibold text-slate-900">{{ user.email }}</p>
        </div>
      </div>

      <p v-if="queueError" class="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        {{ queueError }}
      </p>
      <p v-if="actionError" class="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        {{ actionError }}
      </p>

      <section class="mt-8">
        <div class="flex items-center justify-between gap-4">
          <div>
            <h2 class="text-xl font-semibold text-slate-950">Pending claims</h2>
            <p class="mt-1 text-sm text-slate-500">Approve only when the account-to-facility relationship is adequately supported.</p>
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

        <div v-if="pendingClaims.length" class="mt-5 space-y-4">
          <article
            v-for="claim in pendingClaims"
            :key="claim.claim_id"
            class="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
          >
            <div class="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">Pending</span>
                  <span class="text-sm font-medium text-slate-500">RIN {{ claim.rin }}</span>
                </div>

                <h3 class="mt-3 text-xl font-semibold text-slate-950">{{ claimName(claim) }}</h3>
                <p class="mt-1 text-sm text-slate-600">{{ titleCaseCity(claim.city) }}, {{ claim.state }}</p>

                <dl class="mt-5 grid gap-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt class="font-medium text-slate-500">Claimant</dt>
                    <dd class="mt-1 break-all font-semibold text-slate-900">{{ claim.claimant_email }}</dd>
                  </div>
                  <div>
                    <dt class="font-medium text-slate-500">Submitted</dt>
                    <dd class="mt-1 text-slate-900">{{ formatDate(claim.claim_created_at) }}</dd>
                  </div>
                  <div>
                    <dt class="font-medium text-slate-500">Verification method</dt>
                    <dd class="mt-1 text-slate-900">{{ claim.verification_method || '—' }}</dd>
                  </div>
                  <div>
                    <dt class="font-medium text-slate-500">PHMSA facility</dt>
                    <dd class="mt-1 text-slate-900">{{ claim.phmsa_address }}</dd>
                  </div>
                </dl>

                <NuxtLink
                  :to="claimProviderPath(claim)"
                  class="mt-5 inline-block text-sm font-semibold text-teal-800 hover:underline"
                >
                  View public provider profile →
                </NuxtLink>
              </div>

              <div class="flex shrink-0 gap-3 lg:flex-col">
                <button
                  type="button"
                  :disabled="actionClaimId === claim.claim_id"
                  class="rounded-lg bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                  @click="reviewClaim(claim, 'verified')"
                >
                  {{ actionClaimId === claim.claim_id ? 'Saving…' : 'Approve' }}
                </button>
                <button
                  type="button"
                  :disabled="actionClaimId === claim.claim_id"
                  class="rounded-lg border border-red-300 bg-white px-5 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
                  @click="reviewClaim(claim, 'rejected')"
                >
                  Reject
                </button>
              </div>
            </div>
          </article>
        </div>

        <div v-else class="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No pending provider claims.
        </div>
      </section>

      <section v-if="reviewedClaims.length" class="mt-10">
        <h2 class="text-xl font-semibold text-slate-950">Recently reviewed</h2>
        <div class="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div
            v-for="claim in reviewedClaims"
            :key="claim.claim_id"
            class="flex flex-col gap-2 border-b border-slate-100 px-5 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p class="font-semibold text-slate-950">{{ claimName(claim) }}</p>
              <p class="mt-1 text-sm text-slate-500">
                RIN {{ claim.rin }} · {{ claim.claimant_email }} · reviewed {{ formatDate(claim.reviewed_at) }}
              </p>
            </div>
            <span
              class="self-start rounded-full px-2.5 py-1 text-xs font-semibold capitalize sm:self-auto"
              :class="claim.claim_status === 'verified' ? 'bg-teal-100 text-teal-900' : 'bg-red-100 text-red-900'"
            >
              {{ claim.claim_status }}
            </span>
          </div>
        </div>
      </section>
    </template>
  </main>
</template>
