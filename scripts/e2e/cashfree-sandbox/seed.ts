// Cashfree sandbox checkout E2E: applies every Aurora migration to the throwaway Postgres on the CI runner and adds
// the fixtures the three checkouts need. Fixture names only; no member data. Never run against a real database:
// it refuses any host but 127.0.0.1 / localhost.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { createActiveMentor, createProfile, createPublishedCourse } from '../../../src/features/learning/learning-test-fixtures'

const host = process.env.AURORA_HOST ?? ''
if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error('The sandbox seed only runs against the local runner database.')

const client = new pg.Client({
  host,
  port: Number(process.env.AURORA_PORT ?? 5432),
  database: process.env.AURORA_DATABASE,
  user: process.env.AURORA_USER,
  password: process.env.AURORA_PASSWORD,
})
const query = async (text: string, values?: readonly unknown[]) => (await client.query(text, values ? [...values] : undefined)).rows

async function migrate() {
  await query(`
    do $$ begin create role sns_cluster_admin; exception when duplicate_object then null; end $$;
    create table if not exists public.sea_n_shore_applied_migrations (name text primary key, applied_at timestamptz not null default now());
  `)
  const directory = join(process.cwd(), 'infra/aws/database/migrations')
  const files = readdirSync(directory).filter((file) => file.endsWith('.sql')).sort()
  for (const file of files) {
    for (const statement of readFileSync(join(directory, file), 'utf8').split('-- statement-breakpoint')) {
      if (!statement.trim()) continue
      try {
        await query(statement)
      } catch (error) {
        throw new Error(`Migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  console.log(`SANDBOX_MIGRATIONS_APPLIED=${files.length}`)
}

async function seed() {
  const email = process.env.E2E_MEMBER_EMAIL!.toLowerCase()
  const sub = process.env.E2E_MEMBER_SUB!
  const member = await createProfile(query, 'Sandbox Buyer')
  // A completed profile (so sign-in lands on /home, not onboarding): type, slug, headline and summary.
  await query(
    `update public.profiles set profile_type = 'maritime_professional', slug = 'sandbox-buyer', headline = 'Sandbox checkout buyer',
       summary = 'A fixture member used only by the sandbox checkout test.', onboarding_completed_at = now() where id = $1`,
    [member],
  )
  await query(
    `insert into public.identity_accounts (profile_id, provider, provider_subject, email, email_verified) values ($1, 'cognito', $2, $3, true)`,
    [member, sub, email],
  )
  // Cashfree needs a mobile number on every order; a fixed test number skips the phone step.
  await query(`insert into public.payment_customer_contacts (profile_id, phone) values ($1, '+919000000001')`, [member])

  const mentor = await createActiveMentor(query)
  const course = await createPublishedCourse(query, mentor, { slug: 'sandbox-checkout-course', priceMinor: 100_000 })

  const host = await createProfile(query, 'Sandbox Event Host')
  const [event] = await query(
    `insert into public.events (host_user_id, title, summary, description, format, meeting_url, status, start_at, end_at, timezone,
       is_paid, price_minor, currency)
     values ($1, 'Sandbox Checkout Event', 'A fixture event for the sandbox checkout test.', '', 'online', 'https://example.com/meet',
       'published', now() + interval '7 days', now() + interval '7 days 1 hour', 'Asia/Kolkata', true, 50000, 'INR')
     returning id`,
    [host],
  )
  const [company] = await query(
    `insert into public.companies (slug, name, created_by, is_verified) values ('sandbox-checkout-org', 'Sandbox Checkout Org', $1, true) returning id`,
    [member],
  )
  await query(`insert into public.company_members (company_id, user_id, role, approved_at) values ($1, $2, 'owner', now())`, [company!.id, member])

  const fixtures = { memberId: member, courseSlug: course.slug, courseId: course.courseId, eventId: String(event!.id), companyId: String(company!.id) }
  writeFileSync(process.env.SANDBOX_FIXTURES_PATH ?? '/tmp/cashfree-sandbox-fixtures.json', JSON.stringify(fixtures))
  console.log('SANDBOX_FIXTURES_READY course=1 event=1 organization=1 member=1')
}

async function main() {
  await client.connect()
  try {
    await migrate()
    await seed()
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
