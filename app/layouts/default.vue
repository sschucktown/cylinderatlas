<template>
  <div class="min-h-screen bg-slate-50 text-slate-950">
    <header class="border-b border-slate-200 bg-white/95">
      <div class="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-4">
        <NuxtLink to="/" class="flex items-center gap-3 font-semibold tracking-tight text-slate-950">
          <span class="grid h-9 w-9 place-items-center rounded-xl bg-slate-950 text-sm font-bold text-white">CA</span>
          <span>Cylinder Atlas</span>
        </NuxtLink>

        <nav class="flex items-center gap-5 text-sm font-medium text-slate-600">
          <NuxtLink to="/search" class="hover:text-slate-950">Find a provider</NuxtLink>
        </nav>
      </div>
    </header>

    <slot />

    <footer class="mt-20 border-t border-slate-200 bg-white">
      <div class="mx-auto max-w-7xl px-6 py-10 text-sm leading-6 text-slate-500">
        <p class="font-medium text-slate-700">Cylinder Atlas</p>
        <p class="mt-2 max-w-3xl">
          An independent directory built from PHMSA requalifier records plus current business and service evidence.
          Cylinder Atlas is not PHMSA or the U.S. Department of Transportation.
        </p>
      </div>
    </footer>
  </div>
</template>
