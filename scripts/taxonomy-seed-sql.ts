/**
 * Prints the taxonomy seed rows of migration 0083 from src/features/taxonomy/maritime-taxonomy.ts.
 * Run: npx tsx scripts/taxonomy-seed-sql.ts. maritime-taxonomy-seed.test.ts checks the migration matches.
 */
import {
  CERTIFICATE_TYPE_SEEDS,
  MARITIME_RANKS,
  VESSEL_TYPE_SEEDS,
} from '../src/features/taxonomy/maritime-taxonomy'

const text = (value: string | null | undefined) => (value == null ? 'null' : `'${value.replace(/'/g, "''")}'`)
const array = (values: readonly string[]) => `array[${values.map(text).join(', ')}]::text[]`

const ranks = MARITIME_RANKS.map((rank, index) =>
  `  (${text(rank.code)}, ${text(rank.name)}, ${text(rank.departmentKey)}, ${text(rank.department)}, ${text(rank.ladder)}, ${rank.ladderLevel}, ${array(rank.synonyms)}, ${text(rank.sameAs)}, ${index + 1})`)
const vessels = VESSEL_TYPE_SEEDS.map((vessel, index) =>
  `  (${text(vessel.code)}, ${text(vessel.name)}, ${text(vessel.group)}, ${array(vessel.synonyms)}, ${index + 1})`)
const certificates = CERTIFICATE_TYPE_SEEDS.map((certificate, index) =>
  `  (${text(certificate.code)}, ${text(certificate.name)}, ${text(certificate.category)}, ${array(certificate.synonyms)}, ${text(certificate.cocRankCode ?? null)}, ${index + 1})`)

console.log(`insert into public.maritime_ranks (code, name, department_key, department, ladder, ladder_level, synonyms, same_as, sort_order) values
${ranks.join(',\n')}
on conflict (code) do nothing;
-- statement-breakpoint
insert into public.vessel_types (code, name, vessel_group, synonyms, sort_order) values
${vessels.join(',\n')}
on conflict (code) do nothing;
-- statement-breakpoint
insert into public.certificate_types (code, name, category, synonyms, coc_rank_code, sort_order) values
${certificates.join(',\n')}
on conflict (code) do nothing;`)
