import { resolve } from 'node:path';
import type { Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';

/** Increment whenever a new ordered migration is generated and reviewed. */
export const SCHEMA_VERSION = 1;

/** Only development and the explicit deployment CLI call the migrator. */
export async function migrateDatabase(client: Client): Promise<void> {
  await client.execute('PRAGMA foreign_keys = ON');
  await migrate(drizzle(client), {
    migrationsFolder: resolve(process.cwd(), 'drizzle'),
    migrationsTable: 'faro_migrations',
  });
}

/** Production requests never change the schema or rely on local SQL files. */
export async function assertDatabaseMigrated(client: Client): Promise<void> {
  const result = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    args: ['faro_migrations'],
  });
  if (!result.rows.length)
    throw new Error(
      'La base FARO necesita migraciones. Ejecuta pnpm db:migrate antes de servir producción.',
    );
  const version = await client.execute('SELECT count(*) AS version FROM faro_migrations');
  if (Number(version.rows[0]?.version ?? 0) !== SCHEMA_VERSION)
    throw new Error(
      'La base FARO no está en la versión de esquema esperada. Ejecuta pnpm db:migrate.',
    );
}
