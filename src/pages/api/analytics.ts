import type { APIRoute } from 'astro';
import { z } from 'zod';
import { buildAnalytics } from '../../domains/analytics';
import { addDays, dateKey, daysBetween } from '../../domains/analytics/dates';
import { getSnapshot } from '../../domains/data/service';
import { apiOperation, HttpError, json } from '../../lib/auth';

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
  startDate: day.optional(),
  endDate: day.optional(),
  areaId: z.string().max(160).optional(),
  interestId: z.string().max(160).optional(),
  projectId: z.string().max(160).optional(),
  all: z.enum(['0', '1']).optional(),
});

export const GET: APIRoute = ({ url }) =>
  apiOperation(async () => {
    const filters = querySchema.parse(Object.fromEntries(url.searchParams));
    const snapshot = await getSnapshot();
    const now = new Date(snapshot.generatedAt);
    const endDate = filters.endDate ?? dateKey(now, snapshot.settings.timezone);
    const startDate =
      filters.all === '1'
        ? (snapshot.records
            .filter((record) => record.type === 'activities')
            .map((record) =>
              dateKey(record.occurredAt ?? record.createdAt, snapshot.settings.timezone),
            )
            .sort()[0] ?? endDate)
        : (filters.startDate ?? addDays(endDate, -29));
    if (startDate > endDate || daysBetween(startDate, endDate) > 36_600)
      throw new HttpError(400, 'Elige un período válido de hasta cien años.');
    return json(
      buildAnalytics(
        snapshot.records,
        snapshot.settings,
        {
          startDate,
          endDate,
          areaId: filters.areaId,
          interestId: filters.interestId,
          projectId: filters.projectId,
        },
        now,
        snapshot.history,
      ),
    );
  });
