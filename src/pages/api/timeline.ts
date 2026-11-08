import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getSnapshot } from '../../domains/data/service';
import { buildTimeline } from '../../domains/timeline';
import { apiOperation, HttpError, json } from '../../lib/auth';
import { ENTITY_TYPES } from '../../lib/types';

export const prerender = false;
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      Number.isFinite(Date.parse(`${value}T12:00:00Z`)) &&
      new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value,
    'Fecha inválida',
  );
const querySchema = z.object({
  from: day.optional(),
  to: day.optional(),
  type: z.enum(ENTITY_TYPES).optional(),
  areaId: z.string().max(160).optional(),
  interestId: z.string().max(160).optional(),
  query: z.string().max(200).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const GET: APIRoute = ({ url }) =>
  apiOperation(async () => {
    const input = querySchema.parse(Object.fromEntries(url.searchParams));
    if (input.from && input.to && input.from > input.to)
      throw new HttpError(400, 'La fecha inicial debe ser anterior o igual a la final.');
    const snapshot = await getSnapshot();
    const events = buildTimeline(
      snapshot.records,
      {
        ...input,
        timezone: snapshot.settings.timezone,
        types: input.type ? [input.type] : undefined,
        limit: input.limit + 1,
      },
      snapshot.history,
    );
    return json({ events: events.slice(0, input.limit), hasMore: events.length > input.limit });
  });
