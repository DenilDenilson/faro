import type { APIRoute } from 'astro';
import { getSnapshot, listPlanning, planningCommand } from '../../domains/data/service';
import { planningView } from '../../domains/planning';
import { monday } from '../../domains/planning/validation';
import { dateKey, startOfWeek } from '../../domains/analytics/dates';
import { apiOperation, json, readJSON } from '../../lib/auth';
export const GET: APIRoute = ({ url }) =>
  apiOperation(async () => {
    const snapshot = await getSnapshot();
    const week = monday.parse(
      url.searchParams.get('week') ??
        startOfWeek(dateKey(snapshot.generatedAt, snapshot.settings.timezone)),
    );
    return json(planningView(snapshot, await listPlanning(week), week));
  });
export const POST: APIRoute = ({ request }) =>
  apiOperation(async () => json(await planningCommand(await readJSON(request))));
