import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Aurora migration parity audit emits PII-safe semantic tokens for connections and notifications', async () => {
  const script = await readFile(new URL('./audit-aurora-migration-parity.sh', import.meta.url), 'utf8');

  assert.match(script, /AURORA_CONNECTION_SEMANTICS=/);
  assert.match(script, /AURORA_NOTIFICATION_SEMANTICS=/);
  assert.match(script, /md5\(user_low_id::text\)/);
  assert.match(script, /md5\(recipient_id::text\)/);
  assert.match(script, /notification_type::text/);
});
