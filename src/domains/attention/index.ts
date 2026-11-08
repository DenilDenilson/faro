import type { FaroRecord, HistoryEntry, Settings } from '../../lib/types';
import { dateKey, daysBetween, isActivity } from '../analytics/dates';
import { activeDaysBetween, recordAt, seasonRoleFor, type SeasonRole } from '../seasons';

export type AttentionState = 'current' | 'due' | 'neglected' | 'paused' | 'insufficient';
export interface AttentionResult {
  interestId: string;
  state: AttentionState;
  label: string;
  daysSinceLast: number | null;
  activeDaysSinceLast: number;
  lastActivityAt: string | null;
  frequencyDays: number;
  warningDays: number;
  priority: number;
  seasonRole: SeasonRole;
  reason: string;
}

export function attentionFor(
  interest: FaroRecord,
  records: FaroRecord[],
  settings: Settings,
  now = new Date(),
  history: HistoryEntry[] = [],
): AttentionResult {
  const effective = recordAt(interest, history, now) ?? interest;
  const today = dateKey(now, settings.timezone);
  const frequency = Math.max(1, effective.frequencyDays ?? 7);
  const priority = effective.priority ?? 2;
  const role = seasonRoleFor(effective, records, today);
  const ratio = Math.max(
    0.1,
    Math.min(
      1,
      settings.attentionWarningRatio -
        (priority === 3 ? 0.1 : 0) -
        (role === 'focus' ? 0.1 : 0) +
        (role === 'exploration' ? 0.1 : 0),
    ),
  );
  const warningDays = Math.max(1, Math.min(frequency, Math.ceil(frequency * ratio - 1e-9)));
  const activities = records.filter(
    (record) =>
      isActivity(record) &&
      record.interestIds?.includes(effective.id) &&
      (record.occurredAt ?? record.createdAt) <= now.toISOString(),
  );
  const last =
    activities
      .map((record) => record.occurredAt ?? record.createdAt)
      .sort()
      .at(-1) ?? null;
  const frequencyChange = history
    .filter(
      (entry) =>
        entry.recordId === effective.id &&
        entry.operation === 'update' &&
        entry.before?.frequencyDays !== entry.after?.frequencyDays &&
        entry.occurredAt <= now.toISOString(),
    )
    .map((entry) => entry.occurredAt)
    .sort()
    .at(-1);
  const reference =
    [last ?? effective.createdAt, frequencyChange ?? effective.createdAt].sort().at(-1) ??
    effective.createdAt;
  const referenceDay = dateKey(reference, settings.timezone);
  const elapsed = activeDaysBetween(effective, history, referenceDay, today, settings.timezone);
  const daysSinceLast = last
    ? Math.max(0, daysBetween(dateKey(last, settings.timezone), today))
    : null;
  const base: Omit<AttentionResult, 'state' | 'label' | 'reason'> = {
    interestId: effective.id,
    daysSinceLast,
    activeDaysSinceLast: elapsed,
    lastActivityAt: last,
    frequencyDays: frequency,
    warningDays,
    priority,
    seasonRole: role,
  };
  if (['paused', 'archived', 'cancelled', 'completed'].includes(effective.status)) {
    return {
      ...base,
      state: 'paused',
      label: effective.status === 'archived' ? 'Archivado' : 'En pausa',
      reason: 'Este interés no genera alertas mientras está en pausa o archivado.',
    };
  }
  const context = `${elapsed} días activos desde ${frequencyChange && frequencyChange > (last ?? '') ? 'el cambio de frecuencia' : last ? 'la última sesión' : 'su creación'}; frecuencia deseada: cada ${frequency} días.`;
  if (elapsed >= frequency)
    return { ...base, state: 'neglected', label: 'Desatendido', reason: context };
  if (elapsed >= warningDays)
    return {
      ...base,
      state: 'due',
      label: 'Próximo a vencer',
      reason: `${context} El aviso considera prioridad y temporada.`,
    };
  if (!last)
    return {
      ...base,
      state: 'insufficient',
      label: 'Sin datos suficientes',
      reason: `${context} Registra una primera sesión para iniciar su historial.`,
    };
  return { ...base, state: 'current', label: 'Al día', reason: context };
}

export function attentionRadar(
  records: FaroRecord[],
  settings: Settings,
  now = new Date(),
  history: HistoryEntry[] = [],
): AttentionResult[] {
  const rank: Record<AttentionState, number> = {
    neglected: 0,
    due: 1,
    insufficient: 2,
    current: 3,
    paused: 4,
  };
  return records
    .filter((record) => record.type === 'interests')
    .map((record) => attentionFor(record, records, settings, now, history))
    .sort(
      (a, b) =>
        rank[a.state] - rank[b.state] ||
        b.priority - a.priority ||
        b.activeDaysSinceLast - a.activeDaysSinceLast,
    );
}
