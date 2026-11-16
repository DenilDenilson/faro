import { z } from 'zod';
import { RESOURCE_TYPES, STRATEGY_KINDS, type StrategyInput } from './types';
const text = z.string().max(20000).optional();
const id = z.string().min(1).max(160);
const ids = z
  .array(id)
  .max(500)
  .transform((values) => [...new Set(values)])
  .optional();
const value = z.number().min(-1e12).max(1e12).optional();
export const strategyInputSchema = z
  .object({
    kind: z.enum(STRATEGY_KINDS),
    name: z.string().trim().min(1, 'Escribe un nombre').max(200),
    description: z.string().max(20000).default(''),
    status: z.enum(['active', 'paused', 'archived']).default('active'),
    purpose: text,
    values: text,
    boundaries: text,
    horizon: z.string().max(200).optional(),
    reviewDate: z.iso.date().optional(),
    visionIds: ids,
    keyIds: ids,
    recordIds: ids,
    resourceTypes: z
      .array(z.enum(RESOURCE_TYPES))
      .max(3)
      .transform((values) => [...new Set(values)])
      .optional(),
    requiredResources: text,
    stage: z.enum(['exploring', 'practicing', 'applied']).optional(),
    evidence: text,
    resourceType: z.enum(RESOURCE_TYPES).optional(),
    unit: z.string().trim().min(1).max(100).optional(),
    minimum: value,
    maximum: value,
    indicatorId: id.optional(),
    value,
    occurredAt: z.iso
      .datetime({ offset: true })
      .transform((v) => new Date(v).toISOString())
      .optional(),
    reviewPeriod: z.enum(['monthly', 'quarterly', 'custom']).optional(),
    reviewDay: z.iso.date().optional(),
    reflections: text,
    resourceReview: text,
    capabilityReview: text,
    decisions: text,
    nextPriorities: text,
  })
  .strict();
export function parseStrategyInput(input: unknown): StrategyInput {
  const required = new Set(['kind', 'name', 'description', 'status']);
  const normalized =
    input && typeof input === 'object' && !Array.isArray(input)
      ? Object.fromEntries(
          Object.entries(input).map(([k, v]) => [
            k,
            v === null && Object.hasOwn(strategyInputSchema.shape, k) && !required.has(k)
              ? undefined
              : v,
          ]),
        )
      : input;
  return strategyInputSchema
    .superRefine((v, ctx) => {
      const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
      if (v.kind === 'key' && !v.stage) issue('Indica en qué etapa está esta clave');
      if (v.kind === 'indicator' && (!v.resourceType || !v.unit))
        issue('Un indicador necesita fuente y unidad');
      if (v.minimum !== undefined && v.maximum !== undefined && v.minimum > v.maximum)
        issue('El mínimo no puede superar el máximo');
      if (v.kind === 'measurement' && (!v.indicatorId || v.value === undefined || !v.occurredAt))
        issue('Una medición necesita indicador, valor y fecha');
      if (v.kind === 'measurement' && v.occurredAt && Date.parse(v.occurredAt) > Date.now())
        issue('Una medición debe tener fecha no futura');
      if (v.kind === 'review' && (!v.reviewPeriod || !v.reviewDay))
        issue('Indica el período y día de la revisión de rumbo');
    })
    .parse(normalized);
}
export const strategyItemSchema = strategyInputSchema
  .extend({ id, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() })
  .strict()
  .superRefine((item, ctx) => {
    const { id: _id, createdAt: _created, updatedAt: _updated, ...input } = item;
    try {
      parseStrategyInput(input);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'El registro de estrategia es inválido' });
    }
  });
export const strategyHistorySchema = z
  .object({
    id,
    itemId: id,
    occurredAt: z.iso.datetime(),
    before: strategyItemSchema.nullable(),
    after: strategyItemSchema.nullable(),
  })
  .strict()
  .refine(
    (v) =>
      Boolean(v.before || v.after) &&
      (!v.before || v.before.id === v.itemId) &&
      (!v.after || v.after.id === v.itemId) &&
      (!v.before || !v.after || v.before.kind === v.after.kind),
    'Historial de estrategia incoherente',
  );
