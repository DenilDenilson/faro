import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'turso',
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL ?? 'file:.data/faro.db',
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
  tablesFilter: ['faro_*'],
  migrations: { table: 'faro_migrations' },
  strict: true,
  verbose: true,
});
