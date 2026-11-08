import type { Client } from '@libsql/client';
import { getClient } from '../src/db/client';
import { assertDatabaseMigrated, migrateDatabase, SCHEMA_VERSION } from '../src/db/migrations';

// This entry point is for an explicitly requested remote migration. It never
// falls back to a local file and never prints connection values or user rows.
const expectedTables = [
  'faro_records',
  'faro_links',
  'faro_history',
  'faro_settings',
  'faro_access_attempts',
  'faro_migrations',
];
let client: Client | undefined;
try {
  if (
    process.env.NODE_ENV !== 'production' ||
    !/^(libsql|https):\/\//.test(process.env.TURSO_DATABASE_URL ?? '') ||
    !process.env.TURSO_AUTH_TOKEN
  ) {
    throw new Error('REMOTE_CONFIGURATION_REQUIRED');
  }
  client = getClient();
  await migrateDatabase(client);
  await assertDatabaseMigrated(client);
  const result = await client.execute({
    sql: `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${expectedTables.map(() => '?').join(',')})`,
    args: expectedTables,
  });
  if (result.rows.length !== expectedTables.length) throw new Error('INCOMPLETE_SCHEMA');
  console.log(
    `Migración remota verificada: esquema FARO ${SCHEMA_VERSION}; ${expectedTables.length} tablas comprobadas.`,
  );
} catch (error) {
  const rawCode = error instanceof Error && 'code' in error ? error.code : undefined;
  const code =
    typeof rawCode === 'string' && /^[A-Z0-9_]{1,60}$/.test(rawCode)
      ? rawCode
      : 'REMOTE_MIGRATION_FAILED';
  console.error(
    `No se completó la migración remota (${code}). Revisa los secretos TURSO_DATABASE_URL y TURSO_AUTH_TOKEN, los permisos del token y la conectividad.`,
  );
  process.exitCode = 1;
} finally {
  client?.close();
}
