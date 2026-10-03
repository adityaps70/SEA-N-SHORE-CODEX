import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('origin TLS certificate state reconstruction selects exact Terraform resources', async () => {
  const script = await readFile(new URL('./origin-tls-certificate.sh', import.meta.url), 'utf8');

  assert.match(script, /def attrs\(kind, name\):/);
  assert.match(script, /r\['type'\]==kind and r\['name'\]==name and r\['mode'\]=='managed'/);
  assert.match(script, /attrs\('aws_ecs_task_definition', 'web'\)/);
  assert.match(script, /attrs\('aws_rds_cluster', 'aurora'\)/);
  assert.doesNotMatch(script, /def attrs\(kind\):/);
});
