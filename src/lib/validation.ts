import { z } from 'zod';
import {
  DEFAULT_SETTINGS,
  ENTITY_TYPES,
  type EntityType,
  type FaroBackup,
  type FaroRecord,
  type RecordInput,
  type Settings,
} from './types';

const optionalText = (max = 20_000) => z.string().max(max).optional();
const id = z.string().min(1).max(160);
const ids = z
  .array(id)
  .max(500)
  .transform((values) => [...new Set(values)])
  .optional();
const instant = z.iso
  .datetime({ offset: true })
  .max(50)
  .transform((value) => new Date(value).toISOString());
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }, 'La fecha no existe');

export const recordInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Escribe un nombre').max(200),
    description: z.string().max(20_000).default(''),
    status: z
      .enum(['active', 'paused', 'archived', 'pending', 'in_progress', 'completed', 'cancelled'])
      .default('active'),
    completedAt: instant.optional(),
    areaId: id.optional(),
    interestIds: ids,
    habitIds: ids,
    projectIds: ids,
    goalIds: ids,
    learningIds: ids,
    parentId: id.optional(),
    activityId: id.optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    icon: z.string().max(80).optional(),
    order: z.number().int().min(0).max(1_000_000).optional(),
    priority: z.number().int().min(1).max(3).optional(),
    frequencyDays: z.number().int().min(1).max(3650).optional(),
    cadence: z.enum(['daily', 'weekly', 'monthly', 'interval', 'custom']).optional(),
    targetCount: z.number().int().min(1).max(10_000).optional(),
    targetMinutes: z.number().min(1).max(1_000_000).optional(),
    intervalDays: z.number().int().min(1).max(3650).optional(),
    weekdays: z
      .array(z.number().int().min(0).max(6))
      .max(7)
      .transform((values) => [...new Set(values)])
      .optional(),
    targetValue: z.number().positive().max(1e12).optional(),
    currentValue: z.number().min(0).max(1e12).optional(),
    baselineValue: z.number().min(0).max(1e12).optional(),
    unit: optionalText(100),
    outcomes: optionalText(),
    occurredAt: instant.optional(),
    durationMinutes: z.number().positive().max(1440).optional(),
    startDate: day.optional(),
    endDate: day.optional(),
    weekStart: day.optional(),
    reflections: optionalText(),
    achievements: optionalText(),
    difficulties: optionalText(),
    decisions: optionalText(),
    nextPriorities: optionalText(),
    focusIds: ids,
    maintenanceIds: ids,
    explorationIds: ids,
    tags: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
    references: z
      .array(
        z
          .url()
          .max(2000)
          .refine((value) => /^https?:\/\//.test(value), 'Solo enlaces http/https'),
      )
      .max(100)
      .optional(),
    notes: optionalText(100_000),
    value: z.number().min(0).max(1e12).optional(),
    idempotencyKey: z.string().min(8).max(160).optional(),
  })
  .strict();

export function parseRecordInput(type: EntityType, value: unknown): RecordInput {
  // A missing field preserves its previous value in a partial update. An
  // explicit null clears a known optional field before domain validation.
  const requiredFields = new Set(['name', 'description', 'status']);
  const normalized =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).map(([key, fieldValue]) => [
            key,
            fieldValue === null &&
            Object.hasOwn(recordInputSchema.shape, key) &&
            !requiredFields.has(key)
              ? undefined
              : fieldValue,
          ]),
        )
      : value;
  const data = recordInputSchema.parse(normalized);
  const issue = (message: string): never => {
    throw new z.ZodError([{ code: 'custom', path: [], message }]);
  };
  if (type === 'interests' && (!data.areaId || !data.frequencyDays))
    issue('Cada interés necesita un área y frecuencia propia');
  if (
    type === 'activities' &&
    (!data.interestIds?.length || !data.occurredAt || !data.durationMinutes)
  )
    issue('Una sesión necesita interés, fecha y duración');
  if (type !== 'activities' && data.idempotencyKey)
    issue('Las claves de sesión solo se utilizan en actividades');
  if (type === 'habits' && (!data.cadence || !data.interestIds?.length))
    issue('Un hábito necesita frecuencia e interés');
  if (type === 'habits' && data.cadence === 'interval' && !data.intervalDays)
    issue('Indica cada cuántos días se repite el hábito');
  if (type === 'habits' && data.cadence === 'custom' && !data.weekdays?.length)
    issue('Selecciona los días del hábito');
  if (type === 'milestones' && !data.parentId) issue('El hito necesita un proyecto');
  if (type === 'progress' && (!data.parentId || data.value === undefined || !data.occurredAt))
    issue('El avance necesita objetivo o proyecto, valor y fecha');
  if (type === 'progress' && data.occurredAt && Date.parse(data.occurredAt) > Date.now() + 60_000)
    issue('Una medición de avance no puede estar en el futuro');
  if (type === 'reviews' && !data.weekStart) issue('La revisión necesita una semana');
  if (
    type === 'reviews' &&
    data.weekStart &&
    new Date(`${data.weekStart}T12:00:00Z`).getUTCDay() !== 1
  )
    issue('El inicio de la revisión debe ser lunes');
  if (type === 'seasons' && (!data.startDate || !data.endDate))
    issue('La temporada necesita fecha inicial y final');
  if (data.startDate && data.endDate && data.startDate > data.endDate)
    issue('La fecha final debe ser igual o posterior a la inicial');
  if (type === 'seasons') {
    const all = [
      ...(data.focusIds ?? []),
      ...(data.maintenanceIds ?? []),
      ...(data.explorationIds ?? []),
    ];
    if (new Set(all).size !== all.length)
      issue('Un elemento solo puede ocupar un nivel de prioridad en cada temporada');
  }
  return data;
}

export const settingsSchema = z
  .object({
    timezone: z
      .string()
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, 'Zona horaria desconocida'),
    theme: z.enum(['light', 'dark', 'system']),
    attentionWarningRatio: z.number().min(0.1).max(1),
    projectIdleDays: z.number().int().min(1).max(3650),
    goalDueDays: z.number().int().min(1).max(365),
    showStreaks: z.boolean(),
    alertPreferences: z
      .object({
        interest: z.boolean(),
        habit: z.boolean(),
        review: z.boolean(),
        goal: z.boolean(),
        project: z.boolean(),
      })
      .strict(),
    dismissedAlerts: z.record(z.string().max(300), instant),
    snoozedAlerts: z.record(z.string().max(300), instant),
  })
  .strict();

export function parseSettings(value: unknown): Settings {
  return settingsSchema.parse(value);
}

const storedRecordSchema = recordInputSchema.extend({
  id,
  type: z.enum(ENTITY_TYPES),
  createdAt: instant,
  updatedAt: instant,
});
const historySchema = z
  .object({
    id,
    recordId: id,
    type: z.enum(ENTITY_TYPES),
    occurredAt: instant,
    operation: z.enum(['create', 'update', 'delete']),
    before: storedRecordSchema.nullable(),
    after: storedRecordSchema.nullable(),
  })
  .strict();
const backupSchema = z
  .object({
    format: z.literal('faro'),
    version: z.literal(1),
    exportedAt: instant,
    records: z.array(storedRecordSchema).max(250_000),
    settings: settingsSchema.default(DEFAULT_SETTINGS),
    history: z.array(historySchema).max(1_000_000).default([]),
  })
  .strict();

export function parseBackup(value: unknown): FaroBackup {
  const parsed = backupSchema.parse(value);
  const unique = new Set<string>();
  for (const record of parsed.records) {
    if (unique.has(record.id))
      throw new z.ZodError([
        {
          code: 'custom',
          path: ['records'],
          message: `El archivo contiene el ID duplicado ${record.id}`,
        },
      ]);
    unique.add(record.id);
    const { id: _id, type, createdAt: _created, updatedAt: _updated, ...data } = record;
    parseRecordInput(type, data);
  }
  const historyIds = new Set<string>();
  for (const entry of parsed.history) {
    const issue = (message: string): never => {
      throw new z.ZodError([{ code: 'custom', path: ['history'], message }]);
    };
    if (historyIds.has(entry.id)) issue('El respaldo contiene eventos históricos duplicados');
    historyIds.add(entry.id);
    if (
      (entry.operation === 'create' && (entry.before !== null || entry.after === null)) ||
      (entry.operation === 'delete' && (entry.before === null || entry.after !== null)) ||
      (entry.operation === 'update' && (entry.before === null || entry.after === null))
    )
      issue('El historial tiene una operación incoherente');
    for (const snapshot of [entry.before, entry.after]) {
      if (!snapshot) continue;
      if (snapshot.id !== entry.recordId || snapshot.type !== entry.type)
        issue('El historial apunta a otro ID o tipo de registro');
      const { id: _id, type, createdAt: _created, updatedAt: _updated, ...data } = snapshot;
      parseRecordInput(type, data);
    }
  }
  return parsed as FaroBackup;
}

export function parseStoredRecord(value: unknown): FaroRecord {
  return storedRecordSchema.parse(value);
}
