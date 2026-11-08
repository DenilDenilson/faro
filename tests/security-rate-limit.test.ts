import { createClient } from '@libsql/client';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRepository } from '../src/domains/data/service';

describe('persistent access attempt limits', () => {
  it('keeps the lock across server instances and releases it only after the window or a successful login', async () => {
    const scratch = join(process.cwd(), 'work');
    mkdirSync(scratch, { recursive: true });
    const directory = mkdtempSync(join(scratch, 'security-rate-'));
    const url = `file:${join(directory, 'auth.db')}`;
    const initial = Date.parse('2026-11-07T14:00:00Z');
    let client = createClient({ url });
    try {
      let repository = await createRepository(client);
      for (let attempt = 0; attempt < 5; attempt++) {
        await expect(
          repository.consumeLoginAttempt('single-user-login', initial + attempt),
        ).resolves.toMatchObject({ allowed: true });
      }
      await expect(
        repository.consumeLoginAttempt('single-user-login', initial + 100),
      ).resolves.toMatchObject({ allowed: false, retryAfter: 900 });
      client.close();
      client = createClient({ url });
      repository = await createRepository(client);
      await expect(
        repository.consumeLoginAttempt('single-user-login', initial + 60_000),
      ).resolves.toMatchObject({ allowed: false, retryAfter: 841 });
      await expect(
        repository.consumeLoginAttempt('single-user-login', initial + 16 * 60_000),
      ).resolves.toMatchObject({ allowed: true });
      await repository.clearLoginAttempts('single-user-login');
      await expect(
        repository.consumeLoginAttempt('single-user-login', initial + 16 * 60_000 + 1),
      ).resolves.toMatchObject({ allowed: true });
      const tables = await client.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      );
      expect(tables.rows.every((row) => String(row.name).startsWith('faro_'))).toBe(true);
    } finally {
      client.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
