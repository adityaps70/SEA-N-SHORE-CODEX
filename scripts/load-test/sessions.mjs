// Round ARCH (Phase 1): moves the signed-in load test's sessions from the sessions job to the shards without anything
// readable reaching a log, an output or an artifact.
//
//   node sessions.mjs keypair <dir>                      writes <dir>/private.pem (0600) and prints the public key (base64)
//   node sessions.mjs open <private.pem> <sealed-file>   prints the sessions JSON (the accounts worker sealed it to the key)
//   node sessions.mjs seal-shards <sessions.json> <n> <dir>  writes <dir>/shard-<i>.sealed (0600) for each shard: its
//                                                        sessions, AES-256-GCM with LOAD_TEST_HANDOFF_KEY (a GitHub
//                                                        secret, base64 of 32 bytes); prints only the count of files
//   node sessions.mjs open-shard <sealed-file> <out-file>  writes the shard's sessions to <out-file> (0600) and masks
//                                                        every token in the job log
// The repository is public (18 Nov): the sealed parts travel between jobs as a short-lived artifact that the run
// deletes once every shard has opened its part, never as a job output or an environment value (both are printed in
// the public log).
import { createCipheriv, createDecipheriv, generateKeyPairSync, privateDecrypt, randomBytes, constants } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export function handoffKey(value = process.env.LOAD_TEST_HANDOFF_KEY) {
  const key = Buffer.from(String(value ?? ''), 'base64')
  if (key.length !== 32) throw new Error('LOAD_TEST_HANDOFF_KEY must be the base64 of 32 random bytes')
  return key
}

export function openSealed(sealed, privateKeyPem) {
  const [wrapped, iv, tag, body] = sealed.trim().split('.').map((part) => Buffer.from(part, 'base64'))
  const key = privateDecrypt({ key: privateKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, wrapped)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8'))
}

export function sealShard(sessions, key) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(JSON.stringify(sessions), 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString('base64')).join('.')
}

export function openShard(sealed, key) {
  const [iv, tag, body] = sealed.split('.').map((part) => Buffer.from(part, 'base64'))
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8'))
}

/** Account i goes to shard i mod n, so every shard gets 6 or 7 of the 50. */
export function splitSessions(sessions, shards) {
  const out = Array.from({ length: shards }, () => [])
  sessions.forEach((session, i) => out[i % shards].push(session))
  return out
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const [mode, a, b] = process.argv.slice(2)
  if (mode === 'keypair') {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072 })
    writeFileSync(join(a, 'private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
    process.stdout.write(Buffer.from(publicKey.export({ type: 'spki', format: 'pem' })).toString('base64'))
  } else if (mode === 'open') {
    process.stdout.write(JSON.stringify(openSealed(readFileSync(b, 'utf8'), readFileSync(a, 'utf8'))))
  } else if (mode === 'seal-shards') {
    const key = handoffKey()
    const dir = process.argv[5]
    if (!dir) throw new Error('seal-shards needs an output directory')
    const parts = splitSessions(JSON.parse(readFileSync(a, 'utf8')), Number(b))
    parts.forEach((part, i) => writeFileSync(join(dir, `shard-${i}.sealed`), sealShard(part, key), { mode: 0o600 }))
    process.stdout.write(`LOAD_TEST_SESSIONS_SEALED shards=${parts.length}\n`)
  } else if (mode === 'open-shard') {
    const sessions = openShard(readFileSync(a, 'utf8').trim(), handoffKey())
    for (const session of sessions) {
      for (const token of [session.accessToken, session.refreshToken]) if (token) process.stdout.write(`::add-mask::${token}\n`)
    }
    writeFileSync(b, JSON.stringify(sessions), { mode: 0o600 })
    process.stdout.write(`LOAD_TEST_SHARD_SESSIONS count=${sessions.length}\n`)
  } else {
    console.error(`unknown mode ${mode}`)
    process.exit(2)
  }
}
