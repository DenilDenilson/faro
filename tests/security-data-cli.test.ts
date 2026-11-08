import { createClient } from '@libsql/client';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { createRepository } from '../src/domains/data/service';
import type { FaroRecord, ImportPreview } from '../src/lib/types';

const execute = promisify(execFile);

describe('direct database backup CLI', () => {
  it('exports and restores a file larger than the web limit without overwriting backups or skipping preview confirmation', async () => {
    const scratch = join(process.cwd(), 'work');
    mkdirSync(scratch, { recursive: true });
    const directory = mkdtempSync(join(scratch, 'security-data-cli-'));
    const sourceURL = `file:${join(directory, 'source.db')}`;
    const targetURL = `file:${join(directory, 'target.db')}`;
    const file = join(directory, 'portable.json');
    const source = createClient({ url: sourceURL });
    const target = createClient({ url: targetURL });
    const command = (url: string, args: string[]) =>
      execute(process.execPath, ['--import', 'tsx', 'scripts/data.ts', ...args], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: 'test',
          TURSO_DATABASE_URL: url,
          TURSO_AUTH_TOKEN: '',
          FORCE_COLOR: '0',
        },
        maxBuffer: 1024 * 1024,
      });
    try {
      await createRepository(source);
      const destination = await createRepository(target);
      await destination.updateSettings({ timezone: 'Europe/Madrid' });
      const records: FaroRecord[] = Array.from({ length: 75 }, (_, index) => ({
        id: `large-learning-${index}`,
        type: 'learnings',
        name: `Aprendizaje ${index}`,
        description: '',
        status: 'active',
        createdAt: '2026-11-07T14:00:00.000Z',
        updatedAt: '2026-11-07T14:00:00.000Z',
        notes: 'a'.repeat(64_000),
      }));
      await source.batch(
        records.map((record) => ({
          sql: 'INSERT INTO faro_records(id,type,name,status,created_at,updated_at,data) VALUES (?,?,?,?,?,?,?)',
          args: [
            record.id,
            record.type,
            record.name,
            record.status,
            record.createdAt,
            record.updatedAt,
            JSON.stringify(record),
          ],
        })),
        'write',
      );

      const exported = JSON.parse((await command(sourceURL, ['export', file])).stdout) as {
        sha256: string;
        records: number;
      };
      const info = await stat(file);
      expect(info.size).toBeGreaterThan(4 * 1024 * 1024);
      if (process.platform !== 'win32') expect(info.mode & 0o777).toBe(0o600);
      expect(exported.records).toBe(75);
      expect(
        createHash('sha256')
          .update(await readFile(file))
          .digest('hex'),
      ).toBe(exported.sha256);

      await expect(command(sourceURL, ['export', file])).rejects.toMatchObject({ code: 1 });
      expect(
        createHash('sha256')
          .update(await readFile(file))
          .digest('hex'),
      ).toBe(exported.sha256);
      expect((await readdir(directory)).some((name) => name.endsWith('.partial'))).toBe(false);

      const preview = JSON.parse(
        (await command(targetURL, ['preview', file])).stdout,
      ) as ImportPreview;
      expect(preview.newRecords).toBe(75);
      await expect(command(targetURL, ['import', file])).rejects.toMatchObject({ code: 1 });
      await expect(
        command(targetURL, ['import', file, '--digest', '0'.repeat(64)]),
      ).rejects.toMatchObject({ code: 1 });
      expect(await destination.listRecords()).toHaveLength(0);

      const restored = JSON.parse(
        (await command(targetURL, ['import', file, '--digest', preview.digest])).stdout,
      ) as { imported: number; preferencesRestored: boolean };
      expect(restored).toMatchObject({ imported: 75, preferencesRestored: false });
      expect(await destination.listRecords()).toHaveLength(75);
      expect((await destination.getSettings()).timezone).toBe('Europe/Madrid');
      const repeated = JSON.parse(
        (await command(targetURL, ['preview', file])).stdout,
      ) as ImportPreview;
      expect(repeated).toMatchObject({ newRecords: 0, duplicates: 75, conflicts: 0 });
    } finally {
      source.close();
      target.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
