import { z } from 'zod';
import { addDays, startOfWeek } from '../analytics/dates';
const id = z.string().min(1).max(160);
const ids = z
  .array(id)
  .max(50)
  .transform((values) => [...new Set(values)]);
export const monday = z.iso
  .date()
  .refine((value) => startOfWeek(value) === value, 'La semana debe comenzar en lunes');
export const slotSchema = z
  .object({
    name: z.string().trim().min(1, 'Escribe qué quieres hacer').max(200),
    notes: z.string().max(20000).optional(),
    interestIds: ids.refine((value) => value.length > 0, 'Selecciona un interés'),
    habitIds: ids.optional(),
    projectIds: ids.optional(),
    goalIds: ids.optional(),
    estimatedMinutes: z.number().positive().max(1440).optional(),
  })
  .strict();
export const planInputSchema = slotSchema
  .extend({ weekStart: monday, day: z.iso.date().optional() })
  .strict()
  .refine(
    (value) =>
      !value.day || (value.day >= value.weekStart && value.day <= addDays(value.weekStart, 6)),
    'El día debe pertenecer a la semana elegida',
  );
const timestamps = { id, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() };
export const planSchema = slotSchema
  .extend({
    ...timestamps,
    kind: z.literal('plan'),
    weekStart: monday,
    day: z.iso.date().optional(),
    status: z.enum(['pending', 'completed', 'cancelled']),
    activityId: id.optional(),
    sourceKey: z.string().max(300).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.day && (value.day < value.weekStart || value.day > addDays(value.weekStart, 6)))
      ctx.addIssue({ code: 'custom', message: 'El día debe pertenecer a la semana' });
    if ((value.status === 'completed') !== Boolean(value.activityId))
      ctx.addIssue({ code: 'custom', message: 'Una práctica realizada necesita su sesión real' });
  });
export const templateSchema = z
  .object({
    ...timestamps,
    kind: z.literal('template'),
    name: z.string().trim().min(1).max(200),
    slots: z
      .array(slotSchema.extend({ weekday: z.number().int().min(0).max(6).optional() }).strict())
      .min(1)
      .max(200),
  })
  .strict();
export const planningItemSchema = z.discriminatedUnion('kind', [planSchema, templateSchema]);
export const planningHistorySchema = z
  .object({
    id,
    itemId: id,
    occurredAt: z.iso.datetime(),
    before: planningItemSchema.nullable(),
    after: planningItemSchema.nullable(),
  })
  .strict()
  .refine(
    (v) =>
      Boolean(v.before || v.after) &&
      (!v.before || v.before.id === v.itemId) &&
      (!v.after || v.after.id === v.itemId) &&
      (!v.before || !v.after || v.before.kind === v.after.kind),
    'Historial de planificación incoherente',
  );
export const planningCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), id: id.optional(), data: planInputSchema }).strict(),
  z.object({ action: z.literal('cancel'), id }).strict(),
  z
    .object({
      action: z.literal('complete'),
      id,
      name: z.string().trim().min(1).max(200),
      occurredAt: z.iso.datetime({ offset: true }),
      durationMinutes: z.number().positive().max(1440),
      notes: z.string().max(20000).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('template'),
      weekStart: monday,
      name: z.string().trim().min(1).max(200),
    })
    .strict(),
  z.object({ action: z.literal('apply'), templateId: id, weekStart: monday }).strict(),
  z
    .object({ action: z.literal('copy'), ids: z.array(id).min(1).max(200), weekStart: monday })
    .strict(),
  z.object({ action: z.literal('suggest'), weekStart: monday }).strict(),
  z.object({ action: z.literal('deleteTemplate'), id }).strict(),
]);
export type PlanningCommand = z.infer<typeof planningCommandSchema>;
