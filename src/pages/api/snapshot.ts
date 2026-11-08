import type { APIRoute } from 'astro';
import { getSnapshot } from '../../domains/data/service';
import { apiOperation, json } from '../../lib/auth';

export const prerender = false;
export const GET: APIRoute = () => apiOperation(async () => json(await getSnapshot()));
