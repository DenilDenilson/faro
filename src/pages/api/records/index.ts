import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getSettings, listRecords, saveRecord } from '../../../domains/data/service';
import { compactRecord } from '../../../domains/data/views';
import { addDays, dayInstant } from '../../../domains/analytics/dates';
import { apiOperation, HttpError, json, readJSON } from '../../../lib/auth';
import { ENTITY_TYPES } from '../../../lib/types';

export const prerender = false;
const saveSchema = z.object({ type: z.enum(ENTITY_TYPES), data: z.unknown() }).strict();

export const GET: APIRoute = ({ url }) =>
  apiOperation(async () => {
    const typeText = url.searchParams.get('type');
    const type = typeText ? z.enum(ENTITY_TYPES).parse(typeText) : undefined;
    const limit = Number(url.searchParams.get('limit') ?? '50');
    const offset = Number(url.searchParams.get('offset') ?? '0');
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 500 ||
      !Number.isInteger(offset) ||
      offset < 0
    ) {
      throw new HttpError(400, 'La paginación debe usar limit entre 1 y 500 y offset positivo.');
    }
    const search = z
      .string()
      .max(200)
      .parse(url.searchParams.get('q') ?? url.searchParams.get('search') ?? '');
    const status = z
      .enum(['active', 'paused', 'archived', 'pending', 'in_progress', 'completed', 'cancelled'])
      .optional()
      .parse(url.searchParams.get('status') ?? undefined);
    const relation = (name: string) =>
      z
        .string()
        .max(160)
        .optional()
        .parse(url.searchParams.get(name) ?? undefined);
    let from = url.searchParams.get('from') ?? undefined;
    let to = url.searchParams.get('to') ?? undefined;
    for (const value of [from, to])
      if (value && (!Number.isFinite(Date.parse(value)) || value.length > 50))
        throw new HttpError(400, 'Filtro de fecha inválido.');
    if ((from && /^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && /^\d{4}-\d{2}-\d{2}$/.test(to))) {
      const settings = await getSettings();
      if (from && /^\d{4}-\d{2}-\d{2}$/.test(from))
        from = dayInstant(from, settings.timezone).toISOString();
      if (to && /^\d{4}-\d{2}-\d{2}$/.test(to))
        to = dayInstant(addDays(to, 1), settings.timezone).toISOString();
    }
    if (from && to && from > to)
      throw new HttpError(400, 'El inicio debe ser anterior al final del período.');
    const records = await listRecords({
      type,
      limit,
      offset,
      search,
      status,
      from,
      to,
      areaId: relation('areaId') ?? relation('area'),
      interestId: relation('interestId') ?? relation('interest'),
      parentId: relation('parentId'),
    });
    return json(records.map((record) => compactRecord(record)));
  });

export const POST: APIRoute = ({ request }) =>
  apiOperation(async () => {
    const input = saveSchema.parse(await readJSON(request));
    return json(await saveRecord(input.type, input.data), 201);
  });
