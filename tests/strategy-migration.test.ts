import { it, expect } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { mkdir, mkdtemp, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { createRepository } from '../src/domains/data/repository';
import { SCHEMA_VERSION } from '../src/db/migrations';
it('actualiza desde el radar semanal conservando planes, registros y tablas ajenas', async () => {
  await mkdir('work', { recursive: true });
  const folder = await mkdtemp('work/strategy-migration-');
  const client = createClient({ url: 'file::memory:' });
  try {
    await mkdir(`${folder}/meta`);
    const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8'));
    journal.entries = journal.entries.slice(0, 2);
    await writeFile(`${folder}/meta/_journal.json`, JSON.stringify(journal));
    for (const entry of journal.entries)
      await copyFile(`drizzle/${entry.tag}.sql`, `${folder}/${entry.tag}.sql`);
    await migrate(drizzle(client), {
      migrationsFolder: folder,
      migrationsTable: 'faro_migrations',
    });
    const plan = {
      id: 'legacy-plan',
      kind: 'plan',
      name: 'Práctica anterior',
      interestIds: [],
      weekStart: '2026-11-16',
      status: 'pending',
      createdAt: '2026-11-16T12:00:00.000Z',
      updatedAt: '2026-11-16T12:00:00.000Z',
    };
    await client.execute({
      sql: 'INSERT INTO faro_planning(id,kind,week_start,data) VALUES (?,?,?,?)',
      args: [plan.id, plan.kind, plan.weekStart, JSON.stringify(plan)],
    });
    await client.execute('CREATE TABLE unrelated_strategy_app (value TEXT)');
    await client.execute("INSERT INTO unrelated_strategy_app VALUES ('intacto')");
    const repo = await createRepository(client);
    expect(await repo.listPlanning()).toEqual([plan]);
    expect((await repo.getSnapshot()).strategy).toEqual([]);
    expect((await client.execute('SELECT value FROM unrelated_strategy_app')).rows[0]?.value).toBe(
      'intacto',
    );
    expect((await client.execute('PRAGMA foreign_key_check')).rows).toEqual([]);
    expect(
      (await client.execute('SELECT count(*) AS version FROM faro_migrations')).rows[0]?.version,
    ).toBe(SCHEMA_VERSION);
  } finally {
    client.close();
    await rm(folder, { recursive: true, force: true });
  }
});
