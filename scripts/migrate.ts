import { getClient } from '../src/db/client';
import { migrateDatabase } from '../src/db/migrations';

const client = getClient();
try {
  await migrateDatabase(client);
  console.log('Migraciones FARO aplicadas. Solo se han utilizado tablas faro_.');
} finally {
  client.close();
}
