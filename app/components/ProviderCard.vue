<script setup lang="ts">
import { displayName, providerPath, serviceLabel, statePath, titleCaseCity } from '~/utils/directory'

const props = withDefaults(
  defineProps<{
    facility: {
      id: string
      rin: string
      display_name: string | null
      phmsa_name: string
      city: string
      state: string
    }
    serviceKeys?: string[]
  }>(),
  {
    serviceKeys: () => [],
  },
)

const name = computed(() => displayName(props.facility))
</script>

<template>
  <article class="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md">
    <div class="flex items-start justify-between gap-4">
      <div>
        <NuxtLink :to="providerPath(facility)" class="font-semibold text-slate-950 group-hover:text-teal-800">
          {{ name }}
        </NuxtLink>
        <p class="mt-1 text-sm text-slate-600">
          {{ titleCaseCity(facility.city) }},
          <NuxtLink :to="statePath(facility.state)" class="hover:text-teal-800 hover:underline">
            {{ facility.state }}
          </NuxtLink>
        </p>
      </div>
      <span class="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
        RIN {{ facility.rin }}
      </span>
    </div>

    <div v-if="serviceKeys.length" class="mt-4 flex flex-wrap gap-2">
      <span
        v-for="service in serviceKeys"
        :key="service"
        class="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-800"
      >
        {{ serviceLabel(service) }}
      </span>
    </div>

    <NuxtLink
      :to="providerPath(facility)"
      class="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-teal-800 hover:text-teal-950"
    >
      View provider
      <span aria-hidden="true">→</span>
    </NuxtLink>
  </article>
</template>
