import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getSnapshot, updateAlertState } from '../../domains/data/service';
import { buildAlerts } from '../../domains/notifications';
import { apiOperation, json, readJSON } from '../../lib/auth';

export const prerender = false;
export const GET: APIRoute = () =>
  apiOperation(async () => {
    const snapshot = await getSnapshot();
    return json(buildAlerts(snapshot.records, snapshot.settings, new Date(), snapshot.history));
  });
const inputSchema = z
  .object({
    id: z.string().min(1).max(300),
    action: z.enum(['dismiss', 'snooze']),
    until: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

export const POST: APIRoute = ({ request }) =>
  apiOperation(async () => {
    const input = inputSchema.parse(await readJSON(request));
    return json(await updateAlertState(input.id, input.action, input.until));
  });
