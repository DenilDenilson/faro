import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createClient, type Client } from '@libsql/client';

let client: Client | undefined;

export function getClient(): Client {
  if (client) return client;
  const production = process.env.NODE_ENV === 'production';
  let url = process.env.TURSO_DATABASE_URL;
  if (production && (!url || !/^(libsql|https):\/\//.test(url) || !process.env.TURSO_AUTH_TOKEN)) {
    throw new Error(
      'Producción necesita TURSO_DATABASE_URL remota y TURSO_AUTH_TOKEN. No se habilita persistencia local en producción.',
    );
  }
  if (!url) {
    const localPath = resolve(process.env.FARO_DATABASE_PATH ?? '.data/faro.db');
    mkdirSync(dirname(localPath), { recursive: true });
    url = `file:${localPath}`;
  }
  if (url.startsWith('file:') && !url.includes(':memory:'))
    mkdirSync(dirname(resolve(url.slice(5))), { recursive: true });
  client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  return client;
}

export function resetClientForTests(): void {
  client?.close();
  client = undefined;
}
