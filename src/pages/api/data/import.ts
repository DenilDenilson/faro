import type { APIRoute } from 'astro';
import { z } from 'zod';
import { importData, previewImport } from '../../../domains/data/service';
import { apiOperation, json, readJSON } from '../../../lib/auth';

export const prerender = false;
const importSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('preview'), data: z.unknown() }).strict(),
  z
    .object({
      mode: z.literal('confirm'),
      data: z.unknown(),
      previewToken: z.string().min(16).max(200),
      restoreSettings: z.boolean().default(false),
    })
    .strict(),
]);

export const POST: APIRoute = ({ request }) =>
  apiOperation(async () => {
    const input = importSchema.parse(await readJSON(request));
    if (input.mode === 'preview') {
      const preview = await previewImport(input.data);
      return json({ preview, previewToken: preview.digest });
    }
    return json(
      await importData(input.data, {
        digest: input.previewToken,
        restoreSettings: input.restoreSettings,
      }),
    );
  });
