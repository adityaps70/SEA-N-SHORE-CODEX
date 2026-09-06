import assert from 'node:assert/strict'
import test from 'node:test'

import { migratePostMedia } from './migrate-post-media-to-s3.mjs'

function sourceAdapter(objects) {
  return {
    async listObjects() {
      return objects.map(({ key, size }) => ({ key, size }))
    },
    async downloadObject(key) {
      const object = objects.find((candidate) => candidate.key === key)
      if (!object) throw new Error(`missing source object: ${key}`)
      return object.body ?? Buffer.alloc(object.size)
    },
  }
}

function destinationAdapter(initialObjects = []) {
  const objects = new Map(initialObjects.map((object) => [object.key, { ...object }]))
  const puts = []

  return {
    puts,
    async headObject(key) {
      const object = objects.get(key)
      return object ? { key, size: object.size } : null
    },
    async putObject({ key, body, contentType }) {
      const size = body.byteLength
      puts.push({ key, size, contentType })
      objects.set(key, { key, size, contentType })
    },
  }
}

test('records an explicit zero-object migration inventory', async () => {
  const destination = destinationAdapter()
  const result = await migratePostMedia({
    source: sourceAdapter([]),
    destination,
    sourceBucket: 'post-media',
    destinationBucket: 'sea-n-shore-staging-media',
    now: () => new Date('2026-09-06T16:30:00.000Z'),
  })

  assert.deepEqual(result, {
    sourceBucket: 'post-media',
    destinationBucket: 'sea-n-shore-staging-media',
    sourceObjectCount: 0,
    sourceBytes: 0,
    copiedCount: 0,
    verifiedCount: 0,
    timestamp: '2026-09-06T16:30:00.000Z',
  })
  assert.equal(destination.puts.length, 0)
})

test('copies every source object to the identical S3 key and verifies it', async () => {
  const source = sourceAdapter([
    { key: 'profile-a/post-a/image.jpg', size: 5, body: Buffer.from('hello') },
    { key: 'profile-b/post-b/diagram.webp', size: 3, body: Buffer.from('web') },
  ])
  const destination = destinationAdapter()

  const result = await migratePostMedia({
    source,
    destination,
    sourceBucket: 'post-media',
    destinationBucket: 'sea-n-shore-staging-media',
    now: () => new Date('2026-09-06T16:31:00.000Z'),
  })

  assert.deepEqual(destination.puts.map(({ key }) => key), [
    'profile-a/post-a/image.jpg',
    'profile-b/post-b/diagram.webp',
  ])
  assert.equal(result.sourceObjectCount, 2)
  assert.equal(result.sourceBytes, 8)
  assert.equal(result.copiedCount, 2)
  assert.equal(result.verifiedCount, 2)
})

test('is idempotent when the destination already has the same key and size', async () => {
  const source = sourceAdapter([
    { key: 'profile-a/post-a/image.jpg', size: 5, body: Buffer.from('hello') },
  ])
  const destination = destinationAdapter([
    { key: 'profile-a/post-a/image.jpg', size: 5 },
  ])

  const result = await migratePostMedia({
    source,
    destination,
    sourceBucket: 'post-media',
    destinationBucket: 'sea-n-shore-staging-media',
  })

  assert.equal(destination.puts.length, 0)
  assert.equal(result.copiedCount, 0)
  assert.equal(result.verifiedCount, 1)
})

test('fails verification when an existing destination object has the wrong size', async () => {
  const source = sourceAdapter([
    { key: 'profile-a/post-a/image.jpg', size: 5, body: Buffer.from('hello') },
  ])
  const destination = destinationAdapter([
    { key: 'profile-a/post-a/image.jpg', size: 4 },
  ])

  await assert.rejects(
    migratePostMedia({
      source,
      destination,
      sourceBucket: 'post-media',
      destinationBucket: 'sea-n-shore-staging-media',
    }),
    /migration_verification_failed:profile-a\/post-a\/image\.jpg:size_mismatch/,
  )
  assert.equal(destination.puts.length, 0)
})
