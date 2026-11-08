import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('Aurora data parity identity output is tokenized and self-validating', async () => {
  const script = await readFile(new URL('./audit-aurora-data-parity.sh', import.meta.url), 'utf8');

  assert.match(script, /COGNITO_IDENTITY_TOKEN_SET=/);
  assert.match(script, /AURORA_PROVIDER_IDENTITY_TOKEN_SET=/);
  assert.match(script, /AURORA_PROFILE_IDENTITY_TOKEN_SET=/);
  assert.match(script, /AWS_IDENTITY_MAPPING_MATCH=true/);
  assert.match(script, /token\(subject\)/);
  assert.match(script, /token\(profile\)/);
  assert.match(script, /if not provider_pairs <= cognito_pairs:/);

  // Never a line per row or per identity again: SSM keeps only the first 24,000 characters of stdout.
  assert.doesNotMatch(script, /AURORA_KEY_HASH_/);
  assert.doesNotMatch(script, /COGNITO_IDENTITY_TOKEN=/);
  assert.doesNotMatch(script, /while IFS= read -r/);
  assert.doesNotMatch(script, /COGNITO_EMAIL_TOKEN=.*\|\{subject\}/);
  assert.doesNotMatch(script, /AURORA_IDENTITY_TOKEN=.*\|\{profile\}\|\{subject\}/);
});

// Behaviour of the identity block on fixtures (Round 15 multi-login: email + Google users share one email and profile).
const identityBlock = (() => {
  const script = readFileSync(new URL('./audit-aurora-data-parity.sh', import.meta.url), 'utf8');
  return /python3 - "\$TMP_IDENTITY_DIR\/cognito\.json" "\$TMP_IDENTITY_DIR\/accounts\.json" <<'PY'\n([\s\S]*?)\nPY\n/.exec(script)[1];
})();
const user = (sub, email, extra = {}) => ({
  Username: sub,
  UserStatus: extra.status ?? 'CONFIRMED',
  Attributes: [
    { Name: 'sub', Value: sub },
    { Name: 'email', Value: email },
    ...(extra.google ? [{ Name: 'identities', Value: JSON.stringify([{ providerName: 'Google', userId: `g-${sub}` }]) }] : []),
  ],
});
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
  assert.match(stale.err, /COGNITO_DUPLICATE_EMAIL_GROUPS=\{"multi_login": 1, "multi_login_plus_unmapped": 0, "unmapped_only": 1\}/);
  refuse('identity email differs', base, [row('p1', 's1', 'other@x.test')], /Aurora identity email differs from Cognito/);
  refuse('duplicate provider subject', base, [row('p1', 's1', 'a@x.test'), row('p2', 's1', 'a@x.test')], /Duplicate Aurora provider subject token/);
  refuse('duplicate Cognito subject', [...base, user('s1', 'q@x.test')], rows, /Duplicate Cognito subject token/);
});

test('a Google sign-in linked into the native user leaves a dead identity row that is counted, not failed', () => {
  // cognito-google-native-link-repair deletes the separate Google user and links Google into the native one;
  // the Google user's identity row on the same profile is left with a subject no Cognito user issues.
  const users = [user('n1', 'a@x.test', { google: true }), user('s3', 'b@x.test')];
  const rows = [row('p1', 'n1', 'a@x.test'), row('p1', 'g1', 'a@x.test'), row('p2', 's3', 'b@x.test')];
  const linked = identity(users, rows);
  assert.ok(linked.ok, linked.out);
  assert.match(linked.out, /AURORA_IDENTITIES_WITHOUT_COGNITO_USER=\{"active": 1\}/);
  assert.match(linked.out, /AURORA_IDENTITIES_LEFT_BY_GOOGLE_LINK=\{"active": 1\}/);
  assert.match(linked.out, /AURORA_IDENTITIES_WITHOUT_COGNITO_USER_UNEXPLAINED=\{\}/);
  assert.match(linked.out, /AWS_IDENTITY_MAPPING_MATCH=true/);

  const refuse = (label, u, r) => {
    const result = identity(u, r);
    assert.equal(result.ok, false, label);
    assert.match(result.err, /AURORA_IDENTITIES_WITHOUT_COGNITO_USER_UNEXPLAINED=\{"active": 1\}/, label);
    assert.match(result.err, /Aurora identity has no Cognito user \(profile not deleted\)/, label);
  };
  // The proof needs all of: same profile, same email, and a live native user that lists a linked Google sign-in.
  refuse('native user has no linked Google sign-in', [user('n1', 'a@x.test'), user('s3', 'b@x.test')], rows);
  refuse('dead row on another profile', users, [row('p1', 'n1', 'a@x.test'), row('p2', 's3', 'b@x.test'), row('p2', 'g2', 'b@x.test')]);
  refuse('dead row with another email', users, [row('p1', 'n1', 'a@x.test'), row('p1', 'g1', 'old@x.test'), row('p2', 's3', 'b@x.test')]);
  // An external (Google-only) Cognito user is not a native user that Google was linked into.
  refuse('linked user is external', [user('n1', 'a@x.test', { google: true, status: 'EXTERNAL_PROVIDER' }), user('s3', 'b@x.test')], rows);
});

// End to end with stub `aws` and `git` on PATH: the whole script's output is a fixed set of lines whatever the row
// counts, stays far under SSM's 24,000-character stdout limit, and never carries an email.
function runAudit({ rows: tableRows, users, accounts }) {
  const dir = mkdtempSync(join(tmpdir(), 'parity-e2e-'));
  try {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const sha = 'a'.repeat(40);
    writeFileSync(join(dir, 'fixture.json'), JSON.stringify({ tableRows, users, accounts }));
    writeFileSync(join(bin, 'git'), `#!/usr/bin/env bash
case "$1 $2" in
  "rev-parse HEAD") echo ${sha} ;;
  "remote get-url") echo https://github.com/adityaps70/SEA-N-SHORE-CODEX.git ;;
  "diff --quiet") exit 0 ;;
  *) exit 1 ;;
esac
`);
    writeFileSync(join(bin, 'aws'), `#!/usr/bin/env python3
import hashlib, json, os, re, sys
a = sys.argv[1:]
fx = json.load(open(os.environ['PARITY_FIXTURE']))
def arg(name): return a[a.index(name) + 1]
if a[:2] == ['sts', 'get-caller-identity']: print('310356785722')
elif a[:2] == ['rds', 'describe-db-clusters']:
    print(json.dumps({'DBClusters': [{'DBClusterArn': 'arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora',
        'MasterUserSecret': {'SecretArn': 'arn:aws:secretsmanager:ap-south-1:310356785722:secret:rds!cluster-abc'},
        'HttpEndpointEnabled': True, 'Status': 'available'}]}))
elif a[:2] == ['cognito-idp', 'list-users']: print(json.dumps({'Users': fx['users']}))
elif a[:2] == ['rds-data', 'execute-statement']:
    sql = arg('--sql')
    table = re.search(r'FROM public\\.(\\w+)', sql).group(1)
    n = fx['tableRows'].get(table, 0)
    if 'identity_accounts ia' in sql: print(json.dumps({'records': fx['accounts']}))
    elif 'set_digest' in sql:
        hashes = sorted(hashlib.md5(f'{table}{i}'.encode()).hexdigest() for i in range(n))
        print(json.dumps({'records': [[{'longValue': n}, {'stringValue': hashlib.md5(chr(10).join(hashes).encode()).hexdigest()}]]}))
    elif 'count(*)' in sql: print(json.dumps({'records': [[{'longValue': n}]]}))
    else: sys.exit('unexpected sql: ' + sql)
else: sys.exit('unexpected aws call: ' + ' '.join(a))
`);
    chmodSync(join(bin, 'git'), 0o755);
    chmodSync(join(bin, 'aws'), 0o755);
    const r = spawnSync('bash', [new URL('./audit-aurora-data-parity.sh', import.meta.url).pathname], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, PARITY_FIXTURE: join(dir, 'fixture.json'), AURORA_PARITY_EXPECTED_SHA: sha },
    });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the whole audit prints one line per table and stays far under the SSM output limit', () => {
  // Ten times the 8 Nov 2026 data (4,924 profiles, 3,020 notifications, 669 identities).
  const tableRows = { profiles: 49240, maritime_profiles: 47450, connections: 16790, follows: 15670, notifications: 30200, identity_accounts: 6690 };
  const users = [];
  const accounts = [];
  for (let i = 0; i < 6690; i += 1) {
    users.push(user(`s${i}`, `person${i}@x.test`));
    accounts.push(row(`p${i}`, `s${i}`, `person${i}@x.test`));
  }
  const r = runAudit({ rows: tableRows, users, accounts });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.length < 6000, `stdout is ${r.stdout.length} characters`);
  assert.ok(r.stderr.length < 2000, `stderr is ${r.stderr.length} characters`);
  assert.doesNotMatch(r.stdout + r.stderr, /@/);
  assert.match(r.stdout, /^AURORA_TABLE_COUNT_PROFILES=49240$/m);
  assert.match(r.stdout, /^AURORA_KEY_SET_PROFILES=rows:49240\|md5:[0-9a-f]{32}$/m);
  assert.match(r.stdout, /^AURORA_KEY_SET_POST_POLLS=rows:0\|md5:[0-9a-f]{32}$/m);
  assert.match(r.stdout, /^AURORA_CONNECTION_BUSINESS_SET=rows:16790\|md5:[0-9a-f]{32}$/m);
  assert.match(r.stdout, /^AURORA_NOTIFICATION_BUSINESS_SET=rows:30200\|md5:[0-9a-f]{32}$/m);
  assert.match(r.stdout, /^COGNITO_IDENTITY_TOKEN_SET=rows:6690\|md5:[0-9a-f]{32}$/m);
  assert.match(r.stdout, /^AURORA_PROVIDER_IDENTITY_TOKEN_SET=rows:6690\|md5:[0-9a-f]{32}$/m);
  assert.equal((r.stdout.match(/^AURORA_KEY_SET_/gm) || []).length, 17);
  assert.match(r.stdout, /AWS_IDENTITY_MAPPING_MATCH=true\nAWS_IDENTITY_INVENTORY_COMPLETE=true\nAURORA_TARGET_INVENTORY_COMPLETE=true\n$/);

  // The verdict is still meaningful: an identity with no Cognito user (and no deletion or Google link) fails the run.
  const broken = runAudit({ rows: tableRows, users, accounts: [...accounts, row('p0', 'gone', 'person0@x.test')] });
  assert.notEqual(broken.status, 0);
  assert.match(broken.stderr, /Aurora identity has no Cognito user \(profile not deleted\)/);
  assert.doesNotMatch(broken.stdout, /AURORA_TARGET_INVENTORY_COMPLETE=true/);
});
