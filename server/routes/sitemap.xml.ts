import { createClient } from '@supabase/supabase-js'
import { defineEventHandler, setHeader } from 'h3'
import type { Database } from '../../types/database'
import { providerPath, statePath } from '../../app/utils/directory'
import { SITE_URL } from '../../app/utils/site'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../../app/utils/supabase-config'

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function absoluteUrl(path: string) {
  return new URL(path, SITE_URL).toString()
}

export default defineEventHandler(async (event) => {
  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })

  const facilitiesResult = await supabase
    .from('facilities')
    .select('id, rin, display_name, phmsa_name, state, verified_at')
    .eq('publish_status', 'publish')
    .order('state')
    .limit(5000)

  if (facilitiesResult.error) throw facilitiesResult.error

  const servicesResult = await supabase
    .from('facility_services')
    .select('facility_id, service_key')
    .in('status', ['verified', 'provider_confirmed'])
    .limit(10000)

  if (servicesResult.error) throw servicesResult.error

  const facilities = facilitiesResult.data ?? []
  const publishedIds = new Set(facilities.map((facility) => facility.id))
  const stateFacilityIds = new Map<string, Set<string>>()
  const serviceFacilityIds = new Map<string, Set<string>>()

  for (const facility of facilities) {
    const ids = stateFacilityIds.get(facility.state) ?? new Set<string>()
    ids.add(facility.id)
    stateFacilityIds.set(facility.state, ids)
  }

  for (const service of servicesResult.data ?? []) {
    if (!publishedIds.has(service.facility_id)) continue
    const ids = serviceFacilityIds.get(service.service_key) ?? new Set<string>()
    ids.add(service.facility_id)
    serviceFacilityIds.set(service.service_key, ids)
  }

  const urls: Array<{ loc: string; lastmod?: string }> = [
    { loc: absoluteUrl('/') },
  ]

  for (const facility of facilities) {
    urls.push({
      loc: absoluteUrl(providerPath(facility)),
      lastmod: facility.verified_at || undefined,
    })
  }

  for (const [state, ids] of stateFacilityIds) {
    if (ids.size >= 3) {
      urls.push({ loc: absoluteUrl(statePath(state)) })
    }
  }

  for (const [serviceKey, ids] of serviceFacilityIds) {
    if (ids.size >= 3) {
      urls.push({ loc: absoluteUrl('/services/' + serviceKey) })
    }
  }

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map(({ loc, lastmod }) => {
      const parts = ['<url>', '<loc>' + escapeXml(loc) + '</loc>']
      if (lastmod) parts.push('<lastmod>' + escapeXml(new Date(lastmod).toISOString()) + '</lastmod>')
      parts.push('</url>')
      return parts.join('')
    }),
    '</urlset>',
  ].join('')

  setHeader(event, 'content-type', 'application/xml; charset=utf-8')
  setHeader(event, 'cache-control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400')

  return body
})
