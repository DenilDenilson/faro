import { it, expect } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { mkdir, mkdtemp, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { SCHEMA_VERSION } from '../src/db/migrations';
import { createRepository } from '../src/domains/data/repository';
it('actualiza una base anterior con datos sin reconstruir registros ni modificar tablas ajenas', async () => {
  await mkdir('work', { recursive: true });
  const folder = await mkdtemp('work/planning-migration-');
  const client = createClient({ url: 'file::memory:' });
  try {
    await mkdir(`${folder}/meta`);
    const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8'));
    journal.entries = journal.entries.slice(0, 1);
    await writeFile(`${folder}/meta/_journal.json`, JSON.stringify(journal));
    await copyFile('drizzle/0000_faro_registry.sql', `${folder}/0000_faro_registry.sql`);
    await migrate(drizzle(client), {
      migrationsFolder: folder,
      migrationsTable: 'faro_migrations',
    });
    const record = {
      id: 'legacy-area',
      type: 'areas',
      name: 'Mi área original',
      description: 'Conservar',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await client.execute({
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
    });
    await client.execute('CREATE TABLE unrelated_app (name TEXT)');
    await client.execute("INSERT INTO unrelated_app VALUES ('intacto')");
    const repo = await createRepository(client);
    expect(await repo.getRecord(record.id)).toEqual(record);
    expect((await client.execute('SELECT name FROM unrelated_app')).rows[0]?.name).toBe('intacto');
    expect(await repo.listPlanning()).toEqual([]);
    expect(
      (await client.execute('SELECT count(*) AS version FROM faro_migrations')).rows[0]?.version,
    ).toBe(SCHEMA_VERSION);
    expect((await client.execute('PRAGMA foreign_key_check')).rows).toEqual([]);
  } finally {
    client.close();
    await rm(folder, { recursive: true, force: true });
  }
});
