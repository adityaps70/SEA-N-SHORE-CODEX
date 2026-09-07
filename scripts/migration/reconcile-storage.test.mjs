import test from 'node:test';
import assert from 'node:assert/strict';
import { compareStorage, normalizePath, normalizeSourceObject, normalizeTargetObject } from './reconcile-storage.mjs';

test('normalizes storage paths without changing logical key', () => {
  assert.equal(normalizePath('/post-media//a/b.jpg'), 'post-media/a/b.jpg');
  assert.equal(normalizeSourceObject({ bucket_id: 'post-media', name: '/a.jpg', size: '12' }).key, 'post-media/a.jpg');
  assert.equal(normalizeTargetObject({ Key: '/post-media/a.jpg', Size: 12 }).key, 'post-media/a.jpg');
});

test('detects missing extra and size mismatch objects', () => {
  const result = compareStorage(
    [
      { bucket_id: 'post-media', name: 'a.jpg', size: 10 },
      { bucket_id: 'post-media', name: 'b.jpg', size: 20 },
      { bucket_id: 'post-media', name: 'c.jpg', size: 30 },
    ],
    [
      { key: 'post-media/a.jpg', size: 10 },
      { key: 'post-media/b.jpg', size: 99 },
      { key: 'post-media/d.jpg', size: 40 },
    ],
  );
  assert.deepEqual(result.missingInTarget, ['post-media/c.jpg']);
  assert.deepEqual(result.extraInTarget, ['post-media/d.jpg']);
  assert.deepEqual(result.sizeMismatches, [{ key: 'post-media/b.jpg', sourceSize: 20, targetSize: 99 }]);
  assert.deepEqual(result.retryKeys, ['post-media/b.jpg', 'post-media/c.jpg']);
  assert.equal(result.matches, false);
});

test('extra target objects do not make migration incomplete', () => {
  const result = compareStorage(
    [{ bucket_id: 'post-media', name: 'a.jpg', size: 10 }],
    [
      { key: 'post-media/a.jpg', size: 10 },
      { key: 'derived/cache.jpg', size: 5 },
    ],
  );
  assert.deepEqual(result.extraInTarget, ['derived/cache.jpg']);
  assert.equal(result.matches, true);
});

test('duplicates fail reconciliation', () => {
  const result = compareStorage(
    [
      { bucket_id: 'post-media', name: 'a.jpg', size: 10 },
      { bucket_id: 'post-media', name: 'a.jpg', size: 10 },
    ],
    [{ key: 'post-media/a.jpg', size: 10 }],
  );
  assert.deepEqual(result.duplicateSourceKeys, ['post-media/a.jpg']);
  assert.equal(result.matches, false);
});
