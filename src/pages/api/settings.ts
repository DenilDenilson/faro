import type { APIRoute } from 'astro';
import { getSettings, updateSettings } from '../../domains/data/service';
import { apiOperation, json, readJSON } from '../../lib/auth';
import { settingsSchema } from '../../lib/validation';

export const prerender = false;
export const GET: APIRoute = () => apiOperation(async () => json(await getSettings()));
export const PUT: APIRoute = ({ request }) =>
  apiOperation(async () => {
    const changes = settingsSchema.partial().parse(await readJSON(request));
    return json(await updateSettings(changes));
  });
