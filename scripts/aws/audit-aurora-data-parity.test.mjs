import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('Aurora data parity identity output is tokenized and self-validating', async () => {
  const script = await readFile(new URL('./audit-aurora-data-parity.sh', import.meta.url), 'utf8');

  assert.match(script, /COGNITO_IDENTITY_TOKEN=/);
  assert.match(script, /AURORA_PROVIDER_IDENTITY_TOKEN=/);
  assert.match(script, /AURORA_PROFILE_IDENTITY_TOKEN=/);
  assert.match(script, /AWS_IDENTITY_MAPPING_MATCH=true/);
  assert.match(script, /token\(subject\)/);
  assert.match(script, /token\(profile\)/);
  assert.match(script, /if not provider_pairs <= cognito_pairs:/);

  assert.doesNotMatch(script, /COGNITO_EMAIL_TOKEN=.*\|\{subject\}/);
  assert.doesNotMatch(script, /AURORA_IDENTITY_TOKEN=.*\|\{profile\}\|\{subject\}/);
});

// Behaviour of the identity block on fixtures (Round 15 multi-login: email + Google users share one email and profile).
const identityBlock = (() => {
  const script = readFileSync(new URL('./audit-aurora-data-parity.sh', import.meta.url), 'utf8');
  return /python3 - "\$TMP_IDENTITY_DIR\/cognito\.json" "\$TMP_IDENTITY_DIR\/accounts\.json" <<'PY'\n([\s\S]*?)\nPY\n/.exec(script)[1];
})();
const user = (sub, email) => ({ Username: sub, Attributes: [{ Name: 'sub', Value: sub }, { Name: 'email', Value: email }] });
const row = (profile, sub, email, status = 'active') => [{ stringValue: profile }, { stringValue: sub }, { stringValue: email }, { stringValue: status }];
function identity(users, rows) {
  const dir = mkdtempSync(join(tmpdir(), 'parity-'));
  try {
    writeFileSync(join(dir, 'c.json'), JSON.stringify({ Users: users }));
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ records: rows }));
    const r = spawnSync('python3', ['-c', identityBlock, join(dir, 'c.json'), join(dir, 'a.json')], { encoding: 'utf8' });
    return { ok: r.status === 0, out: r.status === 0 ? r.stdout : r.stderr, err: r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('identity parity accepts multi-login and unfinished sign-ups, and still refuses real mismatches', () => {
  const base = [user('s1', 'a@x.test'), user('s2', 'A@x.test'), user('s3', 'b@x.test'), user('s4', 'c@x.test'), user('s5', 'c@x.test')];
  const rows = [row('p1', 's1', 'a@x.test'), row('p1', 's2', 'a@x.test'), row('p2', 's3', 'b@x.test')];
  const good = identity(base, rows);
  assert.ok(good.ok, good.out);
  assert.match(good.out, /COGNITO_DUPLICATE_EMAIL_GROUPS=\{"multi_login": 1, "multi_login_plus_unmapped": 0, "unmapped_only": 1\}/);
  assert.match(good.out, /COGNITO_UNMAPPED_USERS=2/);
  assert.match(good.out, /AURORA_PROFILES_WITH_SEVERAL_IDENTITIES=1/);
  assert.match(good.out, /AURORA_IDENTITIES_WITHOUT_COGNITO_USER=\{\}/);
  assert.match(good.out, /AWS_IDENTITY_MAPPING_MATCH=true/);
  assert.doesNotMatch(good.out, /@/);

  const refuse = (label, users, records, reason) => {
    const r = identity(users, records);
    assert.equal(r.ok, false, label);
    assert.match(r.out, reason, label);
  };
  refuse('one email, two profiles', base, [...rows, row('p3', 's4', 'c@x.test')].concat([row('p4', 's5', 'c@x.test')]), /One email is mapped to several profiles/);
  refuse('identity without a Cognito user', base, [...rows, row('p5', 's9', 'z@x.test')], /Aurora identity has no Cognito user/);
  refuse('identity without a Cognito user on a suspended profile', base, [...rows, row('p6', 's8', 'y@x.test', 'suspended')], /Aurora identity has no Cognito user \(profile not deleted\)/);

  // A deleted account's sign-in is gone from Cognito; its identity row is counted, not failed.
  const deleted = identity(base, [...rows, row('p7', 's7', 'w@x.test', 'deletion_requested')]);
  assert.ok(deleted.ok, deleted.out);
  assert.match(deleted.out, /AURORA_IDENTITIES_WITHOUT_COGNITO_USER=\{"deletion_requested": 1\}/);
  assert.match(deleted.out, /AURORA_PROFILES_WITH_A_MISSING_SIGN_IN=\{"deletion_requested:no_sign_in_left": 1\}/);

  // The summary also goes to stderr (SSM truncates stdout); a refusal still says which kind of profile it is.
  const stale = identity(base, [...rows, row('p1', 's6', 'a@x.test', 'active')]);
  assert.equal(stale.ok, false);
  assert.match(stale.err, /AURORA_PROFILES_WITH_A_MISSING_SIGN_IN=\{"active:has_other_sign_in": 1\}/);
  assert.match(stale.err, /Aurora identity has no Cognito user \(profile not deleted\)/);
  refuse('identity email differs', base, [row('p1', 's1', 'other@x.test')], /Aurora identity email differs from Cognito/);
  refuse('duplicate provider subject', base, [row('p1', 's1', 'a@x.test'), row('p2', 's1', 'a@x.test')], /Duplicate Aurora provider subject token/);
  refuse('duplicate Cognito subject', [...base, user('s1', 'q@x.test')], rows, /Duplicate Cognito subject token/);
});
