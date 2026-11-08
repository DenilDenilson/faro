import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { link, mkdir, readFile, stat, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { getClient } from '../src/db/client';
import { createRepository, DataError } from '../src/domains/data/service';
import type { FaroBackup } from '../src/lib/types';

const usage = `FARO · respaldo y restauración por conexión directa a libSQL/Turso

  pnpm db:export <archivo.json>
  pnpm exec tsx scripts/data.ts preview <archivo.json>
  pnpm db:import <archivo.json> --digest <digest-de-la-vista-previa> [--restore-settings]

Los destinos deben tener las migraciones FARO aplicadas (pnpm db:migrate).
La exportación nunca reemplaza un archivo existente. La importación conserva los
registros existentes, exige una vista previa vigente y solo añade IDs nuevos.
Sin --restore-settings se conservan las preferencias actuales.
No hay un límite de carga HTTP: este proceso usa directamente las credenciales
privadas de TURSO_DATABASE_URL y TURSO_AUTH_TOKEN definidas en el entorno/.env.
`;

/** Emit one row at a time instead of allocating a second complete backup string. */
async function* backupChunks(backup: FaroBackup): AsyncGenerator<string> {
  yield `{"format":"faro","version":1,"exportedAt":${JSON.stringify(backup.exportedAt)},"settings":${JSON.stringify(backup.settings)},"records":[`;
  for (let index = 0; index < backup.records.length; index++) {
    yield `${index ? ',' : ''}${JSON.stringify(backup.records[index])}`;
  }
  yield '],"history":[';
  for (let index = 0; index < backup.history.length; index++) {
    yield `${index ? ',' : ''}${JSON.stringify(backup.history[index])}`;
  }
  yield ']}\n';
}

async function writeBackup(file: string, backup: FaroBackup): Promise<string> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.partial`;
  const digest = createHash('sha256');
  try {
    async function* hashedChunks(): AsyncGenerator<string> {
      for await (const chunk of backupChunks(backup)) {
        digest.update(chunk);
        yield chunk;
      }
    }
    await pipeline(
      Readable.from(hashedChunks()),
      createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
    );
    // A same-directory hard link publishes the complete file atomically, and
    // unlike rename it cannot overwrite an earlier backup if a name collides.
    await link(temporary, file);
    return digest.digest('hex');
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function readBackup(file: string): Promise<unknown> {
  const info = await stat(file);
  if (!info.isFile()) throw new DataError('El respaldo debe ser un archivo JSON normal.');
  try {
    return JSON.parse(await readFile(file, 'utf8')) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new DataError('El archivo no contiene JSON válido. El destino no fue modificado.');
    throw error;
  }
}

async function run(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    strict: true,
    options: {
      digest: { type: 'string' },
      'restore-settings': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    process.stdout.write(usage);
    return;
  }
  const [command, fileArgument] = positionals;
  if (
    !command ||
    !['export', 'preview', 'import'].includes(command) ||
    !fileArgument ||
    positionals.length !== 2
  ) {
    throw new DataError(`Indica un comando y un archivo.\n\n${usage}`);
  }
  if (command !== 'import' && (values.digest || values['restore-settings'])) {
    throw new DataError('--digest y --restore-settings solo se utilizan en el comando import.');
  }
  if (command === 'import' && (!values.digest || !/^[a-f0-9]{64}$/.test(values.digest))) {
    throw new DataError(
      'Primero ejecuta preview. Después confirma con --digest y los 64 caracteres del digest obtenido.',
    );
  }
  const file = resolve(fileArgument);
  const client = getClient();
  try {
    // Backups never create or alter schemas implicitly, including in development.
    const repository = await createRepository(client, { migrate: false });
    if (command === 'export') {
      const backup = await repository.exportData();
      const sha256 = await writeBackup(file, backup);
      console.log(
        JSON.stringify(
          {
            operation: 'export',
            file,
            records: backup.records.length,
            history: backup.history.length,
            sha256,
          },
          null,
          2,
        ),
      );
      return;
    }
    const backup = await readBackup(file);
    if (command === 'preview') {
      console.log(JSON.stringify(await repository.previewImport(backup), null, 2));
      return;
    }
    const result = await repository.importData(backup, {
      digest: values.digest!,
      restoreSettings: values['restore-settings'],
    });
    console.log(
      JSON.stringify(
        {
          operation: 'import',
          imported: result.imported,
          skipped: result.skipped,
          conflicts: result.conflicts,
          preferencesRestored: values['restore-settings'],
        },
        null,
        2,
      ),
    );
  } finally {
    client.close();
  }
}

try {
  await run();
} catch (error) {
  if (error instanceof DataError) {
    console.error(`FARO: ${error.message}`);
  } else if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
    console.error('FARO: el archivo de destino ya existe. Usa otro nombre; no se ha reemplazado.');
  } else if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
    console.error('FARO: no se encontró el archivo indicado. Comprueba la ruta.');
  } else if (error instanceof Error && 'code' in error && error.code === 'EACCES') {
    console.error('FARO: no hay permisos suficientes para leer o escribir el archivo.');
  } else {
    // SDK errors can include connection strings. Never echo them or a stack.
    console.error(
      'FARO: la operación no pudo completarse. Revisa la conexión privada, las migraciones y los permisos del archivo.',
    );
  }
  process.exitCode = 1;
}
