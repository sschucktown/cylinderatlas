import { writeFile } from 'node:fs/promises'
import { createAdminClient, readFlag, readPositiveIntFlag } from './admin-client'

const runName = readFlag('run') ?? 'national-enrichment-20260924-v1'
const hint = readFlag('hint')
const limit = readPositiveIntFlag('limit', 20)
const output = readFlag('output') ?? 'tmp/enrichment-next-batch.json'

const supabase = createAdminClient()

const { data: run, error: runError } = await supabase
  .from('enrichment_runs')
  .select('id, name, algorithm_version, status')
  .eq('name', runName)
  .maybeSingle()

if (runError) throw runError
if (!run) throw new Error('Enrichment run not found: ' + runName)
if (run.status !== 'running' && run.status !== 'queued') {
  throw new Error('Run ' + runName + ' is not resumable from status ' + run.status)
}

const { data: completed, error: completedError } = await supabase
  .from('facility_enrichment_results')
  .select('facility_id')
  .eq('run_id', run.id)
  .limit(10000)

if (completedError) throw completedError

const completedIds = new Set((completed ?? []).map((row) => row.facility_id))

let query = supabase
  .from('facilities')
  .select('id, rin, phmsa_name, phmsa_address, city, state, postal_code, candidate_type_hint')
  .eq('pipeline_status', 'queued_enrichment')
  .order('state')
  .order('city')
  .order('phmsa_name')
  .limit(5000)

if (hint) query = query.eq('candidate_type_hint', hint)

const { data: candidates, error: candidatesError } = await query
if (candidatesError) throw candidatesError

const rows = (candidates ?? [])
  .filter((candidate) => !completedIds.has(candidate.id))
  .slice(0, limit)

const payload = {
  runName: run.name,
  algorithmVersion: run.algorithm_version,
  hint: hint ?? null,
  generatedAt: new Date().toISOString(),
  count: rows.length,
  candidates: rows,
}

await writeFile(output, JSON.stringify(payload, null, 2) + '\n')

console.log(
  JSON.stringify(
    {
      run: run.name,
      hint: hint ?? null,
      count: rows.length,
      output,
      remainingKnown: Math.max((candidates ?? []).length - rows.length, 0),
    },
    null,
    2,
  ),
)
