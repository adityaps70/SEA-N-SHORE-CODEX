import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { SEAFARER_MASTER, chooseSeafarerMaster } from './e2e-onboarding.mjs'

const helperPath = 'scripts/aws/e2e-onboarding.mjs'

// Every staging browser E2E that onboards a member through the shared helper, and the workflow that runs it.
const consumers = [
  {
    script: 'scripts/aws/organization-hiring-staging-e2e.mjs',
    workflow: '.github/workflows/aws-organization-hiring-e2e.yml',
  },
]

const RETIRED_ONBOARDING = [
  'Professional Build your individual maritime identity',
  'Organisation Represent a maritime organisation',
  'Search professional identities',
  'Search organisation identities',
  'Master — Sea-going · Deck',
  'Shipowner — Shipping & Ship Management',
  'data-primary-identity',
]

test('the Seafarer Master choices exist in the live onboarding form, persona list and role taxonomy', () => {
  const personas = readFileSync('src/features/profiles/persona.ts', 'utf8')
  const form = readFileSync('src/features/profiles/components/onboarding-form.tsx', 'utf8')
  const taxonomy = readFileSync('src/features/roles/taxonomy.ts', 'utf8')
  const roleFields = readFileSync('src/features/roles/components/profile-role-fields.tsx', 'utf8')

  assert.match(personas, new RegExp(`seafarer: '${SEAFARER_MASTER.persona}'`))
  assert.match(personas, new RegExp(`find_jobs: '${SEAFARER_MASTER.intent}'`))
  assert.match(form, /What are you here to do\?/)
  assert.match(form, new RegExp(`persona === 'seafarer'[\\s\\S]*?label="${SEAFARER_MASTER.organisationLabel}"`))
  assert.match(taxonomy, new RegExp(`key: '${SEAFARER_MASTER.department}'`))
  assert.match(taxonomy, new RegExp(`${SEAFARER_MASTER.department}: \\[\\s*\\['${SEAFARER_MASTER.rank}', 'Master / Captain'`))
  assert.ok(roleFields.includes(SEAFARER_MASTER.rankLabel), `${SEAFARER_MASTER.rankLabel} must be the rank picker label`)
})

test('the helper picks persona, intent, organisation, department and rank by exact accessible names', () => {
  const helper = readFileSync(helperPath, 'utf8')
  assert.match(helper, /^export async function chooseSeafarerMaster\(page, \{ organisation \} = \{\}\)/m)
  assert.match(helper, /getByRole\('button', \{ name: SEAFARER_MASTER\.persona, exact: true \}\)/)
  assert.match(helper, /getByRole\('button', \{ name: SEAFARER_MASTER\.intent, exact: true \}\)/)
  assert.equal((helper.match(/toHaveAttribute\('aria-pressed', 'true'\)/g) ?? []).length, 2)
  assert.match(helper, /getByLabel\(SEAFARER_MASTER\.organisationLabel, \{ exact: true \}\)\.fill\(organisation\)/)
  assert.match(helper, /getByLabel\(SEAFARER_MASTER\.departmentLabel, \{ exact: true \}\)\.selectOption\(SEAFARER_MASTER\.department\)/)
  assert.match(helper, /toHaveValue\(SEAFARER_MASTER\.rank\)/)
  // The helper only chooses the role: each script keeps its own username, location and completion.
  assert.doesNotMatch(helper, /slug|Complete profile|Location/)
  for (const retired of RETIRED_ONBOARDING) assert.equal(helper.includes(retired), false, retired)
})

test('the helper refuses to run without an organisation to type', async () => {
  const page = new Proxy({}, { get: () => { throw new Error('page must not be touched') } })
  for (const options of [undefined, {}, { organisation: '' }, { organisation: '   ' }, { organisation: 42 }]) {
    await assert.rejects(chooseSeafarerMaster(page, options), /needs the organisation/)
  }
})

for (const { script, workflow } of consumers) {
  test(`${script} onboards members through the shared helper, watched by its workflow`, () => {
    const source = readFileSync(script, 'utf8')
    const workflowSource = readFileSync(workflow, 'utf8')

    assert.match(source, /^import \{ chooseSeafarerMaster \} from '\.\/e2e-onboarding\.mjs'$/m)
    assert.match(source, /await chooseSeafarerMaster\(page, \{ organisation(: [^}]+)? \}\)/)
    for (const retired of RETIRED_ONBOARDING) assert.equal(source.includes(retired), false, `${script} still uses ${retired}`)

    // A change to the helper must start this runner's plan, and must not be skipped as "none of its scripts changed".
    const paths = workflowSource.match(/\n {4}paths:\n((?: {6}- .+\n)+)/)?.[1] ?? ''
    assert.match(paths, /^ {6}- scripts\/aws\/e2e-onboarding\.mjs$/m, `${workflow} paths must list the helper`)
    const runnerFiles = workflowSource.match(/RUNNER_FILES: "([^"]+)"/)
    if (runnerFiles) assert.ok(runnerFiles[1].split(' ').includes(helperPath), `${workflow} RUNNER_FILES must list the helper`)
  })
}
