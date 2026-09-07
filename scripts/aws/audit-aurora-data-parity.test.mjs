import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Aurora data parity identity output is tokenized and self-validating', async () => {
  const script = await readFile(new URL('./audit-aurora-data-parity.sh', import.meta.url), 'utf8');

  assert.match(script, /COGNITO_IDENTITY_TOKEN=/);
  assert.match(script, /AURORA_PROVIDER_IDENTITY_TOKEN=/);
  assert.match(script, /AURORA_PROFILE_IDENTITY_TOKEN=/);
  assert.match(script, /AWS_IDENTITY_MAPPING_MATCH=true/);
  assert.match(script, /token\(subject\)/);
  assert.match(script, /token\(profile\)/);
  assert.match(script, /cognito_pairs != provider_pairs/);

  assert.doesNotMatch(script, /COGNITO_EMAIL_TOKEN=.*\|\{subject\}/);
  assert.doesNotMatch(script, /AURORA_IDENTITY_TOKEN=.*\|\{profile\}\|\{subject\}/);
});
