import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertDifferentDatabases,
  buildKeyQuery,
  compareKeyRows,
  keyToken,
  quoteIdentifier,
  validateManifest,
} from './reconcile-postgres.mjs';

test('manifest accepts safe table mappings and rejects unsafe identifiers', () => {
  assert.equal(validateManifest({ version: 1, tables: [{ source: 'public.posts', target: 'public.posts', keys: ['id'] }] }).version, 1);
  assert.throws(
    () => validateManifest({ version: 1, tables: [{ source: 'public.posts;drop table x', target: 'public.posts', keys: ['id'] }] }),
    /schema\.table/,
  );
  assert.throws(() => quoteIdentifier('id;drop'), /Unsafe SQL identifier/);
});

test('buildKeyQuery quotes schema table and composite keys deterministically', () => {
  assert.equal(
    buildKeyQuery('public.company_members', ['company_id', 'user_id']),
    'select "company_id", "user_id" from "public"."company_members" order by "company_id", "user_id"',
  );
});

test('keyToken preserves null and primitive type identity', () => {
  assert.notEqual(keyToken({ id: null }, ['id']), keyToken({ id: 'null' }, ['id']));
  assert.notEqual(keyToken({ id: 1 }, ['id']), keyToken({ id: '1' }, ['id']));
});

test('compareKeyRows reports missing extra duplicate keys and digests', () => {
  const result = compareKeyRows(
    [{ id: 'a' }, { id: 'b' }, { id: 'b' }],
    [{ id: 'a' }, { id: 'c' }],
    ['id'],
  );
  assert.equal(result.sourceCount, 3);
  assert.equal(result.targetCount, 2);
  assert.equal(result.sourceDuplicateKeys, 1);
  assert.equal(result.targetDuplicateKeys, 0);
  assert.equal(result.missingInTarget.length, 1);
  assert.equal(result.extraInTarget.length, 1);
  assert.notEqual(result.sourceKeyDigest, result.targetKeyDigest);
  assert.equal(result.matches, false);
});

test('compareKeyRows matches identical key sets regardless of input order', () => {
  const result = compareKeyRows([{ id: 'b' }, { id: 'a' }], [{ id: 'a' }, { id: 'b' }], ['id']);
  assert.equal(result.matches, true);
  assert.equal(result.sourceKeyDigest, result.targetKeyDigest);
});

test('database guard rejects same database identity even with different passwords', () => {
  assert.throws(
    () => assertDifferentDatabases('postgres://user:one@db.example.com/app', 'postgres://user:two@db.example.com/app'),
    /same database identity/,
  );
  assert.doesNotThrow(() => assertDifferentDatabases('postgres://user@source.example.com/app', 'postgres://user@target.example.com/app'));
});
