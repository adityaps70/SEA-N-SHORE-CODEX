'use strict'

const { randomUUID } = require('node:crypto')
const { Pool } = require('pg')

const marker = String(process.env.HIRING_CREATE_JOB_PROBE_MARKER || Date.now()).replace(/[^0-9A-Za-z-]/g, '').slice(0, 24)
const userId = randomUUID()
const companyId = randomUUID()
const slug = `hiring-probe-${marker.toLowerCase()}`.slice(0, 80)
const companyName = `Hiring Probe ${marker}`
const jobTitle = `E2E Hiring Probe ${marker}`
const roles = ['owner', 'administrator', 'recruiter']
let stage = 'connect'
let transactionStarted = false
let jobId = null
let failure = null

const pool = new Pool({
  host: process.env.AURORA_HOST,
  port: Number(process.env.AURORA_PORT || 5432),
  database: process.env.AURORA_DATABASE,
  user: process.env.AURORA_USER,
  password: process.env.AURORA_PASSWORD,
  ssl: process.env.AURORA_SSL === 'true',
  max: 1,
  connectionTimeoutMillis: 30000,
  allowExitOnIdle: true,
})

function safeField(error, field) {
  const value = error && typeof error === 'object' ? error[field] : null
  return typeof value === 'string' ? value.replace(/[\r\n]/g, ' ').slice(0, 300) : 'unknown'
}

async function run() {
  let client
  try {
    client = await pool.connect()
    stage = 'begin'
    await client.query('BEGIN')
    transactionStarted = true

    stage = 'fixture_profile'
    await client.query('insert into public.profiles (id, full_name) values ($1, $2)', [userId, 'Hiring Probe User'])

    stage = 'fixture_company'
    await client.query(`
      insert into public.companies (id, slug, name, created_by, is_verified, verified_at, verified_by)
      values ($1, $2, $3, $4, true, now(), $4)
    `, [companyId, slug, companyName, userId])

    stage = 'fixture_membership'
    await client.query(`
      insert into public.company_members (company_id, user_id, role, approved_at, is_verified, verified_at, verified_by)
      values ($1, $2, 'owner', now(), true, now(), $2)
    `, [companyId, userId])

    stage = 'authorized_company'
    const authorized = await client.query(`
      select c.id as company_id, c.slug as company_slug, c.name as company_name,
        coalesce(c.is_verified, false) as company_verified, cm.role::text as role
      from public.companies c
      join public.company_members cm on cm.company_id = c.id
      where cm.user_id = $1
        and cm.approved_at is not null
        and cm.role::text = any($2::text[])
        and c.is_verified = true
        and c.id = $3
      limit 1
    `, [userId, roles, companyId])
    if (authorized.rows.length !== 1) throw new Error('probe_authorization_failed')
    console.log('HIRING_CREATE_JOB_PROBE_STAGE_OK=authorized_company')

    stage = 'insert_job'
    const inserted = await client.query(`
      insert into public.jobs (
        title, company_name, company_id, created_by_user_id, location, summary, description, requirements,
        apply_until, status, job_domain, department, rank, vessel_types, experience_min_years, experience_max_years,
        joining_from, joining_until, salary_min, salary_max, salary_currency, salary_period, sailing_regions,
        urgent, easy_apply, published_at
      ) values (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14::text[], $15, $16,
        $17, $18, $19, $20, $21, $22, $23::text[],
        $24, $25, case when $10 = 'published' then now() else null end
      ) returning id
    `, [
      jobTitle, companyName, companyId, userId, 'Worldwide',
      'Diagnostic published vacancy for the Sea N Shore hiring transaction.',
      'Lead the deck team safely and maintain tanker operating standards.',
      'Valid STCW certification and relevant tanker experience required.',
      null, 'published', 'sea', 'Deck', 'Chief Officer', ['Oil Tanker', 'Chemical Tanker'],
      2, 8, null, null, 7000, 8500, 'USD', 'month', ['Worldwide', 'Middle East'], true, true,
    ])
    jobId = inserted.rows[0] && inserted.rows[0].id
    if (typeof jobId !== 'string') throw new Error('probe_job_id_missing')
    console.log('HIRING_CREATE_JOB_PROBE_STAGE_OK=insert_job')

    for (const certificate of ['STCW', 'Advanced Oil Tanker']) {
      stage = 'insert_certificate_requirement'
      await client.query(`
        insert into public.job_certificate_requirements (job_id, certificate_name, required)
        values ($1, $2, true)
        on conflict (job_id, certificate_name) do update set required = excluded.required
      `, [jobId, certificate])
    }
    console.log('HIRING_CREATE_JOB_PROBE_STAGE_OK=insert_certificate_requirement')

    stage = 'insert_visa_requirement'
    await client.query(`
      insert into public.job_visa_requirements (job_id, visa_name, required)
      values ($1, $2, true)
      on conflict (job_id, visa_name) do update set required = excluded.required
    `, [jobId, 'US C1/D'])
    console.log('HIRING_CREATE_JOB_PROBE_STAGE_OK=insert_visa_requirement')
  } catch (error) {
    failure = error
    console.log(`HIRING_CREATE_JOB_PROBE_FAILED_STAGE=${stage}`)
    console.log(`HIRING_CREATE_JOB_PROBE_ERROR_CODE=${safeField(error, 'code')}`)
    console.log(`HIRING_CREATE_JOB_PROBE_ERROR_CONSTRAINT=${safeField(error, 'constraint')}`)
    console.log(`HIRING_CREATE_JOB_PROBE_ERROR_TABLE=${safeField(error, 'table')}`)
    console.log(`HIRING_CREATE_JOB_PROBE_ERROR_COLUMN=${safeField(error, 'column')}`)
    console.log(`HIRING_CREATE_JOB_PROBE_ERROR_MESSAGE=${safeField(error, 'message')}`)
  } finally {
    if (client && transactionStarted) {
      try { await client.query('ROLLBACK') } catch (rollbackError) {
        console.log(`HIRING_CREATE_JOB_PROBE_ROLLBACK_ERROR_CODE=${safeField(rollbackError, 'code')}`)
        failure ||= rollbackError
      }
    }
    client && client.release()
  }

  try {
    const persisted = await pool.query(`
      select
        (select count(*)::int from public.profiles where id = $1) as profiles,
        (select count(*)::int from public.companies where id = $2) as companies,
        (select count(*)::int from public.jobs where title = $3) as jobs
    `, [userId, companyId, jobTitle])
    const row = persisted.rows[0] || {}
    const clean = row.profiles === 0 && row.companies === 0 && row.jobs === 0
    console.log(`HIRING_CREATE_JOB_PROBE_ROLLBACK_VERIFIED=${clean ? 'true' : 'false'}`)
    if (!clean) failure ||= new Error('probe_rollback_persistence_detected')
  } catch (error) {
    console.log(`HIRING_CREATE_JOB_PROBE_ROLLBACK_VERIFY_ERROR_CODE=${safeField(error, 'code')}`)
    failure ||= error
  } finally {
    await pool.end()
  }

  if (failure) process.exitCode = 1
  else console.log('HIRING_CREATE_JOB_PROBE_COMPLETED=true')
}

run().catch((error) => {
  console.log('HIRING_CREATE_JOB_PROBE_FAILED_STAGE=unhandled')
  console.log(`HIRING_CREATE_JOB_PROBE_ERROR_CODE=${safeField(error, 'code')}`)
  process.exitCode = 1
})
