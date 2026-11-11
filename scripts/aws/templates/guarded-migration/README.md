# Guarded migration runner template

Start every new guarded database migration runner from this template instead of copying the last round's runner.
It is the learning round B runner with the round-specific parts taken out. Its evidence check is fixed so that each
run is judged by the line its own path prints.

## Make a runner

```bash
node scripts/aws/templates/guarded-migration/render.mjs \
  --name learning-round-c-migration \
  --title "learning round C" \
  --after 0073_learning_round_b \
  --migration infra/aws/database/migrations/0074_learning_round_c_types.sql \
  --migration infra/aws/database/migrations/0075_learning_round_c.sql \
  --preview infra/aws/database/migrations/0075_learning_round_c.sql
```

This writes four files and never overwrites an existing one:

- `.github/workflows/aws-<name>.yml`;
- `scripts/aws/<name>.sh`;
- `scripts/aws/<name>.test.mjs`;
- `scripts/aws/<name>-action.txt`, set to `plan`.

The options:

- `--after` names the migration that must already be in the ledger.
- `--preview` lists the files a plan run tries in a rolled-back transaction. It defaults to every file. Leave out a
  file whose new enum values a later file uses: Postgres refuses a new enum value in the transaction that added it.
- `--concurrent-index` (Round DB) names a migration that holds exactly one
  `create index concurrently if not exists <name> on public.<table> (...)` and nothing else. Use it for an index on a
  busy table. The runner's concurrent-index step builds it outside any transaction, so a plan run reports the table,
  the index's current state and the row estimate instead of previewing it. On apply it first drops an index of that
  name left INVALID by an earlier interrupted build. After the build the index must be valid and ready, or it is
  dropped and the run fails. Only then is the ledger row written. Such a file is never previewed, and is left out of
  the default `--preview` list.

Then:

1. Add `node --test scripts/aws/<name>.test.mjs` to the SSM execution contract job in
   `.github/workflows/aws-infra-ci.yml`.
2. Add the round-specific checks after apply in the runner, just before `APPLY_VERIFIED=true`. Examples: new
   tables and columns exist; backfill counts are right. Read schema or course data only, never learner rows.
3. A statement that relaxes a rule or rewrites rows needs the owner's approval. Add it word for word to both the
   runner's `ALLOWED` list and the contract test's `APPROVED` list.
4. Run `node scripts/aws/<name>.test.mjs` and the repo's workflow contract tests. They check every file in
   `.github/workflows`.

## Evidence lines

Each path ends with one line, and the workflow requires only that line for the run's action:

| Path | Last line | Required when |
|---|---|---|
| Nothing pending | `<MARKER>_ALREADY_APPLIED=true` | any action |
| Plan | `<MARKER>_PLAN_ONLY_NO_APPLY` | `plan` |
| Apply | `<MARKER>_APPLY_VERIFIED=true` | `migrate-once` |

A plan run also prints `<MARKER>_PLAN_VERIFIED=true`, as information only. The evidence check never requires it.
The round A list repair and round B runners required it on every run, so their successful apply runs showed red.
Those two runners are finished and stay as they are.

`scripts/aws/guarded-migration-template.test.mjs` renders a sample runner. It runs that runner's contract test and
runs its evidence check against plan, apply and nothing-pending output.
