import type { APIRoute } from 'astro';
import { exportData } from '../../../domains/data/service';
import { apiOperation } from '../../../lib/auth';

export const prerender = false;
export const GET: APIRoute = () =>
  apiOperation(
    async () =>
      new Response(JSON.stringify(await exportData(), null, 2), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="faro-respaldo-${new Date().toISOString().slice(0, 10)}.json"`,
          'Cache-Control': 'no-store',
        },
      }),
  );
