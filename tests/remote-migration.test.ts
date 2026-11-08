import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
const execute = promisify(execFile);
it('remote migration rejects local fallback and does not print secrets on configuration errors', async () => {
  mkdirSync('work', { recursive: true });
  const directory = mkdtempSync(join(process.cwd(), 'work', 'remote-migration-'));
  const database = join(directory, 'must-not-exist.db');
  const token = 'test-only-token-must-never-appear-in-output';
  try {
    for (const databaseURL of ['', `file:${database}`]) {
      let failure: unknown;
      try {
        await execute(process.execPath, ['--import', 'tsx', 'scripts/remote-migrate.ts'], {
          env: {
            ...process.env,
            NODE_ENV: 'production',
            TURSO_DATABASE_URL: databaseURL,
            TURSO_AUTH_TOKEN: token,
            FARO_DATABASE_PATH: database,
          },
        });
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({ code: 1 });
      const output = failure as { stdout: string; stderr: string };
      expect(output.stderr).toContain('REMOTE_MIGRATION_FAILED');
      expect(output.stdout + output.stderr).not.toContain(token);
      expect(output.stdout + output.stderr).not.toContain(database);
      expect(existsSync(database)).toBe(false);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 15_000);
