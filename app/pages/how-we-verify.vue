<script setup lang="ts">
import { canonicalUrl } from '~/utils/site'

const path = '/how-we-verify'

useSeoMeta({
  title: 'How CylinderAtlas Verifies Providers',
  description:
    'Learn how CylinderAtlas uses PHMSA RIN data, current business identity, customer-access evidence, service evidence, and manual review before publishing a cylinder requalification provider.',
})

useHead({
  link: [{ rel: 'canonical', href: canonicalUrl(path) }],
  script: [
    {
      type: 'application/ld+json',
      textContent: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'AboutPage',
        name: 'How CylinderAtlas verifies providers',
        url: canonicalUrl(path),
        description:
          'CylinderAtlas publication methodology for PHMSA-listed cylinder requalification providers.',
      }),
    },
  ],
})
</script>

<template>
  <main class="mx-auto max-w-5xl px-6 py-12">
    <div class="max-w-3xl">
      <p class="text-sm font-semibold uppercase tracking-[0.14em] text-brand-700">Trust and provenance</p>
      <h1 class="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
        How CylinderAtlas verifies providers
      </h1>
      <p class="mt-5 text-lg leading-8 text-slate-600">
        CylinderAtlas starts with federal cylinder requalifier data, then checks whether the listed facility can be tied to a current business that serves outside customers and has evidence for the services shown on its profile.
      </p>
      <p class="mt-4 text-sm leading-6 text-slate-500">
        A PHMSA record is the regulatory starting point. It is not enough by itself for a public CylinderAtlas listing.
      </p>
    </div>

    <section class="mt-10 grid gap-4 md:grid-cols-2">
      <article class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">1. Regulatory foundation</p>
        <h2 class="mt-2 text-lg font-semibold text-slate-950">Start with the PHMSA RIN facility</h2>
        <p class="mt-3 text-sm leading-6 text-slate-600">
          CylinderAtlas begins with PHMSA cylinder requalifier records that support hydrostatic requalification authorization. The RIN shown on a profile is tied to a specific facility, not just a company name.
        </p>
      </article>

      <article class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">2. Current identity</p>
        <h2 class="mt-2 text-lg font-semibold text-slate-950">Reconcile the business and location</h2>
        <p class="mt-3 text-sm leading-6 text-slate-600">
          We look for current evidence that the operating business matches the RIN facility. A newer company address is not automatically substituted for the PHMSA address.
        </p>
      </article>

      <article class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">3. Customer access</p>
        <h2 class="mt-2 text-lg font-semibold text-slate-950">Confirm outside customers are served</h2>
        <p class="mt-3 text-sm leading-6 text-slate-600">
          A facility must have evidence that it serves outside customers. Internal-only, non-retail, or otherwise inaccessible facilities are not published as customer-facing providers.
        </p>
      </article>

      <article class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">4. Service evidence</p>
        <h2 class="mt-2 text-lg font-semibold text-slate-950">Publish only supported service categories</h2>
        <p class="mt-3 text-sm leading-6 text-slate-600">
          Service labels require current evidence from an accepted source, such as a first-party provider page, relevant regulatory evidence, or reviewed provider confirmation. We do not infer customer use cases from PHMSA cylinder specifications.
        </p>
      </article>

      <article class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:col-span-2">
        <p class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">5. Publication gate</p>
        <h2 class="mt-2 text-lg font-semibold text-slate-950">Ambiguity stays out of the directory</h2>
        <p class="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          A listing is published only after identity and service evidence clear CylinderAtlas's internal confidence gate and there is no unresolved identity or location conflict. Moves, acquisitions, renames, suite conflicts, multiple-RIN situations, and materially different locations stay under review until the relationship is supported by adequate evidence.
        </p>
      </article>
    </section>

    <section class="mt-10 rounded-2xl border border-brand-200 bg-brand-50 p-6 sm:p-8">
      <p class="text-sm font-semibold text-brand-950">What CylinderAtlas does not assume</p>
      <div class="mt-5 grid gap-3 text-sm leading-6 text-brand-900 sm:grid-cols-2">
        <p class="rounded-xl bg-white/70 p-4">A business name containing a service keyword does not prove that service.</p>
        <p class="rounded-xl bg-white/70 p-4">A PHMSA record alone does not prove the facility currently serves the public.</p>
        <p class="rounded-xl bg-white/70 p-4">A newer company address does not automatically move a facility-specific RIN.</p>
        <p class="rounded-xl bg-white/70 p-4">A stale directory listing is not sufficient current identity or service evidence.</p>
      </div>
    </section>

    <section class="mt-10 grid gap-6 lg:grid-cols-[1fr_320px]">
      <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 class="text-xl font-semibold text-slate-950">What “source verified” means</h2>
        <p class="mt-3 text-sm leading-6 text-slate-600">
          “Source verified” means CylinderAtlas reviewed evidence supporting the public fact being shown, such as the current facility identity, provider website, contact information, or a service category. Provider profiles show public source links where available and a last-checked date.
        </p>
        <p class="mt-4 text-sm leading-6 text-slate-600">
          Evidence can become stale. When we find a material conflict, the listing or affected field can be returned to review rather than silently guessing.
        </p>

        <h3 class="mt-7 text-base font-semibold text-slate-950">Claims and corrections</h3>
        <p class="mt-2 text-sm leading-6 text-slate-600">
          Providers can claim a published listing, and anyone can report a correction. Claims and corrections are reviewed before they change public listing data.
        </p>
      </div>

      <aside class="rounded-2xl border border-slate-200 bg-slate-950 p-6 text-white">
        <p class="text-sm font-semibold">Important limitation</p>
        <p class="mt-3 text-sm leading-6 text-slate-300">
          CylinderAtlas is an independent directory. It does not certify or approve requalification facilities, determine whether a cylinder passes or fails inspection, replace official test records, or make regulated compliance decisions.
        </p>
        <p class="mt-4 text-sm leading-6 text-slate-300">
          Confirm cylinder-specific capabilities, pricing, hours, turnaround, and shipping or drop-off requirements directly with the provider.
        </p>
      </aside>
    </section>

    <section class="mt-10 border-t border-slate-200 pt-8">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 class="text-lg font-semibold text-slate-950">See the methodology in practice</h2>
          <p class="mt-1 text-sm leading-6 text-slate-600">
            Public provider profiles include the PHMSA RIN, evidence-backed services, verification date, and source links when available.
          </p>
        </div>
        <NuxtLink
          to="/search"
          class="shrink-0 rounded-xl bg-navy px-5 py-3 text-center text-sm font-semibold text-white hover:bg-brand-950"
        >
          Find a provider
        </NuxtLink>
      </div>
    </section>
  </main>
</template>
