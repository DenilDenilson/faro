import type { APIRoute } from 'astro';
import { z } from 'zod';
import { deleteRecord, getRecord, getSnapshot, saveRecord } from '../../../domains/data/service';
import { recordDetailView } from '../../../domains/data/views';
import { apiOperation, HttpError, json, readJSON } from '../../../lib/auth';
import { ENTITY_TYPES } from '../../../lib/types';

export const prerender = false;
const saveSchema = z.object({ type: z.enum(ENTITY_TYPES), data: z.unknown() }).strict();
const idSchema = z.string().min(1).max(160);

export const GET: APIRoute = ({ params, url }) =>
  apiOperation(async () => {
    const id = idSchema.parse(params.id);
    if (url.searchParams.get('detail') === '1') {
      const query = z
        .object({
          activityOffset: z.coerce.number().int().min(0).default(0),
          historyOffset: z.coerce.number().int().min(0).default(0),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        })
        .parse(Object.fromEntries(url.searchParams));
      const detail = recordDetailView(await getSnapshot(), id, query);
      if (!detail) throw new HttpError(404, 'El registro ya no existe.');
      return json(detail);
    }
    const record = await getRecord(id);
    if (!record) throw new HttpError(404, 'El registro ya no existe.');
    return json(record);
  });

export const PUT: APIRoute = ({ request, params }) =>
  apiOperation(async () => {
    const input = saveSchema.parse(await readJSON(request));
    return json(await saveRecord(input.type, input.data, idSchema.parse(params.id)));
  });

export const DELETE: APIRoute = ({ request, params }) =>
  apiOperation(async () => {
    // A body is not necessary, but an authenticated same-origin request always is.
    const origin = request.headers.get('origin');
    if (origin !== new URL(request.url).origin)
      throw new HttpError(403, 'El origen no coincide con FARO.');
    await deleteRecord(idSchema.parse(params.id));
    return json({ deleted: true });
  });
