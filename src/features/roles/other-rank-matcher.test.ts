import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { matchOtherRankText } from './other-rank-matcher'
import { otherRankLookupFile } from './other-rank-lookup'

/** P6: which old typed "Other" ranks clearly name existing ranks; the runner's Python preview agrees exactly. */
const SAMPLES: Array<[string, string[] | null]> = [
  ['Master/ Chief officer', ['master', 'chief_officer']],
  ['Master / Chief Officer', ['master', 'chief_officer']],
  ['C/O', ['chief_officer']],
  ['Ch. Off.', ['chief_officer']],
  ['Capt.', ['master']],
  ['Captain', ['master']],
  ['2/E', ['second_engineer']],
  ['2/E or 3/E', ['second_engineer', 'third_engineer']],
  ['C/O and 2/O', ['chief_officer', 'second_officer']],
  ['Chief Engineer, 2nd Engineer', ['chief_engineer', 'second_engineer']],
  ['ETO', ['eto']],
  ['AB & OS', ['able_seaman', 'ordinary_seaman']],
  ['Master Mariner', ['master']],
  ['Any marine background', null],
  ['Master / someone senior', null],
  ['Port captain or similar', null],
  ['', null],
]

describe('matchOtherRankText (P6)', () => {
  it.each(SAMPLES)('%s', (text, expected) => {
    expect(matchOtherRankText(text)).toEqual(expected)
  })

  it('the committed lookup file is the current lookup', () => {
    expect(JSON.parse(readFileSync('src/features/roles/other-rank-lookup.json', 'utf8'))).toEqual(otherRankLookupFile())
  })

  it('the Python preview the runner uses matches every sample exactly like the app', () => {
    const texts = SAMPLES.map(([text]) => text)
    const run = spawnSync('python3', ['-I', 'scripts/aws/p6-other-ranks-preview.py', '--match-json'], { input: JSON.stringify(texts), encoding: 'utf8' })
    expect(run.status, run.stderr).toBe(0)
    expect(JSON.parse(run.stdout)).toEqual(texts.map((text) => matchOtherRankText(text)))
  })

  it('the Python preview prints counts and clear patterns only, never an unclear text', () => {
    const input = ['3\tMaster/ Chief officer', '2\tC/O', '1\tSomeone from Acme Shipping', '4\tany marine background'].join('\n')
    const run = spawnSync('python3', ['-I', 'scripts/aws/p6-other-ranks-preview.py'], { input, encoding: 'utf8' })
    expect(run.status, run.stderr).toBe(0)
    expect(run.stdout).toContain('P6_OTHER_RANKS jobs_with_typed_other=10 distinct_texts=4 clear_jobs=5 clear_texts=2 unclear_jobs=5 unclear_texts=2')
    expect(run.stdout).toContain('P6_OTHER_RANK_CLEAR pattern="master chief officer" ranks=master,chief_officer jobs=3')
    expect(run.stdout).toContain('P6_OTHER_RANK_CLEAR pattern="c o" ranks=chief_officer jobs=2')
    expect(run.stdout).not.toMatch(/acme|marine background/i)
  })
})
