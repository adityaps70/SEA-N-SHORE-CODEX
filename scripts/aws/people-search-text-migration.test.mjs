// Round 14 (3.6): migration 0067 adds the stored profiles.search_text for people search (column,
// functions, triggers on profiles / maritime_profiles / profile_skills, backfill, GIN trigram
// index), behind the usual plan / migrate-once guard that runs exactly the reviewed statements.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { guardAction } from './guard-value.mjs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const migration = read('../../infra/aws/database/migrations/0067_people_search_text.sql')
const script = read('./people-search-text-migration.sh')
const action = guardAction(read('./people-search-text-migration-action.txt'))
const workflow = read('../../.github/workflows/aws-people-search-text-migration.yml')
const ci = read('../../.github/workflows/aws-infra-ci.yml')
const repository = read('../../src/features/profiles/repository.ts')

const statements = migration.split(/^\s*-- statement-breakpoint\s*$/m)
  .map((part) => part.replace(/^\s*--.*$/gm, '').trim())
  .filter(Boolean)
const code = statements.join('\n')

const TRIGGERS = [
  ['profiles', 'profiles_set_search_text', 'before insert or update', 'row'],
  ['maritime_profiles', 'maritime_profiles_search_text_insert', 'after insert', 'statement'],
  ['maritime_profiles', 'maritime_profiles_search_text_update', 'after update', 'statement'],
  ['maritime_profiles', 'maritime_profiles_search_text_delete', 'after delete', 'statement'],
  ['profile_skills', 'profile_skills_search_text_insert', 'after insert', 'statement'],
  ['profile_skills', 'profile_skills_search_text_update', 'after update', 'statement'],
  ['profile_skills', 'profile_skills_search_text_delete', 'after delete', 'statement'],
]

test('migration 0067 is additive: column, three functions, seven triggers, backfill, trigram index', () => {
  assert.equal(statements.length, 13)
  assert.equal(statements[0], 'alter table public.profiles add column if not exists search_text text;')
  assert.match(statements[1], /^create or replace function public\.profile_search_text\(profile public\.profiles\)\s+returns text\s+language sql\s+stable\s+set search_path = pg_catalog, public/)
  assert.match(statements[2], /^create or replace function public\.profiles_set_search_text\(\)\s+returns trigger\s+language plpgsql\s+set search_path = pg_catalog, public/)
  assert.match(statements[2], /new\.search_text := public\.profile_search_text\(new\);/)
  assert.match(statements[4], /^create or replace function public\.refresh_profile_search_text\(\)\s+returns trigger\s+language plpgsql\s+set search_path = pg_catalog, public/)
  for (const [table, name, timing, level] of TRIGGERS) {
    const statement = statements.find((part) => part.startsWith(`create or replace trigger ${name}\n`))
    assert.ok(statement, `${name} is created`)
    assert.match(statement, new RegExp(`\\n${timing} on public\\.${table}\\n`))
    assert.match(statement, new RegExp(`for each ${level} execute function public\\.`))
  }
  assert.equal(statements.filter((part) => part.startsWith('create or replace trigger ')).length, TRIGGERS.length)
  assert.match(statements[11], /^update public\.profiles p\s+set search_text = public\.profile_search_text\(p\)\s+where p\.search_text is distinct from public\.profile_search_text\(p\);$/)
  assert.equal(statements[12], 'create index if not exists profiles_search_text_trgm_idx\n  on public.profiles using gin (search_text gin_trgm_ops);')

  // Nothing destructive, no privilege changes, no SECURITY DEFINER; the only ALTER adds the column
  // and every UPDATE writes search_text on public.profiles.
  assert.doesNotMatch(code, /\b(drop|truncate|grant|revoke|owner)\b|\bdelete\s+from\b|\binsert\s+into\b|security\s+definer/i)
  assert.equal(code.match(/\balter\b/gi).length, 1)
  const updates = code.match(/\bupdate\s+\S+(\s+\w+)?\s+set\s+\w+/gi)
  assert.equal(updates.length, 4)
  for (const update of updates) assert.match(update, /^update public\.profiles p\s+set search_text$/)
})

test('search_text is built from the same fields, in the same order, as the per-query text it replaces', () => {
  const legacy = repository.slice(repository.indexOf('const LEGACY_SEARCH_TEXT_SQL = `'))
  const legacyText = legacy.slice(legacy.indexOf("lower(concat_ws(' ',"), legacy.indexOf(')) like all($2::text[])'))
  const stored = statements[1].slice(statements[1].indexOf("lower(concat_ws(' ',"), statements[1].indexOf('))\n  from (select 1) as one'))
  const fields = (text) => text.replace(/\s+/g, ' ').replace(/\bps_search\b/g, 'ps').replace(/\bp\./g, 'profile.').trim()
  assert.ok(legacyText.length > 200 && stored.length > 200)
  assert.equal(fields(stored), fields(legacyText))
  assert.match(statements[1], /left join public\.maritime_profiles mp on mp\.user_id = profile\.id/)
  // The app keeps the old query only as a fallback for a missing column (Postgres 42703).
  assert.match(repository, /code === '42703'/)
  assert.match(repository, /and p\.search_text like \(\$2::text\[\]\)\[\$\{index \+ 1\}\]/)
})

test('the runner is guarded, transactional and verifies column, functions, triggers, index and backfill', () => {
  assert.ok(['plan', 'migrate-once'].includes(action))
  assert.match(script, /0067_people_search_text\.sql/)
  assert.match(script, /PEOPLE_SEARCH_TEXT_SQL_GUARD=EXACT_REVIEWED_STATEMENTS/)
  assert.match(script, /migration 0067 differs from the reviewed statements/)
  assert.match(script, /SECURITY DEFINER is forbidden/)
  assert.match(script, /pg_advisory_xact_lock\(hashtext\('sea-n-shore-people-search-text-0067'\)/)
  assert.match(script, /SET LOCAL lock_timeout = '5s'/)
  assert.match(script, /column_name='search_text'/)
  assert.match(script, /f\.proname IN \('profile_search_text','profiles_set_search_text','refresh_profile_search_text'\) AND NOT f\.prosecdef/)
  for (const [table, name] of TRIGGERS) assert.match(script, new RegExp(`\\('${table}','${name}'\\)`))
  assert.match(script, /"\$\(count "\$TRIGGERS_SQL"\)" == "7"/)
  assert.match(script, /indexname='profiles_search_text_trgm_idx'/)
  assert.match(script, /p\.account_status='active' AND \(p\.search_text IS NULL OR p\.search_text IS DISTINCT FROM public\.profile_search_text\(p\)\)/)
  assert.match(script, /applied\(\)\{ schema_applied && \[\[ "\$\(count "\$UNPOPULATED_SQL"\)" == "0" \]\]; \}/)
  assert.match(script, /pg_trgm \(migration 0063\) is missing; refusing to apply/)
  assert.match(script, /trap cleanup EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM/)
  // A SQL migration runs no Terraform, so it does not queue on the bootstrap Terraform lock.
  assert.doesNotMatch(script, /bootstrap-terraform-lock/)
  assert.match(script, /PEOPLE_SEARCH_TEXT_PLAN_ONLY_NO_APPLY=true/)
  assert.match(script, /PEOPLE_SEARCH_TEXT_APPLY_VERIFIED=true/)
  assert.match(script, /PEOPLE_SEARCH_TEXT_ALREADY_APPLIED=true/)
  assert.match(workflow, /export PEOPLE_SEARCH_TEXT_EXPECTED_SHA=\{sha\}/)
  assert.match(workflow, /bash scripts\/aws\/people-search-text-migration\.sh/)
  assert.match(workflow, /- infra\/aws\/database\/migrations\/0067_people_search_text\.sql\n/)
  assert.match(workflow, /trap 'rm -rf "\$D"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM/)
  assert.match(workflow, /PEOPLE_SEARCH_TEXT_\(PLAN_ONLY_NO_APPLY\|APPLY_VERIFIED\|ALREADY_APPLIED\)=true/)
  assert.match(ci, /node --test scripts\/aws\/people-search-text-migration\.test\.mjs/)
})

test("the runner's own SQL guard accepts the reviewed migration and refuses any edit", () => {
  const start = script.indexOf(`python3 - "$MIGRATION" <<'PY'\n`)
  assert.notEqual(start, -1)
  const guard = script.slice(script.indexOf('\n', start) + 1, script.indexOf('\nPY\n', start))
  const dir = mkdtempSync(join(tmpdir(), 'people-search-guard-'))
  try {
    const check = (sql) => {
      writeFileSync(join(dir, 'm.sql'), sql)
      return spawnSync('python3', ['-', join(dir, 'm.sql')], { input: guard, encoding: 'utf8' })
    }
    const accepted = check(migration)
    assert.equal(accepted.status, 0, accepted.stderr)
    assert.match(accepted.stdout, /PEOPLE_SEARCH_TEXT_SQL_GUARD=EXACT_REVIEWED_STATEMENTS/)
    // Comments and whitespace may change; statements may not.
    assert.equal(check(migration.replace('-- Additive only.', '-- Additive only, reviewed.').replace('  on public.profiles using gin', '    on public.profiles using gin')).status, 0)
    assert.notEqual(check(`${migration}\n-- statement-breakpoint\ndrop table public.profiles;\n`).status, 0)
    assert.notEqual(check(migration.replace('language plpgsql\nset search_path', 'language plpgsql\nsecurity definer\nset search_path')).status, 0)
    assert.notEqual(check(migration.replace('    mp.current_vessel,\n', '')).status, 0)
    assert.notEqual(check(migration.replace('where p.search_text is distinct from public.profile_search_text(p);\n-- statement-breakpoint\n\ncreate index', ';\n-- statement-breakpoint\n\ncreate index')).status, 0)
    assert.notEqual(check(migration.replace(/-- statement-breakpoint\s*create index[\s\S]*$/, '')).status, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
