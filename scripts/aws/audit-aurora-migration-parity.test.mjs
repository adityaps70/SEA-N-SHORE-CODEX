import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Aurora migration parity audit', () => {
  it('emits PII-safe semantic tokens for connections and notifications', async () => {
    const script = await readFile(new URL('./audit-aurora-migration-parity.sh', import.meta.url), 'utf8');

    expect(script).toContain('AURORA_CONNECTION_SEMANTICS=');
    expect(script).toContain('AURORA_NOTIFICATION_SEMANTICS=');
    expect(script).toContain("md5(user_low_id::text)");
    expect(script).toContain("md5(recipient_id::text)");
    expect(script).toContain("notification_type::text");
  });
});
