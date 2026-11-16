import type { APIRoute } from 'astro';
import { z } from 'zod';
import { apiOperation, json, readJSON, HttpError } from '../../lib/auth';
import {
  getSnapshot,
  getStrategy,
  saveStrategy,
  deleteStrategy,
  strategyHistory,
} from '../../domains/data/service';
import { northView } from '../../domains/strategy';
import { STRATEGY_KINDS } from '../../domains/strategy/types';
const id = z.string().min(1).max(160);
export const GET: APIRoute = ({ url }) =>
  apiOperation(async () => {
    const offset = z.coerce
      .number()
      .int()
      .min(0)
      .max(1000000)
      .parse(url.searchParams.get('offset') ?? 0);
    if (url.searchParams.has('id')) {
      const key = id.parse(url.searchParams.get('id'));
      const item = await getStrategy(key);
      if (!item) throw new HttpError(404, 'Este registro ya no existe.');
      return json({ item, history: await strategyHistory(key, offset) });
    }
    const snapshot = await getSnapshot();
    if (url.searchParams.has('indicator')) {
      const indicatorId = id.parse(url.searchParams.get('indicator'));
      const indicator = snapshot.strategy?.find(
        (i) => i.id === indicatorId && i.kind === 'indicator',
      );
      if (!indicator) throw new HttpError(404, 'El indicador ya no existe.');
      const all = (snapshot.strategy ?? [])
        .filter((i) => i.kind === 'measurement' && i.indicatorId === indicatorId)
        .sort(
          (a, b) =>
            (b.occurredAt ?? '').localeCompare(a.occurredAt ?? '') || b.id.localeCompare(a.id),
        );
      return json({ records: all.slice(offset, offset + 50), total: all.length });
    }
    if (url.searchParams.has('kind')) {
      const kind = z.enum(STRATEGY_KINDS).parse(url.searchParams.get('kind'));
      const query = (url.searchParams.get('q') ?? '').slice(0, 200).toLocaleLowerCase('es');
      const all = (snapshot.strategy ?? [])
        .filter((i) => i.kind === kind && i.name.toLocaleLowerCase('es').includes(query))
        .sort(
          (a, b) =>
            (b.reviewDay ?? b.updatedAt).localeCompare(a.reviewDay ?? a.updatedAt) ||
            b.id.localeCompare(a.id),
        );
      return json({ records: all.slice(offset, offset + 50), total: all.length });
    }
    return json(northView(snapshot));
  });
export const POST: APIRoute = ({ request }) =>
  apiOperation(async () => {
    const input = z
      .object({ id: id.optional(), data: z.unknown() })
      .strict()
      .parse(await readJSON(request));
    return json(await saveStrategy(input.data, input.id), input.id ? 200 : 201);
  });
export const DELETE: APIRoute = ({ request }) =>
  apiOperation(async () => {
    const input = z
      .object({ id })
      .strict()
      .parse(await readJSON(request));
    await deleteStrategy(input.id);
    return json({ deleted: true });
  });
