import pg from 'pg'

const { Client } = pg

for (const name of ['AURORA_HOST', 'AURORA_PORT', 'AURORA_DATABASE', 'AURORA_USER', 'AURORA_PASSWORD']) {
  if (!process.env[name]) throw new Error(`missing_${name.toLowerCase()}`)
}

const client = new Client({
  host: process.env.AURORA_HOST,
  port: Number(process.env.AURORA_PORT),
  database: process.env.AURORA_DATABASE,
  user: process.env.AURORA_USER,
  password: process.env.AURORA_PASSWORD,
  ssl: { rejectUnauthorized: false },
})

await client.connect()

const result = await client.query(`
  select
    p.id,
    p.created_at,
    p.post_type::text as post_type,
    p.category::text as category,
    char_length(p.body) as body_length,
    exists (
      select 1
      from public.post_media media
      where media.post_id = p.id
    ) as has_media
  from public.posts p
  where p.created_at >= now() - interval '60 minutes'
    and p.deleted_at is null
  order by p.created_at desc, p.id desc
  limit 20
`)

console.log(`RECENT_AURORA_POST_COUNT=${result.rows.length}`)
for (const row of result.rows) console.log(JSON.stringify(row))

await client.end()
