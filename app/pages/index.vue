<script setup lang="ts">
const { $supabase } = useNuxtApp()

const { data: facilities } = await useAsyncData('published-facilities-preview', async () => {
  const { data, error } = await $supabase
    .from('facilities')
    .select('id, rin, display_name, phmsa_name, city, state')
    .eq('publish_status', 'publish')
    .order('state')
    .order('city')
    .limit(12)

  if (error) throw error
  return data
})
</script>

<template>
  <main class="mx-auto min-h-screen max-w-6xl px-6 py-16">
    <p class="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Cylinder Atlas</p>
    <h1 class="max-w-3xl text-4xl font-semibold tracking-tight text-slate-900 sm:text-6xl">
      Find cylinder requalification services with better evidence.
    </h1>
    <p class="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
      A national directory built from PHMSA requalifier data and current provider evidence. Uncertain facilities stay out of search until resolved.
    </p>

    <section class="mt-14">
      <h2 class="text-xl font-semibold text-slate-900">Directory preview</h2>
      <p v-if="!facilities?.length" class="mt-3 text-slate-600">
        Provider enrichment is in progress. Published facilities will appear here once they clear the evidence gate.
      </p>
      <ul v-else class="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <li v-for="facility in facilities" :key="facility.id" class="rounded-2xl border border-slate-200 bg-white p-5">
          <p class="font-semibold text-slate-900">{{ facility.display_name || facility.phmsa_name }}</p>
          <p class="mt-1 text-sm text-slate-500">{{ facility.city }}, {{ facility.state }} · RIN {{ facility.rin }}</p>
        </li>
      </ul>
    </section>
  </main>
</template>
