/**
 * P6: writes src/features/roles/other-rank-lookup.json, the rank lookup the runner's old-"Other" preview
 * (scripts/aws/p6-other-ranks-preview.py) uses, from the app's own lookup. Run: npx tsx scripts/generate-other-rank-lookup.ts
 * other-rank-lookup.test.ts fails when the file is out of date.
 */
import { writeFileSync } from 'node:fs'
import { otherRankLookupFile } from '../src/features/roles/other-rank-lookup'

writeFileSync('src/features/roles/other-rank-lookup.json', `${JSON.stringify(otherRankLookupFile(), null, 1)}\n`)
