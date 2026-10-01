<template>
  <div class="min-h-screen bg-slate-50 text-slate-950">
    <header class="border-b border-slate-200 bg-white/95">
      <div class="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-3.5">
        <NuxtLink
          to="/"
          class="flex items-center gap-2.5"
          aria-label="CylinderAtlas home"
        >
          <img
            src="/cylinder-atlas-mark.svg"
            alt=""
            class="h-10 w-10 shrink-0"
            width="40"
            height="40"
          >
          <span class="text-xl font-extrabold tracking-[-0.035em]" aria-hidden="true">
            <span class="text-navy">Cylinder</span><span class="text-brand-600">Atlas</span>
          </span>
        </NuxtLink>

        <nav class="flex items-center gap-5 text-sm font-medium text-slate-600">
          <NuxtLink to="/search" class="hover:text-navy">Find a provider</NuxtLink>
        </nav>
      </div>
    </header>

    <slot />

    <footer class="mt-20 border-t border-slate-200 bg-white">
      <div class="mx-auto max-w-7xl px-6 py-10 text-sm leading-6 text-slate-500">
        <NuxtLink
          to="/"
          class="inline-flex items-center gap-2"
          aria-label="CylinderAtlas home"
        >
          <img
            src="/cylinder-atlas-mark.svg"
            alt=""
            class="h-7 w-7"
            width="28"
            height="28"
          >
          <span class="text-base font-extrabold tracking-[-0.03em]" aria-hidden="true">
            <span class="text-navy">Cylinder</span><span class="text-brand-600">Atlas</span>
          </span>
        </NuxtLink>
        <p class="mt-3 max-w-3xl">
          An independent directory built from PHMSA requalifier records plus current business and service evidence.
          CylinderAtlas is not PHMSA or the U.S. Department of Transportation.
        </p>
        <nav class="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium" aria-label="Directory information">
          <NuxtLink to="/how-we-verify" class="text-brand-800 hover:underline">
            How we verify providers
          </NuxtLink>
          <NuxtLink to="/search" class="text-brand-800 hover:underline">
            Find a provider
          </NuxtLink>
        </nav>
      </div>
    </footer>
  </div>
</template>
