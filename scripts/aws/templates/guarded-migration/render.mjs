#!/usr/bin/env node
// Makes a new guarded migration runner from this template (see README.md):
//   node scripts/aws/templates/guarded-migration/render.mjs --name learning-round-c-migration \
//     --title "learning round C" --after 0073_learning_round_b \
//     --migration infra/aws/database/migrations/0074_learning_round_c.sql [--migration ...] [--preview <path> ...]
// Writes the workflow, runner, contract test and guard file (set to plan). Refuses to overwrite anything.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TEMPLATE_DIR = path.dirname(fileURLToPath(import.meta.url))

export function runnerValues({ name, title, after, migrations, previews }) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*-migration$/.test(name ?? '')) throw new Error('--name must be kebab-case and end in -migration')
  if (!/^[a-z0-9][a-zA-Z0-9 ]*$/.test(title ?? '')) throw new Error('--title must be plain words, e.g. "learning round C"')
  if (!/^\d{4}_[a-z0-9_]+$/.test(after ?? '')) throw new Error('--after must name the migration that must already be applied, e.g. 0073_learning_round_b')
  if (!migrations?.length) throw new Error('at least one --migration is required')
  for (const file of migrations) {
    if (!/^infra\/aws\/database\/migrations\/\d{4}_[a-z0-9_]+\.sql$/.test(file)) throw new Error(`not a migration path: ${file}`)
  }
  const sorted = [...migrations].sort()
  if (sorted.join() !== migrations.join() || new Set(migrations).size !== migrations.length) throw new Error('--migration files must be distinct and in numeric order')
  const preview = previews?.length ? previews : migrations
  for (const file of preview) if (!migrations.includes(file)) throw new Error(`--preview ${file} is not one of the migrations`)

  const marker = name.toUpperCase().replaceAll('-', '_')
  const short = name.replace(/-migration$/, '')
  const numbers = migrations.map((file) => path.basename(file).slice(0, 4))
  return {
    NAME: name,
    SHORT: short,
    MARKER: marker,
    TITLE: title,
    WORKFLOW_NAME: `AWS ${title.split(' ').map((word) => word[0].toUpperCase() + word.slice(1)).join(' ')} Migration`,
    CONFIRMATION: `I_APPROVE_${marker.replace(/_MIGRATION$/, '')}_STAGING_MIGRATION`,
    RANGE: numbers.length === 1 ? numbers[0] : `${numbers[0]}-${numbers.at(-1)}`,
    AFTER: after,
    MIGRATION_PATHS_YAML: migrations.map((file) => `      - ${file}`).join('\n'),
    MIGRATION_ARRAY: migrations.map((file) => `  "${file}"`).join('\n'),
    PREVIEW_ARRAY: preview.map((file) => `  "${file}"`).join('\n'),
    RUNNER_FILES: [...migrations, `scripts/aws/${name}.sh`, `scripts/aws/${name}.test.mjs`].join(' '),
    MIGRATION_NAMES_JS: migrations.map((file) => `  '${path.basename(file, '.sql')}',`).join('\n'),
  }
}

export function fill(template, values) {
  const text = template.replace(/@@([A-Z_]+)@@/g, (match, key) => {
    if (!(key in values)) throw new Error(`unknown placeholder ${match}`)
    return values[key]
  })
  if (text.includes('@@')) throw new Error('a placeholder was left unfilled')
  return text
}

export function renderRunner(options) {
  const values = runnerValues(options)
  const read = (file) => fs.readFileSync(path.join(TEMPLATE_DIR, file), 'utf8')
  return {
    [`.github/workflows/aws-${values.NAME}.yml`]: fill(read('workflow.yml.tmpl'), values),
    [`scripts/aws/${values.NAME}.sh`]: fill(read('runner.sh.tmpl'), values),
    [`scripts/aws/${values.NAME}.test.mjs`]: fill(read('contract.test.mjs.tmpl'), values),
    [`scripts/aws/${values.NAME}-action.txt`]: 'plan\n',
  }
}

export function writeRunner(root, options) {
  const files = renderRunner(options)
  for (const file of Object.keys(files)) {
    if (fs.existsSync(path.join(root, file))) throw new Error(`${file} already exists; refusing to overwrite it`)
  }
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), text, { mode: file.endsWith('.sh') ? 0o755 : 0o644 })
  }
  return Object.keys(files)
}

function parseArgs(argv) {
  const options = { migrations: [], previews: [], root: process.cwd() }
  for (let index = 0; index < argv.length; index += 2) {
    const [flag, value] = [argv[index], argv[index + 1]]
    if (value === undefined) throw new Error(`${flag} needs a value`)
    if (flag === '--name') options.name = value
    else if (flag === '--title') options.title = value
    else if (flag === '--after') options.after = value
    else if (flag === '--migration') options.migrations.push(value)
    else if (flag === '--preview') options.previews.push(value)
    else if (flag === '--root') options.root = value
    else throw new Error(`unknown option ${flag}`)
  }
  return options
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2))
    for (const file of writeRunner(options.root, options)) console.log(`wrote ${file}`)
    console.log(`Next: add "node --test scripts/aws/${options.name}.test.mjs" to .github/workflows/aws-infra-ci.yml and fill in the round-specific checks (see README.md).`)
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
