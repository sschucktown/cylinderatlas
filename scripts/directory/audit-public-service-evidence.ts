import { createAdminClient } from '../enrichment/admin-client'

const supabase = createAdminClient()
const apply = process.argv.includes('--apply')
const reason =
  'Legacy publish lacks a service source accepted by the current public publication standard.'

const facilitiesResult = await supabase
  .from('facilities')
  .select('id, rin, display_name, enrichment_run_id, publish_status, pipeline_status')
  .eq('publish_status', 'publish')
  .order('rin')
  .limit(5000)

if (facilitiesResult.error) throw facilitiesResult.error

const facilities = facilitiesResult.data ?? []
const ids = facilities.map((facility) => facility.id)

const [servicesResult, sourcesResult] = await Promise.all([
  supabase
    .from('facility_services')
    .select('id, facility_id, service_key, status')
    .in('facility_id', ids)
    .in('status', ['verified', 'provider_confirmed'])
    .limit(10000),
  supabase
    .from('facility_public_sources')
    .select('facility_id, purpose')
    .in('facility_id', ids)
    .eq('purpose', 'service')
    .limit(5000),
])

if (servicesResult.error) throw servicesResult.error
if (sourcesResult.error) throw sourcesResult.error

const facilitiesWithVerifiedServices = new Set(
  (servicesResult.data ?? []).map((row) => row.facility_id),
)
const facilitiesWithPublicServiceSource = new Set(
  (sourcesResult.data ?? []).map((row) => row.facility_id),
)

const flagged = facilities.filter(
  (facility) =>
    facilitiesWithVerifiedServices.has(facility.id) &&
    !facilitiesWithPublicServiceSource.has(facility.id),
)

const result = {
  apply,
  publishedBefore: facilities.length,
  flagged: flagged.length,
  rins: flagged.map((facility) => facility.rin),
}

if (!apply) {
  console.log(JSON.stringify(result, null, 2))
} else {
  for (const facility of flagged) {
    const facilityUpdate = await supabase
      .from('facilities')
      .update({
        publish_status: 'review',
        pipeline_status: 'manual_review',
        manual_review_reason: reason,
      })
      .eq('id', facility.id)

    if (facilityUpdate.error) throw facilityUpdate.error

    if (facility.enrichment_run_id) {
      const resultUpdate = await supabase
        .from('facility_enrichment_results')
        .update({
          decision: 'review',
          manual_review_reason: reason,
        })
        .eq('facility_id', facility.id)
        .eq('run_id', facility.enrichment_run_id)

      if (resultUpdate.error) throw resultUpdate.error
    }

    const serviceUpdate = await supabase
      .from('facility_services')
      .update({ status: 'inferred' })
      .eq('facility_id', facility.id)
      .eq('status', 'verified')

    if (serviceUpdate.error) throw serviceUpdate.error
  }

  console.log(JSON.stringify(result, null, 2))
}
