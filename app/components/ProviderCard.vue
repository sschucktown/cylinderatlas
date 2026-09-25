<script setup lang="ts">
import { displayName, providerPath, serviceLabel, titleCaseCity } from '~/utils/directory'

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
  <NuxtLink
    :to="providerPath(facility)"
    :aria-label="'View ' + name"
    class="group block rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
  >
    <article class="p-5">
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <h3 class="font-semibold leading-5 text-slate-950 group-hover:text-teal-800">
            {{ name }}
          </h3>
          <p class="mt-1.5 text-sm text-slate-500">
            {{ titleCaseCity(facility.city) }}, {{ facility.state }}
          </p>
        </div>
        <span class="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-500">
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

      <span class="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-teal-800 group-hover:text-teal-950">
        View provider
        <span aria-hidden="true">→</span>
      </span>
    </article>
  </NuxtLink>
</template>
